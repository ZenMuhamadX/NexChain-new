/**
 * Plafon ukuran & jumlah transaksi per blok — dipakai DUA sisi yang harus
 * selalu sepakat:
 *
 *   - sisi PEMBUAT template (`prioritizeByFeeRate` di `work.ts`): anggaran
 *     pemotongan himpunan tx;
 *   - sisi VERIFIER (`verifyStruct.ts`): sejak C1 angka yang sama diverifikasi
 *     keras — `size` wajib ≤ `MAX_BLOCK_WIRE_BYTES` dan `size` wajib sama
 *     dengan Σ byte wire tx (`encodeTxPayload`), jumlah tx wajib ≤
 *     `MAX_TX_PER_BLOCK`.
 *
 * Modul ini netral (tanpa impor apa pun) supaya `verifyStruct` bisa memakainya
 * tanpa siklus: rantai `work.ts → verifyIntegrity → verifyStruct` sudah ada,
 * jadi verifyStruct TIDAK boleh mengimpor `work.ts`.
 */

/**
 * Anggaran ukuran wire transaksi PENGGUNA per blok, dalam byte. Coinbase di
 * luar hitungan (bukan tx di `transactions`); `size` blok memakai satuan yang
 * SAMA (lihat `createBlockTemplate`), sehingga `size ≤ MAX` berlaku by
 * construction pada template produksi.
 *
 * 100 kB ≈ 1.000 tx minimum (~96 byte); P2P masih jauh di bawah plafon
 * framing (1 MiB), jadi tidak ada yang perlu ikut berubah di wire.
 */
export const MAX_BLOCK_WIRE_BYTES = 100 * 1000

/**
 * Batas JUMLAH transaksi pengguna per blok (konsensus sejak C1).
 *
 * Mengapa perlu selain batas byte: tanpa ini, 100 kB bisa diisi >1.000 tx
 * minimum-size (~96 byte → ≈1.041) — sah menurut byte tapi membuat verifier
 * dan pemroses blok bekerja lebih banyak per byte (hash merkle per tx).
 * Dipilih bulat 1.000; cap ini DIJALANKAN di `prioritizeByFeeRate` (pemotongan
 * per-antrean-pengirim), BUKAN dengan menyayat `transactions` di template —
 * sayatan sembarangan akan memutus kontiguitas nonce per pengirim (konsensus).
 */
export const MAX_TX_PER_BLOCK = 1000
