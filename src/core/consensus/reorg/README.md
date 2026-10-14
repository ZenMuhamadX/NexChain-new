# src/core/consensus/reorg — Reorg (fork choice)

Mesin penggantian tip ketika ada **cabang yang lebih berat** (M2). Desain
lengkap: `journal-difficulty-design.md` Bagian C. Modul-modul di sini **murni di
sisi core**; `src/p2p/validation/connectBlock.ts` hanya memanggilnya — `src/p2p/`
tetap konsumen.

## Fork choice: kerja, bukan tinggi

Aturan Bitcoin: menang bila **kerja kumulatif** lebih besar (`Σ 2^difficulty`),
bukan karena rantai lebih panjang. Karena difficulty di-retarget per blok, dua
cabang dengan tinggi berbeda belum tentu berbeda kerja. Perbandingan dilakukan
pada **segmen dari titik cabang** (bukan nilai absolut), cukup untuk menentukan
pemenang.

- `forkChoice.ts` — murni: `difficultyToWork(bits) = 1 << (bits*4 - MIN*4)`
  (relatif terhadap `MIN_DIFFICULTY_BITS`; `BigInt`, tanpa float),
  `blockWork`, `sumWork`, `compareWork`.
- `branchPool.ts` — penampung **in-memory** blok asing yang belum menempel ke
  tip. Batas `MAX_POOL_BLOCKS` (512); saat penuh, height terendah dibuang.
  Bukan LevelDB: kandidat yang kalah tak perlu bertahan, dan menghindari store
  ke-7 yang harus di-rollback.
- `ancestry.ts` — `findLocalBlockByHash`, `resolveBlock` (pool lalu lokal),
  `traceBranchToLocal(tip) → { forkHeight, forkHash, branch[] }`. Menolak
  cabang yang putus/siklus/kontinuitas height rusak.
- `reorg.ts` — eksekutor: `onCompetingTip(tip)` (**satu titik deteksi**, R-2),
  `reevaluateBranches()` (cari ujung cabang terberat), `switchToBranch`,
  `invalidateFrom(height)` (**R-1**), `resetReorgState`.

## Alur reorg

1. `connectBlock` menerima blok non-tip, memvalidasinya terhadap indeknya, lalu
   `addToPool` + `reevaluateBranches()`.
2. `reevaluateBranches` menelusuri **ujung** tiap cabang (bukan semua blok, biar
   biaya mendekati jumlah cabang) dan memilih yang kerjanya terbesar.
3. `onCompetingTip`: bila cabang tersambung DAN lebih berat dari segmen lokal →
   `markForked()` (menahan `nex_getWork`).
4. `switchToBranch`:
   - cek `MAX_REORG_DEPTH` (128) → tolak bila terlalu dalam (journal lebih tua
     sudah dipangkas, rollback mustahil);
   - `invalidateFrom(forkHeight+1)` (buang state turunan basi);
   - kumpulkan tx dari blok lokal yang dibalik;
   - `rollbackAbove(forkHeight)` (undo journal M1);
   - **re-add** tx yatim ke mempool (opsi B — mempool tidak di-journal);
   - replay cabang pemenang lewat `chains.commitBlock` **senyap** (commitBlock
     tidak menyiarkan → tidak menggosip ulang);
   - `markSynced()`.
5. Blok lokal yang kalah **tidak** di-commit ulang (duplikat dicegah di
   `connectBlock`/`hasBlock`).

## Aturan penting

- **R-3:** modul ini tidak boleh mengimpor `src/p2p/**` (dijaga `check:p2p`).
- **R-1:** setiap state turunan ber-key height/hash baru WAJIB dibersihkan di
  `invalidateFrom` — satu tempat, bukan tersebar.
- **R-2:** jangan tambah jalur reorg lain; semua lewat `onCompetingTip`.
- Fork choice memakai **segmen**, bukan cumulative-work absolut; konsisten dengan
  cara bandingkan di `onCompetingTip`.
- Mempool **tidak** di-journal: re-add eksplisit saat reorg (opsi B).

## Gate

`bun run check:reorg` (lihat `scripts/reorgCheck.ts`): fork choice murni, branch
pool (+cap/evict), penelusuran nenek moyang, reorg penuh lewat LevelDB nyata
(tip/state/saldo == rantai baru), cabang lebih ringan tidak mengganti tip, batas
kedalaman, dan `invalidateFrom`.
