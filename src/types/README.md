# src/types — Tipe Domain Terpusat

Satu sumber kebenaran untuk semua bentuk data. Dulu berada di `interface/`.
Impor tipe dari sini; jangan menduplikasi definisi di modul lain.

## File utama

- `transaction.ts`, `compositeTransaction.ts` — transaksi.
- `block.ts`, `header.ts`, `metadata.ts`, `coinbaseTransaction.ts` — blok.
- `balance.ts` — saldo akun.
- `defaultConfig.ts`, `walletToSave.ts`, `walletConfig.ts`, `privateData.ts` — konfigurasi & penyimpanan wallet.

## Hubungan

Diimpor lintas `src/core`, `src/client`, dan frontend (`explorer`, `wallet`).
Mengubah tipe di sini berdampak ke banyak modul — selalu jalankan
`bun run check` setelah mengubahnya.
