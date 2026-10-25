# NexChain — Arsitektur & Navigasi Kode

Dokumen ini untuk siapa pun yang baru membuka repositori NexChain dan ingin
memahami **struktur folder**, **tanggung jawab tiap modul**, dan **cara
menjalankan node** dengan cepat. Untuk jalur belajar berurutan, baca
[`LEARNING_PATH.md`](./LEARNING_PATH.md); untuk istilah, lihat
[`GLOSSARY.md`](./GLOSSARY.md).

## Mental model singkat

NexChain adalah node blockchain **Proof-of-Work (gaya Bitcoin)** dengan
arsitektur *"inti terpisah + miner independen + frontend terpisah"*:

- **Inti (`src/`)** — mesin blockchain murni, tanpa titik jalan. Semua logika
  domain tinggal di sini.
- **App (`apps/`)** — titik jalan (*entry point*): `apps/node` (server RPC),
  `apps/miner` (miner eksternal mandiri, Bun) dan `apps/miner-rs` (miner Rust
  native yang jauh lebih cepat).
- **Frontend (`explorer/`, `wallet/`)** — paket Vite/React
  independen yang mengonsumsi modul inti lewat *alias* (tidak menduplikasi
  logika kripto/transaksi).
- **`wallet/`** — dompet, **khusus desktop**. Satu direktori berisi satu
  sumber kode (`src/`) dan beberapa *shell* (`shells/dev`, `shells/desktop`)
  yang menyuntikkan backend penyimpanan, URL RPC, dan kelas perangkat. Lihat
  [`wallet/README.md`](../wallet/README.md) dan bagian `wallet/` di
  `AGENTS.md`. Ekstensi browser sudah dipensiunkan (`wallet-ext/` dihapus).

> **Tidak ada jaringan P2P.** Antarmuka jaringan yang diimplementasikan adalah
> HTTP JSON-RPC plus miner eksternal. Node tidak pernah menghitung PoW sendiri.

## Peta modul — `src/`

| Folder                  | Tanggung jawab                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| `src/core/`             | Mesin blockchain: blok, blockchain, transaksi, consensus, state, encoding, token, validasi. |
| `src/core/block/`       | Pembuatan & validasi struktur blok (incl. `blockModel.ts`).                    |
| `src/core/blockchain/`  | Rantai: hubungkan blok, simpan ke storage, jaga state.                         |
| `src/core/transaction/` | Siklus transaksi: buat, proses, coinbase, mempool, sender/receiver.           |
| `src/core/consensus/`   | Penambangan & verifikasi PoW (`difficulty`, `Pow`, `work`, `verify/`).         |
| `src/core/state/`       | Penyimpanan leveldb: `db/` (akses) dan `storage/` (block/state/mempool).       |
| `src/core/encoding/`    | Hex, sha256, keccak256, helper `lib/` (format, ukuran, timestamp).             |
| `src/core/token/`       | Nexucoin: konversi nexu ↔ NxC, formatting.                                    |
| `src/core/validation/`  | Validator transaksi & modul bantu (`joi/`, `module/`).                        |
| `src/core/state/account/` | Ledger on-chain: saldo & nonce semua alamat (`getAccount`/`putAccount`). |
| `src/crypto/`           | Kriptografi: ECC, signature, address, mnemonic, hash.                         |
| `src/types/`            | Tipe domain terpusat (transaction, block, balance, header, …).                |
| `src/client/`           | Klien bersama: buat transaksi, rpc-client, vault browser.                     |
| `src/rpc/`              | Implementasi JSON-RPC (method, app, middleware).                              |
| `src/logging/`          | Logging terstruktur (console, error, debug, mine log).                        |

## Peta app — `apps/`

| Folder         | Tanggung jawab                                                              |
| -------------- | -------------------------------------------------------------------------- |
| `apps/node/`   | **Node**. `server.ts` menjalankan HTTP JSON-RPC di `POST /rpc`, membuat genesis bila kosong. Jalankan: `bun run node:start`. |
| `apps/miner/`  | **Miner eksternal**. `miner.ts` (CLI interaktif) dan `runMiner.ts` (library `runMiner`). Jalankan: `bun run apps/miner/miner.ts "<alamatNxC>"`. |
| `apps/miner-rs/` | **Miner Rust native**. Hanya loop PoW (midstate SHA-256) di atas RPC yang sama. Jalankan: `bun run miner:rs -- --address NxC…` (atau `cargo run --release --manifest-path apps/miner-rs/Cargo.toml -- --address NxC…`). |

## Cara menjalankan (devnet lokal)

```bash
# 1. siapkan env
cp .env.example .env

# 2. jalankan node (terminal A)
bun run node:start

# 3. jalankan miner eksternal (terminal B)
bun run apps/miner/miner.ts "NxC…alamatRewardKamu"
```

Frontend: `bun run wallet:dev` (port 5174) dan `bun run explorer:dev` (port 5173).

## Konvensi impor

Semua impor di dalam `src/`/`apps/`/`scripts/` menggunakan **specifier bare**
relatif terhadap root repo, bukan relatif (`./`, `../`):

```ts
import { Block } from 'src/core/block/blockModel'
import { runMiner } from 'apps/miner/runMiner'
```

Ini diselesaikan lewat `paths` di `tsconfig.json` root (`"*": ["./*"]`) dan
melalui `ROOT_MODULES` di `wallet/vite.config.ts`. Bila menambah modul baru
di bawah `src/`, langsung bisa diimpor secara bare — tidak perlu mengubah path.

## Catatan `wallet/` — satu sumber, beberapa shell

`wallet/` hanya punya **satu** salinan kode (`src/`), dan setiap *shell* di
`shells/` menyuntikkan tiga hal sebelum render:

| Titik suntik | Berkas | Shell dev | Shell desktop |
| ------------ | ------ | --------- | ------------- |
| Backend vault | `src/lib/vaultStore.ts` | `VITE_VAULT_BACKEND=memory` | `installVaultKV()` backend berkas |
| URL RPC | `src/lib/rpcUrl.ts` | ikut hostname / `localStorage` | `initRpcUrl()` dari bridge |
| Kelas perangkat | `src/lib/deviceCrypto.ts` | heuristik navigator | `installDeviceClass('desktop')` |

**Jangan** membuat *vendor snapshot*: `wallet/` dibangun di dalam repo ini,
jadi ia mengalias `src/` root secara langsung. Snapshot (pola `wallet-ext/`
yang sudah dihapus) berarti ada salinan kripto basi yang bisa menyimpang dari
inti — justru itu yang ingin dihindari.
