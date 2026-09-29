# AGENTS.md

## Project shape

- This is a Bun-run TypeScript blockchain node with no root workspace config. The root lockfile is intentionally ignored; `explorer/` and `wallet-ui/` are independent Vite/React packages with their own `bun.lock`. Install the root, then run `bun install` in each UI directory.
- Despite the README's P2P wording, the implemented node network surface is HTTP JSON-RPC plus external miners; there is no `p2p/` implementation.
- `apps/node/server.ts` is the node entrypoint (`bun run rpc:start`, which runs `bun run apps/node/server.ts`) and serves JSON-RPC at `POST /rpc`; it attempts to create genesis on startup when the chain is empty. `apps/miner/miner.ts` is the runnable external miner (`bun run apps/miner/miner.ts`); `apps/miner/runMiner.ts` only exports `runMiner` and is not a CLI entrypoint.
- The shared/core modules now live under `src/`: `src/core/` (the blockchain engine — was `nexchain/`), `src/wallet/` (accounts — was `account/`), `src/crypto/` (key + sign), `src/client/`, `src/types/` (was `interface/`), `src/logging/`, and `src/rpc/`. Runnable apps live under `apps/`: `apps/node/` (the node) and `apps/miner/` (the standalone miner). `explorer/` (Vite port 5173) and `wallet-ui/` (port 5174) are independent frontends; the root `tsconfig.json` excludes both plus `wallet-ext/`.
- There is no wired top-level wallet-bootstrap command: `nex_createWallet` exists, but ensure the node wallet file (`wallet/main.json` by default) exists before expecting genesis or mining to work.
- Mining is intentionally outside the node: the miner gets `nex_getWork`, hashes the payload and nonce, then submits `nex_submitWork`; the node verifies the work and signs with its own wallet. The miner needs only the RPC URL and reward address. `apps/miner/miner.ts` is intentionally standalone and duplicates the difficulty, hash, and address rules; synchronize it manually with the canonical `src/core/` modules when those rules change.

## Commands

- `bun run check` is the root `bunx tsc` typecheck, then deletes `dist` on success; `bun run build` emits root `dist`. Neither runs the regression gates or either UI.
- Core gates: `bun run check:browser`, `bun run check:tx`, `bun run check:wallet`, and `bun run check:difficulty`. The browser gate checks bundling, tx/difficulty are offline, and the wallet gate uses memory plus `fake-indexeddb` without needing a node. `check:tx` asserts the localhost default, so unset `NEX_RPC_URL` (including a value loaded from `.env`) before running it. `check:browser` ends with POSIX `rm -f`; verify cleanup on Windows if the shell does not provide it.
- Frontends: `bun run explorer:dev`, `bun run explorer:build`, `bun run --cwd explorer typecheck`, `bun run --cwd explorer audit:ui`, `bun run --cwd explorer smoke`; and `bun run wallet:dev`, `bun run wallet:build`, `bun run wallet:typecheck`, `bun run wallet:smoke`. UI `build` scripts run `tsc --noEmit` before Vite; `audit:ui` is static contrast/class coverage. `explorer smoke` needs a live RPC with at least five blocks; `wallet:smoke` is local and does not touch LevelDB or send transactions.
- There is no `test` or `lint` script/framework, and the Husky pre-commit hook is only a shebang (there are no GitHub workflows). `scripts/vaultBench.ts` is a benchmark, not a correctness test; `scripts/e2ePostRemoval.ts` mutates a funded live node (mempool, balances, and chain) and currently spawns a missing `mine.ts`, so neither is a routine check.
- Formatting is `bun run format` (Prettier: tabs, no semicolons, single quotes, trailing commas, width 80); use focused `bunx prettier --write <files>` when possible.

## RPC contracts

- RPC results are deliberately heterogeneous: legacy account/state methods return hex-encoded JSON, `nex_getBalance` returns a hex string, `nex_getChainId` is numeric, and newer explorer/mempool methods return plain JSON. When adding or changing a method, update the matching decoder in `explorer/src/api/methods.ts` and the relevant smoke coverage.

## Runtime and data

- Copy the root `.env.example` to `.env`. `apps/node/server.ts` loads the working-directory `.env`; `NEX_RPC_PORT` (or `PORT`) defaults to 8000 and `RPC_BIND_HOST` defaults to `127.0.0.1`. Use `0.0.0.0` only when another LAN host must reach the RPC.
- The shared Node/Bun client and `apps/miner/runMiner.ts` use `NEX_RPC_URL` (default `http://localhost:8000/rpc`); `apps/miner/miner.ts` ignores that variable and always prompts for its URL. Vite apps use build-time `VITE_RPC_URL`; wallet also accepts optional `VITE_EXPLORER_URL` (or a Settings/localStorage override) for confirmed transaction links. Explorer requires `explorer/.env`; wallet env is optional, with runtime priority `localStorage` override → `VITE_RPC_URL` → page-host fallback.
- Level stores are created under ignored `base/{block,state,memPool,history,storeData}`. Do not commit `base`, `wallet`, `config`, `logs`, or `dist`; `wallet/<primary>.json` contains the node mnemonic.
- The node wallet is file-based: `config/wallet.conf.json` selects the primary wallet (default `main`). Genesis creation and successful work submission require that wallet; RPC can still start without it, but the chain may remain empty.

## Shared browser code

- `wallet-ui` aliases the backend modules through `wallet-ui/vite.config.ts` (`ROOT_MODULES` maps `src/core`, `src/crypto`, `src/wallet`, `src/types`, `src/client`, `src/rpc`, `src/logging`) rather than duplicating crypto and transaction logic. When a new backend module under `src/` must be consumed by the UI, add it to `ROOT_MODULES` and to `wallet-ui/tsconfig.json` `paths`.
- New contributors should start with `docs/LEARNING_PATH.md`; each module carries a short `README.md` explaining its responsibility and entry points.
- Keep shared browser imports free of Node built-ins; `bun run check:browser` is the guard. Keep `wallet-ui/src/polyfill.ts` imported before wallet modules, preserve the Vite `buffer` alias, and use named `bip39` imports (the default import breaks Vite interop).
- Wallet amounts use `formatNxcCompact()`/`AmountDisplay` for primary UI; keep exact nexu values only behind the detail disclosure so mobile layouts stay readable.
