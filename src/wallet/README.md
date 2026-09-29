# src/wallet — Akun & Wallet

Manajemen akun/wallet: membuat, memuat, menyimpan, saldo, dan backup. Dulu
berada di `account/`.

## File utama

- `createNewWallet.ts` — buat wallet baru.
- `loadWallet.ts` / `loadWalletConf.ts` / `setWalletConf.ts` — konfigurasi & pemuatan.
- `balance/` — baca/tulis saldo akun (`getAccount.ts`, `putAccount.ts`, `putNewAccount.ts`).
- `backup/` — ekspor/impor wallet.
- `utils/` — helper (`processPubKey.ts`, dll).

## Hubungan

Memakai `src/crypto` (signature/address) dan `src/types` (tipe akun). Node
membutuhkan wallet primer (`config/wallet.conf.json`, default `main`) agar genesis
dan penandatanganan hasil mining berjalan.
