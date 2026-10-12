# Glosarium NexChain

Istilah yang muncul berulang di kode & dokumentasi.

## Blockchain & Blok
- **Block (Blok)** — unit data berisi header, daftar transaksi, dan hash penghubung ke blok sebelumnya. Definisi: `src/core/block/blockModel.ts`.
- **Blockchain** — rantai blok yang saling terhubung via hash (`prevHash`). Orkestrasi: `src/core/blockchain/blockchain.ts`.
- **Genesis Block** — blok pertama, dikunci di kode (`src/core/block/genesis.ts`), deterministik, dan coinbase-nya dibakar ke *burned address*.
- **Header** — bagian metadata blok (hash, prevHash, merkleRoot, timestamp, nonce, difficulty).
- **Merkle Root** — hash akar dari semua transaksi dalam blok; memungkinkan pembuktian ringkas.
- **Hash Chain** — setiap blok menyimpan hash blok sebelumnya → integritas berurutan.

## Transaksi
- **Transaction (Tx)** — transfer nilai; ditandatangani oleh pengirim. Tipe: `src/types/transaction.ts`.
- **Composite Transaction** — transaksi pengirim + penerima yang digabung untuk eksekusi.
- **Coinbase Transaction** — transaksi reward pertama di tiap blok, dibayar ke miner. `src/core/transaction/createCoinbaseTransaction.ts`.
- **Mempool** — antrean transaksi yang belum masuk blok. `src/core/transaction/memPool.ts`.
- **Sender / Receiver** — logika eksekusi sisi pengirim & penerima. `src/core/transaction/sender/`, `receiver/`.

## Consensus & Penambangan
- **Consensus** — aturan persetujuan rantai. Di sini: PoW. `src/core/consensus/`.
- **Proof-of-Work (PoW)** — miner mencari nonce sehingga hash blok di bawah target kesulitan.
- **Difficulty (Kesulitan)** — target penambangan; disesuaikan berkala (*retarget*). `src/core/consensus/difficulty.ts`.
- **Nonce** — bilangan yang diubah-ubah miner sampai hash memenuhi target.
- **Miner Eksternal** — program terpisah (`apps/miner/`) yang meminta job lewat `nex_getWork` dan mengirim solusi lewat `nex_submitWork`. Node **tidak** menghitung PoW.

## Token & Unit
- **Nexucoin / NxC** — mata uang NexChain.
- **Nexu** — satuan terkecil (seperti satoshi). 1 NxC = 10^8 nexu. `src/core/token/`.
- **Burned Address** — alamat tanpa private key (`NxC0000…000`); dana terkunci selamanya (genesis coinbase).

## Identitas & Kripto
- **ECC / secp256k1** — kurva eliptik untuk kunci & tanda tangan. `src/crypto/ecc.ts`.
- **Signature** — bukti kepemilikan kunci privat atas sebuah transaksi.
- **Address (`NxC…`)** — alamat publik yang diturunkan dari public key.
- **Mnemonic** — frasa seed BIP39 untuk meregenerasi wallet.
- **Chain ID** — pengenal jaringan (`NEX_CHAIN_ID`); mencegah replay antar jaringan.

## State & Storage
- **State** — saldo & nonce tiap akun. `src/core/state/storage/state/`.
- **LevelDB** — penyimpanan persisten di bawah direktori data (`NEX_DATA_DIR`, default `./data`); satu database per store (block, history, memPool, state, storeData).
- **DB layer** — abstraksi akses leveldb. `src/core/state/db/`.

## RPC
- **JSON-RPC** — protokol panggilan jarak jauh. Endpoint node: `POST /rpc`.
- **`nex_getWork`** — miner meminta template blok + target kesulitan.
- **`nex_submitWork`** — miner mengirim header blok terselesaikan; node memverifikasi & menandatangani.
- **`nex_getBalance`** — tanya saldo (hex string).
- **`nex_getChainId`** — tanya chain ID (numerik).

## Lainnya
- **Hex encoding** — representasi heksadesimal untuk data biner. `src/core/encoding/`.
- **Validation** — pemeriksaan transaksi (amount, signature, nonce, fee, alamat). `src/core/validation/`.
- **Wallet** — akun pengguna (key + state saldo). `src/wallet/`.
- **Client** — kode bersama antara node, browser, dan tes. `src/client/`.
