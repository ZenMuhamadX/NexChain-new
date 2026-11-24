# wallet-new/

An MV3 popup wallet for NexChain, rebuilt from `docs/WALLET_DATA_CONTRACT.md`.
The package is standalone with its own `bun.lock`. `wallet/` remains as an
archive and is not used as a UI reference.

## Principles

- Every key, RLP codec, unit, and validation rule comes from the canonical root
  modules through the `src/*` alias in `tsconfig.json` and `vite.config.ts`.
  No crypto copies live here.
- `src/index.ts` is the only core export surface for the shell.
- `src/sendFlow.ts` and `src/rpc.ts` hold the fixed-point fee, RBF, and the RPC
  write path with Basic Auth.
- The vault uses `createIdbKV()` from the root. This shell is popup-only with
  no background worker, so no `chrome.storage` adapter is needed.
- Passphrases and RPC credentials are never sent anywhere. Only the mnemonic is
  encrypted in the vault; the private key is re-derived on unlock. RPC
  credentials are stored locally in extension `localStorage`, not in the vault.
- Settings can reveal the seed phrase and private key, but only after the
  passphrase is entered again. The reveal path reads the unlocked vault in
  memory, makes no network call, offers no Copy action, and auto-hides.

## Commands

```bash
bun install
bun run check       # coreCheck + uiCheck + typecheck + build + shellCheck
bun run typecheck
bun run dev         # preview the UI at http://localhost:5184
bun run build       # MV3 artifacts in dist/
bun run preview
```

`bun run check` is fully offline. The gates do not touch LevelDB, do not need a
node, and do not send transactions. `fetch` is stubbed to prove the RPC method,
params, and headers.

## Load the extension

1. `bun run build`
2. Open `chrome://extensions` and enable Developer mode.
3. Choose Load unpacked and select `wallet-new/dist`.
4. Click the extension icon. For a node outside localhost, set the RPC URL in
   Settings. Chromium asks for the origin permission when you press Save.

The default permissions are only `http://localhost:8000/*` and
`http://127.0.0.1:8000/*`. There is no `<all_urls>`.

## UI direction

See `DESIGN.md` for the dial, color tokens, radius, motion, and UI states. The
screens are Welcome, Setup, Import, Unlock, Home, Send, Receive, History, and
Settings. Send uses a bottom sheet; Receive is a full-screen view with a QR code
from the `qrcode` library (error correction H) and the NXC ticker in its centre.
The official brand and NXC ticker SVGs come from the shared `brand/asset/` kit
through relative imports, so the popup ships them as local assets with no
duplicated source file.

`scripts/clickThrough.mjs` is the R-35 click evidence. Run it through the
Playwright browser tool against `vite preview`, with every RPC stubbed in the
browser.

## Not included

A dApp provider is outside this popup. Toolbar icons and a crypto worker are
intentionally deferred until there is a real need.
