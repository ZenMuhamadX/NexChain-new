//! Salinan aturan `meetsDifficulty` node (`src/core/consensus/difficulty.ts`).
//!
//! `bits` adalah compact target ala Bitcoin: eksponen 1 byte + mantissa 23 bit,
//! `target = mantissa << 8*(eksponen-3)`. `hash` adalah digest SHA256d 32 byte
//! big-endian apa adanya (NexChain tidak memakai pembalikan urutan byte ala
//! Bitcoin); lolos bila `hash <= target`. Perbandingan langsung pada byte,
//! tanpa mengubah hash ke hex.

/// Apakah hash memenuhi compact `bits`? Satu-satunya definisi "kerja cukup".
pub fn meets_difficulty(hash: &[u8; 32], bits: u32) -> bool {
    if bits & 0x800000 != 0 {
        return false
    }
    let exponent = (bits >> 24) as usize;
    let mantissa = bits & 0x7fffff;
    if !(3..=32).contains(&exponent) || mantissa == 0 {
        return false
    }

    let mut target = [0u8; 32];
    let start = 32 - exponent;
    let m = mantissa.to_be_bytes();
    target[start] = m[1];
    target[start + 1] = m[2];
    target[start + 2] = m[3];

    hash <= &target
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unhex(hex: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    /// Dihasilkan dari `meetsDifficulty` JS; drift antara node dan miner
    /// harus gagal di sini, bukan setelah nonce ditemukan lalu ditolak node.
    const VECTORS: &[(&str, u32, bool)] = &[
        (
            "00000f7117e28ab1237b19406c6ad9dc120f3597c25436409d1c6f227e4e0b09",
            0x1e100000,
            true,
        ),
        (
            "00000f7117e28ab1237b19406c6ad9dc120f3597c25436409d1c6f227e4e0b09",
            0x1e0f0000,
            false,
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            0x1e100000,
            false,
        ),
        (
            "0000000000000000000000000000000000000000000000000000000000000001",
            0x20010000,
            true,
        ),
    ];

    #[test]
    fn parity_with_node() {
        for (hex, bits, expected) in VECTORS {
            assert_eq!(meets_difficulty(&unhex(hex), *bits), *expected);
        }
    }

    #[test]
    fn rejects_invalid_bits() {
        let h = unhex("0000000000000000000000000000000000000000000000000000000000000000");
        assert!(!meets_difficulty(&h, 0x1e900000)); // bit tanda mantissa
        assert!(!meets_difficulty(&h, 0x02100000)); // eksponen < 3
        assert!(!meets_difficulty(&h, 0x1e000000)); // mantissa 0
    }
}
