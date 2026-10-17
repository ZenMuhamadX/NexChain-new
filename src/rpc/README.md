# src/rpc — JSON-RPC

Implementasi protokol JSON-RPC node. Dipakai oleh `apps/node/server.ts`.

## File utama

- `method.ts` — daftar & handler method (`nex_getWork`, `nex_submitWork`, `nex_getBalance`, `nex_getChainId`, `nex_getBlockByHeight`, …).
- `app/app.ts` — wiring HTTP (Express) di `POST /rpc`.
- `middleware/` — logging & rate limit.

## Konvensi hasil

Semua hasil RPC sekarang JSON polos (tanpa envelope hex). Bila menambah
method, perbarui decoder di `explorer/src/api/methods.ts` dan smoke coverage
terkait.
