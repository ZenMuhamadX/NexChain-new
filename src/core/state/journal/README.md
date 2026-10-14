# src/core/state/journal — Undo Journal

Write-ahead log (WAL) per blok untuk **crash-consistency** dan fondasi
**reorg** (M1; reorg-nya sendiri M2). Desain lengkap:
`journal-difficulty-design.md` Bagian A.

## Mengapa

Commit sebuah blok menyentuh banyak kunci di tiga store (state, history,
block). Bila proses mati di tengah, DB bisa berisi blok "setengah": pointer
sudah maju tetapi saldo/riwayat belum (atau sebaliknya). Tanpa catatan nilai
lama, state seperti itu tidak bisa dipulihkan. Journal menyimpan nilai lama
**sebelum** tulisan apa pun, sehingga blok bisa dibalik persis.

## Alur commit (`blockchain.commitBlock`)

1. enumerasi touch-set — murni dari blok, tanpa eksekusi
   (`enumerateTouchSet`);
2. baca nilai lama semua kunci touch (`capturePrev`);
3. tulis `journal:<height>` = `{ hash, entries }` dengan `sync:true`
   (`writeJournalRecord`) — WAL aman di disk;
4. `beginJournalContext(touch)` → semua tulisan state/history/block dicek
   keanggotaannya oleh `assertJournalAllows` (dipanggil dari `putAccount`,
   `setPendingBalance`, `saveTxHistory`, `saveTxByAddress`, `saveBlock`,
   `writeBlockHash`);
5. `saveBlockToChain` + `processTransact`;
6. `endJournalContext()`, lalu `pruneJournal(height)`.

Bila langkah 4–5 gagal, `commitBlock` melakukan `rollbackBlock(height)`
best-effort; `recoverJournal()` saat boot adalah jaring pengaman terakhir.

## Recovery boot (`apps/node/server.ts`)

Dipanggil SEBELUM genesis dibaca/diverifikasi. `recoverJournal()` membalik
semua `journal:<h>` dengan `h > currentBlockHeight` (menurun), lalu memangkas
journal lebih tua dari `MAX_REORG_DEPTH` (128). Idempoten — aman diulang
setelah crash di tengah rollback. Gagal recovery → node berhenti (fail-closed).

## Aturan penting

- `journal:<h>` hanya boleh dihapus SETELAH entri-entrinya diterapkan
  (`applyRecord` menerapkan dulu, baru `del`).
- Rollback berjalan dengan guard MATI (menulis `prev` bukan tulisan blok).
- Mempool **tidak** di-journal (opsi B: re-add eksplisit saat reorg, M2).
- Menambah penulis state/history/block baru WAJIB memperbarui
  `enumerateTouchSet`; bila tidak, guard akan menolak commit — itu disengaja.

## Gate

`bun run check:journal` (lihat `scripts/journalCheck.ts`): guard fail-closed,
touch-set == tulisan aktual (spy), round-trip rollback persis, recovery crash,
dan prune.
