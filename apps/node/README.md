# apps/node — Node (titik jalan)

Server JSON-RPC NexChain. Ini proses utama yang menjalankan blockchain.

## Entry point

- `server.ts` — dijalankan oleh `bun run node:start` (script root:
  `bun run apps/node/server.ts`). Membuat genesis bila DB kosong, lalu melayani
  `POST /rpc`.

## Cara menjalankan

```bash
cp .env.example .env
bun run node:start
```

## Bergantung pada

`src/rpc` (handler), `src/core` (mesin blockchain), `src/logging`.
