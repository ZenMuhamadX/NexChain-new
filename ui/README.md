# NexChain Explorer — Stage 2

A React and TypeScript foundation for direct, read-only NexChain JSON-RPC access.

## Run

Optionally copy `.env.example` to `.env` to configure the endpoint, then run:

```bash
bun install
bun run dev
```

The default is `http://127.0.0.1:9000/rpc`. The repository's existing RPC server currently listens on port `8000`; use `VITE_NEXCHAIN_RPC_URL=http://127.0.0.1:8000/rpc` when running that server unchanged.

The explorer checks `nex_getChainId` and polls `nex_getCurrentBlock` every three seconds. It exposes dashboard, block-list, block-height, and block-hash routes, and never creates wallets or submits transactions.
