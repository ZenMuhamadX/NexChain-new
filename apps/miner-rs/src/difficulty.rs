//! Salinan aturan `meetsDifficulty` node (`src/core/consensus/difficulty.ts`).
//!
//! Dipakai langsung pada digest 32 byte (bukan string hex) supaya jalur panas
//! tidak perlu mengubah digest jadi hex. Aturannya SAMA PERSIS, termasuk bit
//! pecahan 0.25: syaratnya bukan "jumlah leading zero bit", melainkan
//! `nibble < 2^(4-remainder)` — jadi bits 20.25 menerima nibble 13.

/// Apakah `hash` memenuhi difficulty `bits`? Satu-satunya definisi "kerja cukup".
pub fn meets_difficulty(hash: &[u8; 32], bits: f64) -> bool {
    if !bits.is_finite() {
        return false;
    }
    if bits <= 0.0 {
        return true;
    }

    let zero_digits = (bits / 4.0).floor();
    if zero_digits > 64.0 {
        return false;
    }
    let zero_digits = zero_digits as usize;

    for i in 0..zero_digits {
        let byte = hash[i / 2];
        let nibble = if i % 2 == 0 { byte >> 4 } else { byte & 0x0f };
        if nibble != 0 {
            return false;
        }
    }
    // bits == 256 → seluruh 64 nibble harus nol; tidak ada sisa untuk dicek.
    if zero_digits == 64 {
        return hash.iter().all(|byte| *byte == 0);
    }

    let remainder = bits - zero_digits as f64 * 4.0;
    if remainder > 0.0 {
        let byte = hash[zero_digits / 2];
        let nibble = if zero_digits % 2 == 0 {
            byte >> 4
        } else {
            byte & 0x0f
        };
        if (nibble as f64) >= 2f64.powf(4.0 - remainder) {
            return false;
        }
    }
    true
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

    /// Dihasilkan dari `meetsDifficulty` JS (sumber kebenaran node), termasuk
    /// batas pecahan 0.25 di mana nibble 13 masih diterima.
    const VECTORS: &[(&str, f64, bool)] = &[
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            0.0,
            true,
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.0,
            false,
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.25,
            false,
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            47.75,
            false,
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            48.0,
            false,
        ),
        (
            "00000dffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.25,
            true,
        ),
        (
            "00000effffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.25,
            false,
        ),
        (
            "00000bffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.5,
            true,
        ),
        (
            "00000cffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.5,
            false,
        ),
        (
            "000009ffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.75,
            true,
        ),
        (
            "00000affffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.75,
            false,
        ),
        (
            "000007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            21.0,
            true,
        ),
        (
            "000008ffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            21.0,
            false,
        ),
        (
            "00000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.0,
            true,
        ),
        (
            "0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            20.0,
            false,
        ),
        (
            "0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            4.0,
            true,
        ),
        (
            "1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            4.0,
            false,
        ),
        (
            "000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffff",
            48.0,
            true,
        ),
        (
            "000000000001ffffffffffffffffffffffffffffffffffffffffffffffffffff",
            48.0,
            false,
        ),
        (
            "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
            1.0,
            true,
        ),
        (
            "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
            0.25,
            true,
        ),
        (
            "1bc594ab02ae05d2ad519258bf26d18bf7e59d776e6e0e06de457a45de5ec935",
            0.0,
            true,
        ),
        (
            "0000abcd00000000000000000000000000000000000000000000000000000000",
            17.5,
            false,
        ),
        (
            "0000abcd00000000000000000000000000000000000000000000000000000000",
            17.75,
            false,
        ),
    ];

    #[test]
    fn matches_node_vectors() {
        for (hex, bits, expected) in VECTORS {
            assert_eq!(
                meets_difficulty(&unhex(hex), *bits),
                *expected,
                "hash={hex} bits={bits}"
            );
        }
    }

    #[test]
    fn non_finite_and_non_positive() {
        let h = unhex("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        assert!(!meets_difficulty(&h, f64::NAN));
        assert!(!meets_difficulty(&h, f64::INFINITY));
        assert!(meets_difficulty(&h, -1.0));
        assert!(meets_difficulty(&h, 0.0));
    }

    #[test]
    fn all_zero_hash_passes_everything() {
        let zero = [0u8; 32];
        assert!(meets_difficulty(&zero, 48.0));
        assert!(meets_difficulty(&zero, 20.25));
    }
}
