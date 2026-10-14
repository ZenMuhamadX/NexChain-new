# Jalur Belajar NexChain (untuk kontributor baru)

Urutan ini dirancang supaya kamu paham sistem dari dalam ke luar, tanpa harus
membaca seluruh kode. Tiap langkah menyebutkan file nyata yang ada sekarang.

## 0. Mulai dari sini

- [`docs/README.md`](./README.md) — peta folder & cara menjalankan.
- [`docs/GLOSSARY.md`](./GLOSSARY.md) — istilah yang dipakai berulang.

## 1. Tipe domain (dasar segalanya)

Baca dulu bentuk data sebelum logikanya.

- `src/types/transaction.ts` — struktur transaksi & composite transaction.
- `src/types/block.ts` — header blok, metadata, coinbase.
- `src/types/balance.ts`, `src/types/header.ts` — tipe pendukung.

## 2. Kriptografi (trust & identity)

- `src/crypto/ecc.ts` — kurva eliptik (secp256k1).
- `src/crypto/createSignature.ts` / `verifySignature.ts` — tanda tangan.
- `src/crypto/generateAddressFromPublicKey.ts` — alamat `NxC…`.
- `src/crypto/generateKeyFromMnemonic.ts` / `generateRandomMnemonic.ts` — wallet seed.

## 3. Blok & transaksi (inti domain)

- `src/core/block/blockModel.ts` — definisi & helper blok.
- `src/core/transaction/createTransactionHash.ts` — hashing transaksi.
- `src/core/transaction/processTransaction.ts` — eksekusi transaksi ke state.
- `src/core/transaction/createCoinbaseTransaction.ts` — reward miner.
- `src/core/transaction/memPool.ts` — mempool (antrean tx sebelum masuk blok).

## 4. Consensus / Penambangan (PoW)

- `src/core/consensus/difficulty.ts` — penyesuaian kesulitan.
- `src/core/consensus/Pow.ts` — proof-of-work.
- `src/core/consensus/work.ts` — siklus kerja miner↔node.
- `src/core/consensus/verify/verifyIntegrity.ts` — verifikasi blok (PoW + hash chain + merkle + struktur).

## 5. State & Storage (persistence)

- `src/core/state/db/` — akses leveldb.
- `src/core/state/storage/state/` — penyimpanan state akun & saldo.
- `src/core/state/storage/block/` — penyimpanan blok.
- `src/core/state/storage/mempool/` — penyimpanan mempool.

## 6. Blockchain (menyatukan semua)

- `src/core/blockchain/blockchain.ts` — hubungkan blok, jaga konsistensi rantai.

## 7. RPC (antarmuka eksternal)

- `src/rpc/method.ts` — daftar method JSON-RPC (`nex_getWork`, `nex_submitWork`, `nex_getBalance`, …).
- `src/rpc/app/app.ts` — wiring HTTP (Express).
- `src/rpc/middleware/` — middleware (logging, rate limit).

## 8. Jaringan P2P (opsional)

- `src/p2p/README.md` — peta lapisan; mulai dari sini.
- `src/p2p/node.ts` — orkestrator `startP2P()` (merangkai transport, peer, sync).
- `src/core/events/nodeEvents.ts` — bus netral core→P2P (core TIDAK pernah mengimpor `src/p2p/`).

## 9. Klien bersama

- `src/client/lib/createTransaction.ts` — buat transaksi (dipakai UI & tes).
- `src/client/rpc-client/` — pemanggil RPC (node & browser).
- `src/client/wallet/` — vault browser (crypto di sisi klien).

## 10. Titik jalan (entry points)

- `apps/node/server.ts` — jalankan node (`bun run rpc:start`).
- `apps/miner/miner.ts` — miner CLI (`bun run apps/miner/miner.ts "<addr>"`).
- `apps/miner/runMiner.ts` — library `runMiner` (bisa dipanggil dari skrip E2E).

## 11. Frontend (opsional)

- `wallet/` — dompet React (konsumsi `src/core` lewat alias; satu sumber kode,
  beberapa shell: `shells/dev` + `shells/desktop`).
- `miner-ui/` — UI miner React (memanggil method miner lewat RPC).
- `explorer/` — explorer blok (hanya impor tipe dari `src/types`).

## Tips

- Setiap modul punya `README.md` singkat yang menjelaskan tanggung jawab & file utamanya.
- Jalankan `bun run check` setiap selesai mengubah kode inti untuk memastikan tipe tetap konsisten.
- Ganti kesulitan/genesis hanya lewat `.env` / konstanta di `src/core/block/genesis.ts`, lalu verifikasi dengan `bun run genesis:check`.
