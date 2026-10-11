# src/core — Mesin Blockchain

Modul inti yang berisi seluruh logika domain blockchain. **Tidak ada titik
jalan di sini**; semuanya dijalankan lewat `apps/node`. Dulu berada di `nexchain/`.

## Sub-modul

| Folder                | Isi                                                                       |
| --------------------- | ------------------------------------------------------------------------- |
| `block/`              | Struktur & pembuatan blok: `blockModel.ts`, `genesis.ts`, `createBlockTemplate.ts`, `isChainValid.ts`, `prepareBlock.ts`, `query/`. |
| `blockchain/`         | Orkestrasi rantai: `blockchain.ts`.                                       |
| `transaction/`        | Siklus tx: `processTransaction`, `createCoinbaseTransaction`, `memPool`, `isTxExecuted`, `sender/`, `receiver/`, `utils/`. Hash & skema wire tinggal di `encoding/rlp/txCodec.ts`. |
| `consensus/`          | PoW: `difficulty.ts`, `Pow.ts`, `work.ts`, `verify/` (verifyIntegrity, verifyPow, verifyMerkleRoot, verifyStruct, module/). |
| `state/`              | Persistensi: `db/` (akses leveldb) + `storage/` (block / state / mempool). |
| `encoding/`           | `hex/`, `rlp/` (codec wire transaksi), `lib/` (format, ukuran, timestamp), `sha256.ts`, `keccak256.ts`.   |
| `token/`              | Nexucoin: nexu ↔ NxC, formatting.                                         |
| `validation/`         | Validator tx: `txValidator.v.ts`, `joi/`, `module/`.                      |

## Hubungan antar modul

`block` ↔ `transaction` ↔ `consensus` ↔ `state`. `encoding` & `token` dipakai
lintas modul. `validation` memeriksa tx sebelum `processTransaction` menulis ke
`state`.

## Catatan gaya

Pemodelan blockchain (block, blockchain, transaction, consensus, state) sengaja
dikumpulkan di sini supaya mudah dibaca & dipelajari berurutan.
