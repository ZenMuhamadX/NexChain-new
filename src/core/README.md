# src/core — Mesin Blockchain

Modul inti yang berisi seluruh logika domain blockchain. **Tidak ada titik
jalan di sini**; semuanya dijalankan lewat `apps/node`. Dulu berada di `nexchain/`.

## Sub-modul

| Folder         | Isi                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `block/`       | Struktur & pembuatan blok: `blockModel.ts`, `genesis.ts`, `createBlockTemplate.ts`, `isChainValid.ts` (gerbang `nex_getWork` → verifikasi inkremental), `prepareBlock.ts`, `query/`.                                                                |
| `blockchain/`  | Orkestrasi rantai: `blockchain.ts`.                                                                                                                                                                                                                 |
| `transaction/` | Siklus tx: `processTransaction`, `createCoinbaseTransaction`, `memPool`, `isTxExecuted`, `sender/`, `receiver/`, `utils/`. Hash & skema wire tinggal di `encoding/rlp/txCodec.ts`.                                                                  |
| `consensus/`   | PoW: `difficulty.ts`, `Pow.ts`, `work.ts`, `verify/` (verifyIntegrity penuh/inkremental, `verifyMarker.ts`, verifyPow, verifyMerkleRoot, verifyStruct, module/), dan `reorg/` (fork choice, branch pool, penelusuran nenek moyang, eksekusi reorg). |
| `state/`       | Persistensi: `db/` (akses leveldb) + `storage/` (block / state / mempool) + `journal/` (write-buffer + undo journal: WAL per blok, rollback & recovery) + `root.ts` (komitmen `stateRoot`).                                                         |
| `encoding/`    | `hex/`, `rlp/` (codec wire transaksi), `lib/` (format, ukuran, timestamp), `sha256.ts`, `keccak256.ts`.                                                                                                                                             |
| `token/`       | Nexucoin: nexu ↔ NxC, formatting.                                                                                                                                                                                                                   |
| `validation/`  | Validator tx: `txValidator.v.ts`, `joi/`, `module/`.                                                                                                                                                                                                |
| `events/`      | Bus & status netral (tanpa P2P): `nodeEvents.ts` (publish blok/tx), `syncState.ts` (gerbang IBD), `peerState.ts` (snapshot peer untuk `nex_getPeerInfo`). Ditulis oleh `src/p2p/`, dibaca core/RPC.                                                 |

## Hubungan antar modul

`block` ↔ `transaction` ↔ `consensus` ↔ `state`. `encoding` & `token` dipakai
lintas modul. `validation` memeriksa tx sebelum `processTransaction` menulis ke
`state`.

## Undo journal (crash-consistency & fondasi reorg)

`commitBlock` adalah SATU-SATUNYA titik commit (RPC & P2P). Eksekusi blok
berjalan di **write-buffer** (RAM, nol tulis), lalu isi buffer itu — kunci +
nilai LAMA — ditulis sebagai WAL `journal:<height>` (`sync:true`). Jadi daftar
undo selalu sama dengan tulisan sebenarnya; tidak ada enumerasi terpisah yang
bisa meleset. Setelah flush, `committed:<height>` ditulis sebagai langkah
terakhir. Saat boot, `recoverJournal()` membalik setiap `journal:<h>` yang
belum ber-penanda (flush tidak tuntas) atau berada di atas tip, sehingga crash
di tengah commit tidak pernah meninggalkan blok setengah. Record juga menjadi
fondasi rollback reorg (M2). Lihat `src/core/state/journal/README.md`.

## Komitmen state (v0.1)

Setiap header memuat `stateRoot` — bagian preimage PoW — yang dihitung dari
root induk plus leaf yang DISENTUH blok itu (`state/root.ts`: akumulator
chained-diff, bukan trie, jadi tanpa proof per akun). Eksekusi adalah satu-
satunya sumber kebenaran: `createBlockTemplate` mensimulasikan blok di
write-buffer untuk mengisi root, dan `commitBlock` mengeksekusi ulang lalu
MENOLAK blok yang root-nya berbeda. Saat boot `replayState()` (fail-closed)
membangun ulang state dari genesis, mencocokkan root tiap blok DAN isi DB state,
lalu berhenti bila ada yang tidak cocok; `--rebuild-state` menulis hasil replay
kembali (akun liar dihapus). Batas: root hanya membuktikan rantai konsisten —
mendeteksi DB yang diedit tangan butuh replay, dan template di atas induk non-tip
disimulasikan di atas state tip (lihat `shortcut:` di `createBlockTemplate`).

## Reorg (M2)

`consensus/reorg/` mengganti tip bila ada cabang yang LEBIH BERAT (kerja
kumulatif `Σ 2^difficulty`, bukan tinggi). Blok asing non-tip diverifikasi
terhadap indeknya lalu diparkir di **branch pool in-memory**; `connectBlock`
(P2P) memanggil `reevaluateBranches()` → `onCompetingTip` (satu titik deteksi,
R-2). Bila cabang menang: rollback lewat undo journal, tx yatim dikembalikan ke
mempool (opsi B), cabang diputar ulang **senyap**, dan `invalidateFrom` (R-1)
membuang state turunan basi — branch pool DAN marker verifikasi inkremental
(S4). Lihat `src/core/consensus/reorg/README.md`.

## Verifikasi inkremental (S4 / T03)

`nex_getWork` memanggil `isChainsValid()` SEBELUM membangun work. Dulu itu
menelusuri SELURUH rantai dari genesis tiap panggilan (biaya O(N) per polling
miner). Sejak S4 jalur ini **inkremental**: `verifyChainIncremental()` membaca
marker hash-keyed in-memory (`consensus/verify/verifyMarker.ts`) berisi
`{ height, hash }` blok tertinggi yang sudah diverifikasi, lalu memverifikasi
HANYA sufiks di atasnya memakai loop yang SAMA (`verifyRange`) — sehingga
hasilnya identik dengan verifikasi penuh **oleh konstruksi**.

- Tanpa marker (boot / setelah reorg) atau marker basi (blok di height itu
  berganti) → jatuh kembali ke `verifyChainIntegrity()` (penuh dari height 0,
  fail-closed).
- Reorg membatalkan marker di `>= forkHeight+1` lewat
  `invalidateVerifyMarkerFrom` (hook R-1 di `invalidateFrom`), lalu
  me-seed ulang ke blok fork supaya verifikasi berikutnya tetap inkremental.
- Marker adalah **memoization**, bukan kepercayaan pihak luar: blok
  content-addressed (hash = SHA-256 isinya), verifikasi deterministik, dan
  setiap mutasi history memanggil hook invalidasi. Blok BARU tetap
  diverifikasi penuh (sufiks diperiksa dengan aturan yang sama).
- Batas jujur: marker hidup in-memory dan tidak menangkap korupsi data di disk
  SETELAH marker terbentuk (dimitigasi oleh verifikasi penuh saat boot). Gate
  `check:reorg` GROUP 0/3 membuktikan semantik marker, jalur inkremental pada
  rantai PoW nyata, fallback marker basi, kontrol negatif, dan seed ulang
  setelah reorg.

## Catatan gaya

Pemodelan blockchain (block, blockchain, transaction, consensus, state) sengaja
dikumpulkan di sini supaya mudah dibaca & dipelajari berurutan.
