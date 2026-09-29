# apps/miner — Miner Eksternal (titik jalan)

Miner Proof-of-Work yang berdiri sendiri, terpisah dari node. Ini sengaja
**tidak** digabung ke dalam node.

## File

- `miner.ts` — CLI interaktif: `bun run apps/miner/miner.ts "<alamatNxC>"`.
- `runMiner.ts` — library `runMiner(minerAddress)`; bisa dipanggil dari skrip E2E.

## Alur

1. Minta job lewat `nex_getWork` (wajib menyertakan `minerAddress`).
2. Cari nonce sampai hash blok < target kesulitan.
3. Kirim solusi ke `nex_submitWork`; node memverifikasi & menandatangani.

## Catatan

`miner.ts` **sengaja menduplikasi** aturan difficulty / hash / address dari
`src/core` supaya bisa berjalan tanpa node. Selaraskan secara manual bila aturan
inti berubah.
