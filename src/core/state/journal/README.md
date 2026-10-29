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

1. verifikasi (merkle, hadiah, timestamp, difficulty, plafon suplai, nonce);
2. `beginWriteBuffer()` — `saveBlockToChain` + `processTransact` hanya
   menumpuk tulisan + nilai lama di RAM (`writeBuffer.ts`); **nol byte ke
   disk**, jadi crash di sini tidak meninggalkan apa pun;
3. `bufferEntries()` → `journal:<height>` = `{ hash, entries }` dengan
   `sync:true` (`writeJournalRecord`) — WAL aman di disk;
4. `flushWriteBuffer()` — satu batch `sync:true` per store, badan blok dulu;
5. `committed:<height>` `sync:true` (`writeCommittedMarker`) — **langkah
   terakhir**; blok baru permanen setelah penanda ini;
6. `discardWriteBuffer()`, lalu `pruneJournal(height)`.

Bila langkah 2–5 gagal, buffer dibuang dan `commitBlock` melakukan
`rollbackBlock(height)` best-effort; `recoverJournal()` saat boot adalah jaring
pengaman terakhir.

**Isi journal = tulisan sebenarnya**, bukan enumerasi terpisah. Tidak ada lagi
`guard.ts`/`enumerateTouchSet`: penulis yang lupa terdaftar tidak mungkin ada,
karena daftarnya diambil dari tulisan itu sendiri.

## Recovery boot (`apps/node/server.ts`)

Dipanggil SEBELUM genesis dibaca/diverifikasi. `recoverJournal()` membalik
setiap `journal:<h>` yang **tidak punya `committed:<h>`** (flush belum tuntas)
atau berada di atas tip (sisa reorg), menurun, lalu memangkas journal lebih tua
dari `MAX_REORG_DEPTH` (128) bersama penandanya. Idempoten — aman diulang
setelah crash di tengah rollback. Gagal recovery → node berhenti (fail-closed).

## Aturan penting

- `journal:<h>` hanya boleh dihapus SETELAH entri-entrinya diterapkan
  (`applyRecord` menerapkan dulu, baru `del`).
- `rollbackBlock` menolak record yang `hash`-nya tidak cocok dengan
  `blockHeight:<h>` di state — rollback ke rantai yang salah lebih buruk
  daripada tidak rollback.
- Rollback berjalan dengan buffer MATI (menulis `prev` langsung ke DB).
- Mempool **tidak** di-journal (opsi B: re-add eksplisit saat reorg, M2).
- Penulis baru di store state/history/block cukup memakai `bufferPut`/
  `bufferGet`; tidak ada daftar yang perlu diperbarui. Penulis yang menulis
  LANGSUNG ke `rocks*` saat commit akan lolos dari journal — jangan.
- Pembaca yang harus melihat tulisan yang belum di-flush (mis. `getAccount`
  antar-transaksi dalam satu blok) memakai `bufferGet`.

## Gate

`bun run check:journal` (lihat `scripts/journalCheck.ts`): isolasi buffer,
journal == tulisan aktual (spy), round-trip rollback persis, rollback hash
salah ditolak, recovery crash di tiap titik (sebelum WAL / setelah WAL /
setelah flush sebelum `committed`), dan prune.
