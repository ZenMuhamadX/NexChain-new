# src/logging — Logging Terstruktur

Logging konsisten untuk node & miner.

## File utama

- `logging.ts` — logger utama (`logToConsole`, `logError`, `loggingDebug`).
- `errorLog.ts` / `debug.ts` — level error & debug.
- `mineLog.ts` — log khusus penambangan.

## Hubungan

Diimpor oleh `src/core`, `src/rpc`, dan `apps/` (node & miner).
