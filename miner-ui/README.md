# miner-ui

UI browser untuk **miner eksternal** NexChain. Menjalankan loop
Proof-of-Work di dalam Web Worker dan berbicara ke node lewat JSON-RPC —
tanpa seed, tanpa private key, tanpa database.

## Menjalankan

```bash
# 1. node harus hidup lebih dulu (dari root repo)
bun run node:start            # RPC di http://localhost:8000/rpc

# 2. jalankan UI
bun install                  # di dalam miner-ui/
bun run dev                  # http://localhost:5175
```

Atau dari root repo: `bun run miner:dev`.

Lalu isi **alamat penerima hadiah** (diawali `NxC`/`NxS`, 43 karakter) dan
tekan *Mulai mining*.

## Cara kerja

UI hanya mengerjakan tiga hal — sisanya (template blok, coinbase, merkle,
retarget difficulty, commit, kredit hadiah) 100% di node:

1. `nex_getWork({minerAddress})` → job (`payload`, `difficulty`, `expiresAt`)
2. `SHA-256(payload ‖ nonce)` di Web Worker sampai `meetsDifficulty` lolos
3. `nex_submitWork({jobId, nonce, hash})` → node memverifikasi ulang & commit

`hashWithNonce` dan `meetsDifficulty` **diimpor dari modul kanonik**
(`src/core/consensus/…`) lewat alias di `vite.config.ts` — bukan disalin —
sehingga hash yang dihitung browser dijamin identik dengan yang diverifikasi
node. Karena node memverifikasi ulang, miner tidak dapat memanipulasi rantai.

## Struktur

| Path | Peran |
|---|---|
| `src/workers/miner.worker.ts` | Loop PoW (non-blocking, lapor progres) |
| `src/hooks/useMinerWorker.ts` | Siklus hidup worker + request/response |
| `src/hooks/useMiner.ts` | Orkestrasi loop getWork → hash → submit |
| `src/lib/rpc.ts` | Pembungkus metode RPC miner |
| `src/lib/rpcUrl.ts` | Persistensi endpoint (localStorage → VITE_RPC_URL → host) |
| `src/screens/Miner.tsx` | Layar utama |
| `src/screens/Settings.tsx` | Modal endpoint node |

## Item kunci

- **Hashrate browser** jauh di bawah miner native. Difficulty node adaptif
  (target 60 detik), jadi miner browser yang berjalan **sendirian** akan
  menyeimbangkan difficulty ke levelnya sendiri. Bila ada miner cepat lain di
  jaringan yang sama, blok akan sering kalah cepat — `nex_submitWork` menjawab
  "Stale job" dan UI otomatis mengambil job baru (bukan error fatal).
- **Mixed content**: halaman HTTPS tidak dapat memanggil RPC `http://…`.
  Deploy wajib mengisi `VITE_RPC_URL` ke endpoint HTTPS atau memakai proxy.
- Job di node berumur 5 menit (`JOB_TTL_MS`); UI menampilkan countdown dan
  otomatis meminta job baru saat kedaluwarsa.

## Performa PoW

Loop PoW adalah satu-satunya tempat biaya hashing berarti, jadi ada dua
optimasi di jalur ini:

1. **Hasher buffer-tetap** (`createPowHasher` dari `src/core/consensus/Pow`,
   diimplementasi di `src/core/encoding/sha256.ts`). Payload di-encode SEKALI
   per job; tiap hash hanya menulis digit nonce ke buffer tetap — menghapus
   concat string per iterasi yang dulu lebih mahal daripada hashing itu
   sendiri. Paritas dengan `hashWithNonce` dibuktikan gate `bun run check:pow`.
2. **Pool worker dengan partisi nonce** (`useMinerWorker.ts`). Ruang nonce
   dibagi dengan stride: worker ke-`i` mulai di `i` dan melangkah `N`. Tidak
   ada tumpang tindih, tidak butuh koordinasi pusat, dan worker pertama yang
   menemukan solusi menang.

Jumlah worker diambil dari `navigator.hardwareConcurrency` (dibatasi maksimum
4) dan bisa ditimpa lewat `localStorage['nex_miner_workers']`.

**Kalibrasi dulu, jangan asal banyak.** Pengukuran lapangan menunjukkan
throughput saturasi di 2–3 worker dan justru **turun** setelahnya (kontensi +
alokasi hasher per-hash). Jalankan `bun run pow:bench` dari root untuk melihat
rekomendasi jumlah worker di mesin ini:

```
bun run pow:bench
```

