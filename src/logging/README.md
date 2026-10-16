# src/logging — Logging Terstruktur

Logging konsisten untuk node & miner.

## Aturan tingkat (yang utama)

|                        | Konsol                      | Berkas     |
| ---------------------- | --------------------------- | ---------- |
| `logToConsole` (info)  | selalu                      | selalu     |
| `loggingErr` (error)   | hanya `priority === 'high'` | selalu     |
| `loggingDebug` (debug) | hanya dengan flag `--debug` | **selalu** |

**Konsol pelit, berkas lengkap.** Baris `debug` yang tidak pernah muncul di
layar tetap masuk berkas, jadi detail tetap bisa ditelusuri _setelah_ kejadian
(mis. kenapa sebuah peer diputus). Konsekuensinya: `--debug` mengatur KONSOL
saja, bukan isi berkas.

## Berkas utama

- `fileSink.ts` — satu-satunya sink. `installFileLogging()` dipasang sekali di
  awal `apps/node/server.ts`; `emit()` menulis ke berkas + konsol.
- `logging.ts` — `logToConsole` (info).
- `errorLog.ts` / `debug.ts` — level error & debug.
- `mineLog.ts` — log khusus penambangan (dump blok = level debug).

## Cara kerja sink

- **Tanpa duplikasi, berdasarkan konstruksi.** `installFileLogging` menyimpan
  referensi ASLI `process.stdout.write`/`stderr.write`, lalu menambal keduanya
  supaya apa pun yang dicetak DI LUAR logger (output dependensi, stack trace)
  ikut tercatat. `emit()` mencetak lewat referensi asli itu, sehingga baris
  logger tidak pernah lewat tambalan — tidak ada logika pembanding teks.
- **Berkas per hari UTC**: `nex-YYYY-MM-DD.log`, ditulis dengan
  `appendFileSync` (tanpa handle terbuka — aman saat crash). Berganti sendiri
  saat lewat tengah malam.
- **Retensi**: `NEX_LOG_RETENTION_DAYS` (default 3) = simpan N hari terakhir
  TERMASUK hari ini. Dipangkas saat pemasangan dan saat tanggal berganti.
- **Direktori**: `NEX_LOG_DIR` (default `./logs`), diselesaikan terhadap
  `process.cwd()` — prinsip yang sama dengan `src/core/state/db/dataDir.ts`,
  BUKAN `__dirname`.
- **Best-effort**, berbeda dari `initFile()` data dir yang fail-closed: gagal
  menyiapkan berkas hanya memunculkan satu peringatan dan node tetap hidup.
  Kehilangan mining karena direktori log read-only jauh lebih buruk.
- Baris konsol memakai warna `chalk`; baris berkas dibersihkan dari escape ANSI.

## Batasan browser (jangan dilanggar)

`logging.ts`, `debug.ts`, dan `errorLog.ts` **reachable dari bundel browser**
(`scripts/browserWalletEntry.ts` → `src/crypto/processPubKey.ts`), dan
`src/logging` ada di `ROOT_MODULES` wallet & miner-ui. Jadi:

- **JANGAN** impor statis `node:fs` / `node:path` di rantai itu — pakai impor
  dinamis dengan specifier tak-literal seperti di `errorLog.ts`.
- Penjaga regresinya: `bun run check:browser`.

## Hubungan

Diimpor oleh `src/core`, `src/rpc`, dan `apps/` (node & miner). Gerbang
regresinya `bun run check:log` (`scripts/logCheck.ts`).
