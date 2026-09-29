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
- **App (`apps/`)** — titik jalan (*entry point*): `apps/node` (server RPC)
  dan `apps/miner` (miner eksternal mandiri).
- **Frontend (`explorer/`, `wallet-ui/`)** — paket Vite/React independen yang
  mengonsumsi modul inti lewat *alias* (tidak menduplikasi logika kripto/transaksi).
- **`wallet-ext/`** — ekstensi browser. Menggunakan *vendor snapshot* dari inti
  (dikelola terpisah, lihat catatan di bawah).

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
| `src/wallet/`           | Akun/wallet: buat, muat, simpan, saldo, backup.                               |
| `src/crypto/`           | Kriptografi: ECC, signature, address, mnemonic, hash.                         |
| `src/types/`            | Tipe domain terpusat (transaction, block, balance, header, …).                |
| `src/client/`           | Klien bersama: buat transaksi, rpc-client, vault browser.                     |
| `src/rpc/`              | Implementasi JSON-RPC (method, app, middleware).                              |
| `src/logging/`          | Logging terstruktur (console, error, debug, mine log).                        |

## Peta app — `apps/`

| Folder         | Tanggung jawab                                                              |
| -------------- | -------------------------------------------------------------------------- |
| `apps/node/`   | **Node**. `server.ts` menjalankan HTTP JSON-RPC di `POST /rpc`, membuat genesis bila kosong. Jalankan: `bun run rpc:start`. |
| `apps/miner/`  | **Miner eksternal**. `miner.ts` (CLI interaktif) dan `runMiner.ts` (library `runMiner`). Jalankan: `bun run apps/miner/miner.ts "<alamatNxC>"`. |

## Cara menjalankan (devnet lokal)

```bash
# 1. siapkan env
cp .env.example .env

# 2. jalankan node (terminal A)
bun run rpc:start

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
melalui `ROOT_MODULES` di `wallet-ui/vite.config.ts`. Bila menambah modul baru
di bawah `src/`, langsung bisa diimpor secara bare — tidak perlu mengubah path.

## Catatan `wallet-ext/`

`wallet-ext/` tidak ikut direstrukturisasi karena memakai mekanisme *vendor
snapshot*: ia menyalin subset kode inti ke `wallet-ext/src/vendor/` lewat
`wallet-ext/scripts/snapshotVendor.ts`. Jangan ubah impor inti dari dalam
`wallet-ext/` secara manual; perbarui *entry point* snapshot tersebut bila
struktur inti berubah.
