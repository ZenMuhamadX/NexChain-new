# src/core — Mesin Blockchain

Modul inti yang berisi seluruh logika domain blockchain. **Tidak ada titik
jalan di sini**; semuanya dijalankan lewat `apps/node`. Dulu berada di `nexchain/`.

## Sub-modul

| Folder                | Isi                                                                       |
| --------------------- | ------------------------------------------------------------------------- |
| `block/`              | Struktur & pembuatan blok: `blockModel.ts`, `genesis.ts`, `createBlockTemplate.ts`, `isChainValid.ts`, `prepareBlock.ts`, `query/`. |
| `blockchain/`         | Orkestrasi rantai: `blockchain.ts`.                                       |
| `transaction/`        | Siklus tx: `processTransaction`, `createCoinbaseTransaction`, `memPool`, `isTxExecuted`, `sender/`, `receiver/`, `utils/`. Hash & skema wire tinggal di `encoding/rlp/txCodec.ts`. |
| `consensus/`          | PoW: `difficulty.ts`, `Pow.ts`, `work.ts`, `verify/` (verifyIntegrity, verifyPow, verifyMerkleRoot, verifyStruct, module/), dan `reorg/` (fork choice, branch pool, penelusuran nenek moyang, eksekusi reorg). |
| `state/`              | Persistensi: `db/` (akses leveldb) + `storage/` (block / state / mempool) + `journal/` (undo journal: WAL per blok, guard fail-closed, rollback & recovery). |
| `encoding/`           | `hex/`, `rlp/` (codec wire transaksi), `lib/` (format, ukuran, timestamp), `sha256.ts`, `keccak256.ts`.   |
| `token/`              | Nexucoin: nexu ↔ NxC, formatting.                                         |
| `validation/`         | Validator tx: `txValidator.v.ts`, `joi/`, `module/`.                      |

## Hubungan antar modul

`block` ↔ `transaction` ↔ `consensus` ↔ `state`. `encoding` & `token` dipakai
lintas modul. `validation` memeriksa tx sebelum `processTransaction` menulis ke
`state`.

## Undo journal (crash-consistency & fondasi reorg)

`commitBlock` adalah SATU-SATUNYA titik commit (RPC & P2P). Sebelum menulis
state, ia menulis WAL `journal:<height>` berisi nilai LAMA tiap kunci yang akan
disentuh (dienumerasi murni dari blok lewat `enumerateTouchSet`). Selama commit
guard journal aktif: menulis kunci yang tak terenumerasi → `JournalGuardError`
(fail-closed) dan blok dibatalkan. Saat boot, `recoverJournal()` membalik semua
`journal:<h>` dengan `h > blockState.currentBlockHeight`, sehingga crash di
tengah commit tidak pernah meninggalkan blok setengah. Record juga menjadi
fondasi rollback reorg (M2). Lihat `src/core/state/journal/README.md`.

## Reorg (M2)

`consensus/reorg/` mengganti tip bila ada cabang yang LEBIH BERAT (kerja
kumulatif `Σ 2^difficulty`, bukan tinggi). Blok asing non-tip diverifikasi
terhadap indeknya lalu diparkir di **branch pool in-memory**; `connectBlock`
(P2P) memanggil `reevaluateBranches()` → `onCompetingTip` (satu titik deteksi,
R-2). Bila cabang menang: rollback lewat undo journal, tx yatim dikembalikan ke
mempool (opsi B), cabang diputar ulang **senyap**, dan `invalidateFrom` (R-1)
membuang state turunan basi. Lihat `src/core/consensus/reorg/README.md`.

## Catatan gaya

Pemodelan blockchain (block, blockchain, transaction, consensus, state) sengaja
dikumpulkan di sini supaya mudah dibaca & dipelajari berurutan.
