# src/client — Klien Bersama

Kode yang dipakai bersama antara node, browser, dan tes: pembuatan transaksi,
pemanggil RPC, dan vault browser.

## Sub-modul

- `lib/` — `createTransaction.ts`, `createUnsignedTransaction.ts`, `clientValidateTx.ts`, `clientHasSufficient.ts`.
- `rpc-client/` — `controller/` (handler `POST/sendTx`, `rpcGetAccount`, `rpcGetNonce`, `rpcGetPendingReserve`) + `lib/` (`rpcClient.ts`, `rpcRequest.ts`, `decodeHexJson.ts`).
- `wallet/` — `vaultCrypto.ts`, `walletVault.ts`, `kv.ts`, `idbKv.ts` (penyimpanan sisi klien).

## Hubungan

Memakai `src/core` (transaksi), `src/crypto`, dan `src/types`. `rpc-client` bicara
ke `apps/node` lewat HTTP JSON-RPC. `wallet/` dirancang agar bisa berjalan di
browser (tanpa Node built-in).
