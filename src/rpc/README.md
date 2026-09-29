# src/rpc — JSON-RPC

Implementasi protokol JSON-RPC node. Dipakai oleh `apps/node/server.ts`.

## File utama

- `method.ts` — daftar & handler method (`nex_getWork`, `nex_submitWork`, `nex_getBalance`, `nex_getChainId`, `nex_getBlockByHeight`, …).
- `app/app.ts` — wiring HTTP (Express) di `POST /rpc`.
- `middleware/` — logging & rate limit.

## Konvensi hasil

Sengaja heterogen: method state lama mengembalikan JSON hex-encoded,
`nex_getBalance` hex string, `nex_getChainId` numerik, method explorer/mempool
baru JSON polos. Bila menambah method, perbarui decoder di
`explorer/src/api/methods.ts` dan smoke coverage terkait.
