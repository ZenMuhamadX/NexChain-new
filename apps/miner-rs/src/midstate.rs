//! Midstate SHA-256 untuk loop PoW.
//!
//! Preimage = `payload ‖ String(nonce)` (desimal, tanpa padding), persis sama
//! dengan node: `sha256(`${payload}${nonce}`)`. Payload blok nyata ~567 byte =
//! 9 blok SHA-256, dan 8 blok pertama konstan untuk semua nonce. Kelas ini
//! menghitung blok konstan itu SEKALI per job, lalu tiap nonce hanya mengompres
//! ekor: 1 blok (sisa payload < 49 byte) atau 2 blok.
//!
//! Hasilnya byte-per-byte identik dengan `crypto.createHash('sha256')` di
//! `apps/miner/miner.ts`; dibuktikan `VECTORS` di bawah + `cargo test`.

use sha2::compress256;
use sha2::digest::generic_array::GenericArray;

const IV: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// Nonce dibatasi ke `Number.MAX_SAFE_INTEGER` (2^53 - 1) supaya desimalnya
/// identik dengan `String(nonce)` di JS. Batas atas eksklusif.
pub const MAX_NONCE: u64 = 1 << 53;

pub struct PowHasher {
    base_state: [u32; 8],
    payload_len: usize,
    rest_len: usize,
    /// payload tail + 16 digit nonce + padding (maks 63+16+9 = 88 → 2 blok).
    buf: [u8; 128],
    digits_len: usize,
    blocks: usize,
}

impl PowHasher {
    pub fn new(payload: &str) -> Self {
        let bytes = payload.as_bytes();
        let full = bytes.len() / 64;
        let mut base_state = IV;
        for i in 0..full {
            let block = GenericArray::clone_from_slice(&bytes[i * 64..i * 64 + 64]);
            compress256(&mut base_state, std::slice::from_ref(&block));
        }

        let mut hasher = Self {
            base_state,
            payload_len: bytes.len(),
            rest_len: bytes.len() - full * 64,
            buf: [0u8; 128],
            digits_len: 0,
            blocks: 0,
        };
        hasher.buf[..hasher.rest_len].copy_from_slice(&bytes[full * 64..]);
        hasher.reset_padding(1);
        hasher
    }

    /// Padding hanya bergeser saat JUMLAH digit nonce berubah, jadi jalur panas
    /// (panjang tetap) tidak menulis ulang nol/`0x80` tiap hash.
    fn reset_padding(&mut self, digits_len: usize) {
        let start = self.rest_len + digits_len;
        let end = if start + 9 <= 64 { 64 } else { 128 };
        self.buf[start..].fill(0);
        self.buf[start] = 0x80;
        self.digits_len = digits_len;
        self.blocks = end / 64;
    }

    pub fn hash(&mut self, nonce: u64) -> [u8; 32] {
        // Digit desimal nonce, ditulis SEBELUM padding dirapikan: reset_padding
        // menolkan mulai `rest_len + len`, jadi digit yang baru ditulis aman.
        let digits_at = self.rest_len;
        let mut tmp = [0u8; 20];
        let mut n = nonce;
        let mut len = 0;
        if n == 0 {
            tmp[0] = b'0';
            len = 1;
        } else {
            while n > 0 {
                tmp[len] = b'0' + (n % 10) as u8;
                len += 1;
                n /= 10;
            }
        }
        for i in 0..len {
            self.buf[digits_at + i] = tmp[len - 1 - i];
        }
        if len != self.digits_len {
            self.reset_padding(len);
        }

        let total_bits = (self.payload_len + len) as u64 * 8;
        let len_at = self.blocks * 64 - 8;
        self.buf[len_at..len_at + 8].copy_from_slice(&total_bits.to_be_bytes());

        let mut state = self.base_state;
        if self.blocks == 1 {
            let block = GenericArray::clone_from_slice(&self.buf[..64]);
            compress256(&mut state, std::slice::from_ref(&block));
        } else {
            let b0 = GenericArray::clone_from_slice(&self.buf[..64]);
            let b1 = GenericArray::clone_from_slice(&self.buf[64..128]);
            compress256(&mut state, &[b0, b1]);
        }

        let mut out = [0u8; 32];
        for (i, word) in state.iter().enumerate() {
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

/// Vektor referensi dihasilkan dari Bun (`node:crypto` + `String(nonce)`),
/// sumber yang sama dengan `apps/miner/miner.ts` dan `src/core/encoding/sha256.ts`.
/// Kalau salah satu sisi berubah, `self_check`/`cargo test` gagal — bukan
/// setelah nonce ditemukan lalu ditolak node.
pub const PARITY_VECTORS: &[(&str, u64, &str)] = &[
    (
        "",
        0,
        "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
    ),
    (
        "abc",
        1,
        "dbfcfd0d87220f629339bd3adcf452d083fde3246625fb3a93e314f833e20d37",
    ),
    (
        "{\"height\":1,\"tx\":[]}",
        999999,
        "74bf0b9ec851fcc17f4ff8ceb8d0339f6bcb7da429d5b2e7507c93b23a947f12",
    ),
    (
        "café-中文",
        9007199254740991,
        "1bc594ab02ae05d2ad519258bf26d18bf7e59d776e6e0e06de457a45de5ec935",
    ),
];

/// Verifikasi-diri saat startup (~mikrodetik). Menangkap binary/CPU yang
/// menghasilkan hash berbeda sebelum mining dimulai.
pub fn self_check() -> bool {
    PARITY_VECTORS.iter().all(|(payload, nonce, expected)| {
        let mut hasher = PowHasher::new(payload);
        to_hex(&hasher.hash(*nonce)) == *expected
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_hash(payload: &str, nonce: u64) -> String {
        // Referensi lambat: bangun pesan utuh lalu hash sekali. Dipakai hanya
        // untuk memastikan midstate tidak melenceng pada panjang apa pun.
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(payload.as_bytes());
        hasher.update(nonce.to_string().as_bytes());
        to_hex(&hasher.finalize())
    }

    #[test]
    fn parity_with_bun_vectors() {
        for (payload, nonce, expected) in PARITY_VECTORS {
            let mut hasher = PowHasher::new(payload);
            assert_eq!(
                to_hex(&hasher.hash(*nonce)),
                *expected,
                "payload={payload:?} nonce={nonce}"
            );
        }
    }

    #[test]
    fn midstate_matches_reference_across_lengths_and_digit_boundaries() {
        // Panjang payload menyentuh batas blok 64 byte, dan nonce menyentuh
        // batas jumlah digit (9→10, 99→100, 65535→65536, 2^32, 2^53-1).
        let payloads = [
            "",
            "a",
            &"x".repeat(55),
            &"x".repeat(56),
            &"x".repeat(63),
            &"x".repeat(64),
            &"x".repeat(65),
            &"y".repeat(130),
            "café-中文",
        ];
        let nonces = [
            0u64,
            1,
            9,
            10,
            11,
            99,
            100,
            65535,
            65536,
            4_294_967_296,
            9_007_199_254_740_991,
        ];
        for payload in payloads {
            let mut hasher = PowHasher::new(payload);
            for nonce in nonces {
                assert_eq!(
                    to_hex(&hasher.hash(nonce)),
                    reference_hash(payload, nonce),
                    "payload len={} nonce={nonce}",
                    payload.len()
                );
            }
        }
    }

    #[test]
    fn changing_nonce_length_mid_run_keeps_padding_clean() {
        // 9 → 10 → 9 → 100 → 99: panjang digit naik-turun, padding harus
        // dibersihkan ulang tiap transisi.
        let payload = "z".repeat(70);
        let mut hasher = PowHasher::new(&payload);
        for nonce in [9u64, 10, 9, 99, 100, 99, 9, 10, 1000, 999] {
            assert_eq!(
                to_hex(&hasher.hash(nonce)),
                reference_hash(&payload, nonce),
                "nonce={nonce}"
            );
        }
    }

    #[test]
    #[ignore = "benchmark: cargo test --release -- --ignored --nocapture"]
    fn throughput() {
        // Payload blok nyata (567 byte, sisa 55 byte): sisa + 7 digit + padding
        // melewati 64 byte, jadi tiap nonce butuh 2 kompresi ekor. Ini angka
        // yang jujur untuk chain nyata; payload yang sisanya < 49 byte hanya
        // butuh 1 kompresi dan bisa ~2x lebih cepat.
        let payload = r#"{"previousBlockHash":"00000f7117e28ab1237b19406c6ad9dc120f3597c25436409d1c6f227e4e0b09","timestamp":1792940078359,"version":"1.0.0","hashingAlgorithm":"SHA256","difficulty":20,"height":1,"merkleRoot":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","chainId":26,"status":"confirmed","blockReward":1250000000,"minerId":"NxCaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","totalReward":1250000000,"coinbaseTransaction":{"amount":1250000000,"receiver":"NxCaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","extraData":"0x426c6f636b20726577617264"},"transactions":[]}"#;
        let mut hasher = PowHasher::new(payload);
        for n in 0..100_000u64 {
            hasher.hash(n);
        }
        let total = 3_000_000u64;
        let started = std::time::Instant::now();
        for n in 0..total {
            hasher.hash(n);
        }
        let secs = started.elapsed().as_secs_f64();
        println!(
            "payload {} byte (sisa {}) | 1 thread | {:.2} MH/s",
            payload.len(),
            payload.len() % 64,
            total as f64 / secs / 1e6
        );
    }
}
