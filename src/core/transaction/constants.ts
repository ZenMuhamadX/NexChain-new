/**
 * Konstanta protokol transaksi.
 *
 * Berbeda dari `src/core/token/constants.ts` yang mengatur satuan & suplai,
 * file ini memuat nilai yang menjadi bagian dari **preimage hash transaksi**.
 *
 * `DEFAULT_EXTRA_MESSAGE` ikut di-hash di `createTxnHash` — artinya mengubah
 * satu karakter di sini mengubah txHash SETIAP transaksi, termasuk yang sudah
 * ada di rantai. Perlakukan sebagai konstanta protokol, bukan teks promosi.
 *
 * Sebelumnya konstanta ini tinggal di `src/client/lib/createUnsignedTransaction`
 * (modul client). Ia dipindah ke `core/` karena dipakai juga oleh codec wire
 * (`core/encoding/rlp/txCodec`) — dan `core/` tidak boleh bergantung ke
 * `client/`, hanya sebaliknya.
 */

/** Pesan default yang dibawa transaksi bila pengirim tidak menulis pesan. */
export const DEFAULT_EXTRA_MESSAGE =
	'NexChains A Next Generation Blockchain for Everyone'
