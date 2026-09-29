# NexChain Wallet — Chrome Extension (MV3)

Fork **mandiri** dari `wallet-ui`. Tidak meng-import apa pun dari luar folder
ini — semua logika core NexChain yang dibutuhkan sudah **dibekukan** di
`src/vendor/`.

## Kenapa "vendored snapshot"?

`wallet-ui` memakai alias Vite yang menunjuk ke root repo (`../key`, `../sign`,
…). Itu membuatnya **tidak bisa** dipaketkan sebagai extension: build-nya
bergantung pada file di luar folder wallet.

Kita tidak bisa menulis ulang logika crypto/transaksi — kalau aturan nilai,
hash, atau `CHAIN_ID` berbeda sedikit saja, wallet akan menandatangani
transaksi yang **ditolak node**. Maka solusinya: **bekukan salinan** yang sudah
teruji (bukan tulis ulang), lalu potong semua jalur ke root repo.

Keamanan salinan ini dijamin oleh `bun run check:browser` di root repo, yang
sudah membuktikan jalur wallet bebas Node builtin (`fs`, `path`, `level`,
`winston`) dan WASM gaya webpack.

## Perintah

```bash
bun install                 # pasang dependensi (mandiri)
bun run dev                 # dev server (port 5175)
bun run build               # tsc --noEmit && vite build → dist/
bun run typecheck           # hanya typecheck

bun run vendor:snapshot     # segarkan snapshot dari root repo
bun run vendor:check        # deteksi drift (core berubah sejak snapshot)
bun run verify:independence # BUKTIKAN tidak ada import keluar dari wallet-ext
```

## Memuat ke Chrome

1. `bun run build`
2. Buka `chrome://extensions`, aktifkan **Developer mode**
3. **Load unpacked** → pilih folder `wallet-ext/dist/`

## Struktur

```
wallet-ext/
├── manifest.json            # (di public/) MV3 manifest
├── popup.html               # shell popup 360×600 (kotak tetap Chrome)
├── wallet.html              # permukaan tab penuh untuk tugas berat
├── preview.html             # harness visual 16 layar (hanya untuk uji)
├── vite.config.ts           # alias → ./src/vendor (BUKAN ../)
├── scripts/
│   ├── snapshotVendor.ts    # reachability snapshot + lock hash
│   ├── verifyIndependence.ts# gate: nol import keluar wallet-ext
│   ├── shootPreview.ts      # render preview.html → .preview-shots/full.png
│   └── cropShots.py         # potong jadi satu PNG per layar (Pillow)
└── src/
    ├── vendor/              # ★ core NexChain yang dibekukan (66 file)
    │   └── VENDOR.lock.json # hash tiap file → deteksi drift
    ├── popup/entry.tsx      # entry popup (async boot)
    ├── background/          # service worker MV3
    ├── content/             # jembatan halaman ↔ extension
    ├── inpage/              # window.nexchain (EIP-1193-like)
    ├── lib/                 # vault, rpc, storage (chrome.storage)
    ├── screens/ + ui/       # React UI (dari wallet-ui)
    ├── hooks/ + workers/    # crypto worker bridge
    └── mv3.d.ts             # ambient types service worker
```

## Cara snapshot bekerja

`snapshotVendor.ts` **tidak** menyalin berdasarkan daftar direktori (itu
menyebabkan file Node-only ikut terbawa). Ia mulai dari **entry points** yang
benar-benar dipakai wallet, lalu mengikuti import secara **transitif**. Hasil:
hanya 66 file (bukan 99) yang tersalin.

Tiga mekanisme penting:

1. **Stub** (`logging/*`, `interface/module/writeLog`) — modul core
   mengimpornya, tetapi implementasi aslinya memakai `winston`/`chalk`
   (Node-only). Diganti no-op yang menjaga API.
   ⚠️ `writeLog.logError` mengembalikan `false` (bukan `void`) karena dipakai
   sebagai nilai balik di jalur validasi transaksi.
2. **Shim tipe** (`nexchain/transaction/setPendingBalance`) — hanya
   `interface`-nya yang dibutuhkan; implementasinya menulis ke LevelDB lewat
   `nexchain/db/state`. Diganti deklarasi tipe saja.
3. **Rewrite `import type`** — import ke modul type-only ditulis ulang menjadi
   `import type` agar rantai runtime-nya (→ LevelDB) tidak pernah di-resolve.

## Memisahkan dari root repo (detached)

`wallet-ext` **bisa berdiri sendiri.** Build, dev, dan typecheck tidak
membutuhkan root repo NexChain sama sekali.

```bash
cp -r wallet-ext ~/projects/nexchain-wallet
cd ~/projects/nexchain-wallet
bun install && bun run build     # jalan tanpa root repo
```

Yang berubah saat detached: perintah `vendor:snapshot` / `vendor:check` akan
melaporkan **"Mode detached"** dan melewati proses (exit 0, bukan error).
Snapshot di `src/vendor/` tetap dipakai. Ini memang benar — tanpa sumber, tidak
ada yang bisa disinkronkan.

### Mencari root repo (urutan)

Script snapshot mencari sumber lewat urutan berikut:

1. `--source <path>` — mis. `bun scripts/snapshotVendor.ts --source /opt/NexChain`
2. env `NEXCHAIN_ROOT` — mis. `NEXCHAIN_ROOT=/opt/NexChain bun run vendor:check`
3. tetangga `../` — kasus normal saat wallet-ext berada di dalam repo NexChain

Jadi repo terpisah **tetap bisa** menyegarkan snapshot dengan menunjuk root
secara eksplisit, tanpa perlu diletakkan bersebelahan.

## Menyegarkan snapshot saat core berubah

```bash
cd wallet-ext
bun run vendor:check                    # apakah core sudah berubah?
bun run vendor:snapshot                 # kalau ya, segarkan (root di ../)
# atau, bila wallet berada di repo terpisah:
NEXCHAIN_ROOT=/path/ke/NexChain bun run vendor:snapshot
bun run verify:independence
bun run build
```

`VENDOR.lock.json` menyimpan hash tiap file sumber. Jalankan `vendor:check` di
CI untuk tahu kapan core bergerak.

## Verifikasi visual

`tsc` membuktikan tipe benar, tetapi tidak bisa memberi tahu bahwa sesuatu
meluber keluar kotak popup 360×600. Untuk itu:

```
bun run preview:shots
```

Perintah ini menjalankan server statis-nya sendiri, merender `preview.html`
(16 layar) dengan Chrome headless pada `--force-device-scale-factor=2`, lalu
memotong hasilnya menjadi satu PNG per layar di `.preview-shots/`.

Harness menulis rect tiap kotak (dari `getBoundingClientRect`) ke blok
`<script id="shot-geometry">`; skrip pemotong membacanya, jadi potongan tetap
presisi walau tata letak berubah. Grid dipaku 3 kolom supaya pass pengukuran
dan pass tangkapan menghasilkan koordinat yang sama.

Butuh Pillow (`pip install pillow`) dan Chrome terpasang. Timpa lokasi dengan
`CHROME_PATH`, dan skala dengan `SHOT_SCALE`. `.preview-shots/` tidak di-commit.

## Status konversi

- [x] Struktur mandiri + snapshot vendored
- [x] Alias Vite → `src/vendor`, nol import ke root repo
- [x] Build MV3: popup, background, content, inpage
- [x] `chrome.storage.local` menggantikan `localStorage`
- [x] Provider `window.nexchain` (jembatan dasar)
- [x] Shell khusus extension: popup 360×600 + permukaan tab penuh
- [x] Tata letak mobile-first (header tetap, tab bawah, hanya konten menggulir)
- [x] Ikon brand 16/32/48/128 (bukan lagi placeholder 1×1 px)
- [x] Harness verifikasi visual 16 layar (`bun run preview:shots`)
- [ ] Approval UI untuk request dApp (queue di service worker)
- [ ] Routing vault ke service worker (`chrome.storage.session` + idle lock)
