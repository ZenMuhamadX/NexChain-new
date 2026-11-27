//! Midstate SHA256d untuk loop PoW fork `pow-bytes`.
//!
//! Preimage = byte payload kanonik (lihat `docs/POW_PAYLOAD_FORMAT.md`) dengan
//! `nonce.to_le_bytes()` ditulis ke 4 byte terakhir. Hasilnya
//! `SHA256(SHA256(payloadBytes))` — persis yang diverifikasi node. Tidak ada
//! teks desimal, tidak ada JSON, dan tidak ada pembangunan ulang payload dari
//! metadata.
//!
//! Payload blok nyata ~197–209 byte. Kelas ini menghitung semua blok SHA-256
//! penuh dari prefix konstan (semua byte sebelum slot nonce) SEKALI per job,
//! lalu tiap nonce hanya mengompres 1–2 blok ekor untuk SHA256 #1 ditambah 1
//! blok tetap untuk SHA256 #2.
//!
//! Vektor di bawah dihasilkan dari `node:crypto` memakai layout spesifikasi
//! (bukan kode lane TypeScript), dan `cargo test`/`self_check` menjaganya.

use sha2::compress256;
use sha2::digest::generic_array::GenericArray;

const IV: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// Magic `NXM1` sebagai u32 little-endian (byte di wire: `31 4d 58 4e`).
const MAGIC: u32 = 0x4e58_4d31;
const LAYOUT_VERSION: u16 = 2;
const NONCE_LEN: usize = 4;
/// Byte sebelum `extraData` (termasuk `extraDataLen`).
const FIXED_BEFORE_EXTRA: usize = 193;
/// Panjang minimum: 193 + 0 extraData + 4 nonce.
const MIN_PAYLOAD_LEN: usize = FIXED_BEFORE_EXTRA + NONCE_LEN;

/// Nonce adalah uint32: `0..=u32::MAX`. Batas atas eksklusif untuk cursor;
/// setelah habis miner minta job baru, tidak pernah wrap ke 0.
pub const MAX_NONCE: u64 = 1 << 32;

#[derive(Clone)]
pub struct PowHasher {
    /// State SHA-256 setelah semua blok penuh dari prefix konstan.
    base_state: [u32; 8],
    /// Ekor prefix + slot nonce + padding: 1 atau 2 blok.
    tail: [u8; 128],
    tail_blocks: usize,
    nonce_at: usize,
}

impl PowHasher {
    /// Validasi payload kanonik lalu siapkan midstate. Error berarti payload
    /// tidak boleh ditambang (magic/layout/panjang tidak sesuai spesifikasi).
    pub fn new(payload: &[u8]) -> Result<Self, String> {
        if payload.len() < MIN_PAYLOAD_LEN {
            return Err(format!(
                "payload terlalu pendek: {} byte (minimum {MIN_PAYLOAD_LEN})",
                payload.len()
            ));
        }

        let magic = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
        if magic != MAGIC {
            return Err(format!(
                "magic payload salah: 0x{magic:08x} (harus 0x{MAGIC:08x})"
            ));
        }

        let layout = u16::from_le_bytes([payload[4], payload[5]]);
        if layout != LAYOUT_VERSION {
            return Err(format!(
                "layoutVersion payload tidak didukung: {layout} (harus {LAYOUT_VERSION})"
            ));
        }

        // `extraDataLen` harus konsisten dengan panjang total. Ini sekaligus
        // membuktikan 4 byte terakhir adalah slot nonce, bukan bagian data.
        let extra_len = u16::from_le_bytes([payload[191], payload[192]]) as usize;
        let expected = FIXED_BEFORE_EXTRA + extra_len + NONCE_LEN;
        if payload.len() != expected {
            return Err(format!(
                "panjang payload {} byte tidak cocok dengan extraDataLen {extra_len} (harus {expected})",
                payload.len()
            ));
        }

        Ok(Self::from_prefix(&payload[..payload.len() - NONCE_LEN]))
    }

    /// Bangun midstate dari prefix tanpa slot nonce. Dipakai `new` setelah
    /// validasi, dan oleh test vektor primitif Bitcoin genesis header.
    fn from_prefix(prefix: &[u8]) -> Self {
        let full = prefix.len() / 64;
        let rest = prefix.len() % 64;

        let mut base_state = IV;
        for i in 0..full {
            let block = GenericArray::clone_from_slice(&prefix[i * 64..i * 64 + 64]);
            compress256(&mut base_state, std::slice::from_ref(&block));
        }

        let mut tail = [0u8; 128];
        tail[..rest].copy_from_slice(&prefix[full * 64..]);

        // Pesan SHA256 #1 pada blok ekor = sisa prefix + 4 byte nonce.
        let msg_tail_len = rest + NONCE_LEN;
        let (tail_blocks, padded_len) = if msg_tail_len + 1 + 8 <= 64 {
            (1usize, 64usize)
        } else {
            (2usize, 128usize)
        };
        tail[msg_tail_len] = 0x80;
        let total_bits = ((prefix.len() + NONCE_LEN) as u64) * 8;
        tail[padded_len - 8..padded_len].copy_from_slice(&total_bits.to_be_bytes());

        Self {
            base_state,
            tail,
            tail_blocks,
            nonce_at: rest,
        }
    }

    /// SHA256d dari prefix konstan + `nonce` little-endian. Hanya 4 byte slot
    /// nonce yang berubah antar panggilan; padding tetap dari `from_prefix`.
    pub fn hash(&mut self, nonce: u32) -> [u8; 32] {
        self.tail[self.nonce_at..self.nonce_at + NONCE_LEN]
            .copy_from_slice(&nonce.to_le_bytes());

        let mut state = self.base_state;
        if self.tail_blocks == 1 {
            let block = GenericArray::clone_from_slice(&self.tail[..64]);
            compress256(&mut state, std::slice::from_ref(&block));
        } else {
            let b0 = GenericArray::clone_from_slice(&self.tail[..64]);
            let b1 = GenericArray::clone_from_slice(&self.tail[64..128]);
            compress256(&mut state, &[b0, b1]);
        }

        let mut first = [0u8; 32];
        for (i, word) in state.iter().enumerate() {
            first[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
        }

        // SHA256 #2 selalu satu blok: digest 32 byte + 0x80 + panjang 256 bit.
        let mut block = [0u8; 64];
        block[..32].copy_from_slice(&first);
        block[32] = 0x80;
        block[56..64].copy_from_slice(&(32u64 * 8).to_be_bytes());

        let mut state2 = IV;
        let block2 = GenericArray::clone_from_slice(&block);
        compress256(&mut state2, std::slice::from_ref(&block2));

        let mut out = [0u8; 32];
        for (i, word) in state2.iter().enumerate() {
            out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
        }
        out
    }
}

pub fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    let bytes = hex.as_bytes();
    if bytes.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let hi = (pair[0] as char).to_digit(16)?;
        let lo = (pair[1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
    }
    Some(out)
}

// Payload kanonik per `docs/POW_PAYLOAD_FORMAT.md`; hash dihasilkan dari
// `node:crypto` dengan skrip standalone (layout spesifikasi, bukan kode lane TS).
const PAYLOAD_MINIMAL: &str = "314d584e020000000f7117e28ab1237b19406c6ad9dc120f3597c25436409d1c6f227e4e0b0917758e73a1010000000200010000101ee3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85501000000e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8551a00000001807c814a00000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa807c814a00000000807c814a00000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000000000000";
const PAYLOAD_EXTRA_12: &str = "314d584e020000000f7117e28ab1237b19406c6ad9dc120f3597c25436409d1c6f227e4e0b0917758e73a1010000000200010000101ee3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85501000000e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8551a00000001807c814a00000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa807c814a00000000807c814a00000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0c00426c6f636b2072657761726400000000";
const PAYLOAD_EXTRA_51: &str = "314d584e020000000f7117e28ab1237b19406c6ad9dc120f3597c25436409d1c6f227e4e0b0917758e73a1010000000200010000101ee3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85501000000e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8551a00000001807c814a00000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa807c814a00000000807c814a00000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3300ababababababababababababababababababababababababababababababababababababababababababababababababababab00000000";

/// `(payload_hex, nonce, sha256d_hex)`.
pub const PARITY_VECTORS: &[(&str, u32, &str)] = &[
    (
        PAYLOAD_MINIMAL,
        0,
        "cf2939052c7dc28602be15f9071b28d9d42a18d770be70e26e1410734d8d47ef",
    ),
    (
        PAYLOAD_MINIMAL,
        1,
        "f491235c680121c970ef35d1e98aee783ad936aadd7857199becd2881c3ca738",
    ),
    (
        PAYLOAD_MINIMAL,
        0xffff_ffff,
        "4297e58fb8f3f9ab85b27926dcf377139a03cf6acd72d2aba666a22f31f7f8a1",
    ),
    (
        PAYLOAD_EXTRA_12,
        0,
        "e2bd4135ca541f31f2b6f8a754c67374815ac1210f8f6aa131453fc2ce4b3a5a",
    ),
    (
        PAYLOAD_EXTRA_12,
        1,
        "6a662aca389252d01f7f0c22a819e3cc1c99b1d50f9219474b4b52a6c81cad04",
    ),
    (
        PAYLOAD_EXTRA_12,
        0xffff_ffff,
        "78746193b0ca9cd66307819862b649eefecb2132346cd1de191e992c4adcc158",
    ),
    (
        PAYLOAD_EXTRA_51,
        0,
        "1145bbdf35b9bb098d6f4367acd5fbd243c821f55addac562449b4a5d3ef2971",
    ),
    (
        PAYLOAD_EXTRA_51,
        1,
        "0a2b7191f18d346b615532ba09df231b44acdaa72c9140f8efc62f960b0a6e3e",
    ),
    (
        PAYLOAD_EXTRA_51,
        0xffff_ffff,
        "c80fb20859d8a5a4995067458d7f0fe932e7f3f52ed517803bcee0648e7a61e5",
    ),
];

/// Bitcoin genesis block header (80 byte) dipakai sebagai vektor primitif
/// SHA256d eksternal; 76 byte pertama adalah prefix, 4 byte terakhir nonce.
const BITCOIN_GENESIS_PREFIX: &str = "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d";
const BITCOIN_GENESIS_NONCE: u32 = 0x7c2b_ac1d;
const BITCOIN_GENESIS_HASH: &str =
    "6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000";

/// Verifikasi-diri saat startup (~mikrodetik). Menangkap binary/CPU yang
/// menghasilkan hash berbeda sebelum mining dimulai; `run()` menghentikan
/// miner bila ini false.
pub fn self_check() -> bool {
    for (payload_hex, nonce, expected) in PARITY_VECTORS {
        let Some(payload) = hex_to_bytes(payload_hex) else {
            return false;
        };
        let Ok(mut hasher) = PowHasher::new(&payload) else {
            return false;
        };
        if to_hex(&hasher.hash(*nonce)) != *expected {
            return false;
        }
    }

    let Some(prefix) = hex_to_bytes(BITCOIN_GENESIS_PREFIX) else {
        return false;
    };
    let mut hasher = PowHasher::from_prefix(&prefix);
    to_hex(&hasher.hash(BITCOIN_GENESIS_NONCE)) == BITCOIN_GENESIS_HASH
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn reference_sha256d(prefix: &[u8], nonce: u32) -> [u8; 32] {
        // Referensi lambat: bangun pesan utuh lalu SHA256 dua kali. Dipakai
        // hanya untuk memastikan midstate tidak melenceng pada panjang apa pun.
        let mut message = Vec::with_capacity(prefix.len() + 4);
        message.extend_from_slice(prefix);
        message.extend_from_slice(&nonce.to_le_bytes());
        let first = Sha256::digest(&message);
        let second = Sha256::digest(&first);
        let mut out = [0u8; 32];
        out.copy_from_slice(&second);
        out
    }

    fn payload_bytes(payload_hex: &str) -> Vec<u8> {
        hex_to_bytes(payload_hex).expect("vektor payload harus hex valid")
    }

    #[test]
    fn parity_with_node_vectors() {
        for (payload_hex, nonce, expected) in PARITY_VECTORS {
            let mut hasher = PowHasher::new(&payload_bytes(payload_hex)).unwrap();
            assert_eq!(
                to_hex(&hasher.hash(*nonce)),
                *expected,
                "payload_len={} nonce={nonce}",
                payload_hex.len() / 2
            );
        }
    }

    #[test]
    fn midstate_matches_reference_across_prefix_lengths() {
        // Panjang prefix menyentuh batas blok 64 byte dan kedua bentuk ekor
        // (1 blok dan 2 blok), termasuk prefix kosong.
        let nonces = [0u32, 1, 0xffff_ffff, 0x7fff_ffff, 123_456_789];
        for len in 0..=200usize {
            let prefix: Vec<u8> = (0..len).map(|i| (i.wrapping_mul(31) + 7) as u8).collect();
            let mut hasher = PowHasher::from_prefix(&prefix);
            for nonce in nonces {
                assert_eq!(
                    hasher.hash(nonce),
                    reference_sha256d(&prefix, nonce),
                    "prefix_len={len} nonce={nonce}"
                );
            }
        }
    }

    #[test]
    fn bitcoin_genesis_header_sha256d() {
        // Vektor primitif eksternal: header genesis Bitcoin 80 byte.
        let prefix = hex_to_bytes(BITCOIN_GENESIS_PREFIX).unwrap();
        let mut hasher = PowHasher::from_prefix(&prefix);
        assert_eq!(
            to_hex(&hasher.hash(BITCOIN_GENESIS_NONCE)),
            BITCOIN_GENESIS_HASH
        );
    }

    #[test]
    fn changing_nonce_mid_run_keeps_slot_and_padding_clean() {
        let prefix: Vec<u8> = (0..137u32).map(|i| (i * 7 + 3) as u8).collect();
        let mut hasher = PowHasher::from_prefix(&prefix);
        for nonce in [
            0u32,
            1,
            9,
            10,
            99,
            100,
            0xffff,
            0x1_0000,
            0x7fff_ffff,
            0xffff_fffe,
            0xffff_ffff,
            0,
        ] {
            assert_eq!(
                hasher.hash(nonce),
                reference_sha256d(&prefix, nonce),
                "nonce={nonce}"
            );
        }
    }

    #[test]
    fn rejects_invalid_payloads() {
        let valid = payload_bytes(PARITY_VECTORS[0].0);

        assert!(PowHasher::new(&valid[..valid.len() - 1]).is_err()); // terlalu pendek

        let mut bad_magic = valid.clone();
        bad_magic[0] ^= 0xff;
        assert!(PowHasher::new(&bad_magic).is_err());

        let mut bad_layout = valid.clone();
        bad_layout[4] = 1;
        assert!(PowHasher::new(&bad_layout).is_err());

        let mut bad_length = valid.clone();
        bad_length[191] = 1; // extraDataLen 1, tapi tidak ada byte tambahan
        assert!(PowHasher::new(&bad_length).is_err());

        assert!(PowHasher::new(&valid).is_ok());
    }

    #[test]
    #[ignore = "benchmark: cargo test --release -- --ignored --nocapture"]
    fn throughput() {
        // Payload blok nyata: 209 byte (extraData 12 byte), prefix 205 byte.
        let payload = payload_bytes(PARITY_VECTORS[3].0);
        let mut hasher = PowHasher::new(&payload).unwrap();
        for n in 0..100_000u32 {
            hasher.hash(n);
        }
        let total = 3_000_000u32;
        let started = std::time::Instant::now();
        for n in 0..total {
            hasher.hash(n);
        }
        let secs = started.elapsed().as_secs_f64();
        println!(
            "payload {} byte (prefix {} byte, sisa {}) | SHA256d | 1 thread | {:.2} MH/s",
            payload.len(),
            payload.len() - 4,
            (payload.len() - 4) % 64,
            total as f64 / secs / 1e6
        );
    }
}
