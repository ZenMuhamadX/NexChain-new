# wallet/

NexChain Wallet — **satu basis kode, beberapa shell**.

Bukan satu aplikasi. `src/` adalah sumber bersama, `shells/` adalah entry point
per platform. Sembilan layar wallet tidak pernah tahu dirinya berjalan di mana;
yang berbeda antar platform hanya **empat titik suntik**.

```
wallet/
  src/                 ← sumber bersama (JANGAN bercabang per platform di sini)
    screens/           ← 9 layar: Welcome, Setup, Unlock, Dashboard, Send,
                         Receive, History, Settings
    ui/                ← komponen kecil (Icon, Modal, Notice, AmountDisplay, …)
    lib/               ← rpc, format, vault, vaultStore, deviceCrypto, rpcUrl,
                         platform (status PWA)
    pwa/               ← register.ts: service worker + prompt pemasangan
    workers/           ← crypto.worker.ts (PBKDF2/BIP32/sign di luar main thread)
  shells/
    dev/               ← untuk mengerjakan tampilan (port 5174)
    web/               ← PWA yang dipasang di HP (dist/web, port preview 5174)
    desktop/           ← aplikasi desktop Electron (.exe)
      electron/        ← proses utama + preload
```

## Empat titik suntik

Ini inti desainnya. Kalau Anda menambal `if (isDesktop)` di sembilan layar,
hasilnya neraka pemeliharaan. Yang benar: seluruh layar tetap identik, dan hanya
empat hal ini yang berbeda.

| #   | Berkas                    | Yang ditukar                                               | Dipilih oleh                                       |
| --- | ------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| 1   | `src/lib/vaultStore.ts`   | backend penyimpanan vault                                  | `installVaultKV()` dari shell (nama ikut disuntik) |
| 2   | `src/lib/rpcUrl.ts`       | URL node awal                                              | `VITE_RPC_URL`, atau Settings saat runtime         |
| 3   | `src/lib/deviceCrypto.ts` | kelas perangkat (menentukan iterasi PBKDF2)                | `installDeviceClass()` dari shell                  |
| 4   | `src/lib/platform.ts`     | status aplikasi terpasang (install / penyimpanan / update) | `installPlatform()` dari shell web                 |

Poin 1 aman karena `WalletKV` di `src/client/wallet/kv.ts` sudah berupa
interface — logika vault tidak pernah tahu medianya.

Poin 4 tidak mengubah perilaku apa pun: ketiga shell lain tidak memasang
jembatannya, sehingga `supported === false` dan kartu "Aplikasi" di Settings
tidak dirender. Itu sebabnya build desktop tidak perlu tahu soal service worker.

## Shell

### `shells/dev/` — untuk mengerjakan tampilan

Vault di memori, dipasang **eksplisit** (`installVaultKV(createMemoryKV())`).
Hilang saat tab ditutup, dan itu memang tujuannya: mengubah desain tidak perlu
membuat wallet baru dan mencatat mnemonic setiap kali. Injeksi eksplisit juga
mencegah `VITE_VAULT_BACKEND` yang tertinggal dari sesi debugging diam-diam
mengubah media penyimpanan.

```bash
bun run wallet:dev       # http://localhost:5174
```

### `shells/web/` — PWA (iOS/Android)

Target `web` memakai **`shells/web/` sebagai Vite root**, sehingga hasil build
langsung berisi `index.html`, `sw.js`, dan `manifest.webmanifest` di akar
`dist/web` — bentuk yang dituntut PWA di akar satu origin.

```bash
bun run wallet:build:web     # tsc + vite build --mode web → dist/web
bun run wallet:preview:web   # uji service worker di localhost:5174
bun run wallet:smoke:pwa     # gate: build + periksa artefak PWA
```

Service worker **tidak** didaftarkan di dev server (`devOptions.enabled: false`)
dan update selalu **prompt**, bukan auto-reload. Keduanya disengaja: reload
otomatis saat deploy akan membatalkan transaksi yang sedang dikirim.

Lihat `shells/web/README.md` untuk rincian manifest, ikon, dan cara menguji di
perangkat.

### `shells/desktop/` — aplikasi desktop

Aplikasi **Electron**. Proses utama menulis vault sebagai berkas JSON di
direktori data pengguna, dan mengekspos empat operasi lewat
`window.nexVaultBridge` (IPC + `contextBridge`). Renderer tidak punya akses
filesystem.

```bash
bun run wallet:desktop        # build + jalankan
bun run wallet:desktop:pack   # kemas .exe
bun run wallet:dist           # installer NSIS
```

Lihat `shells/desktop/README.md` untuk kontrak jembatan, lokasi berkas, dan
catatan keamanan.

## Tanpa `.env`

Wallet **berjalan tanpa `.env` sama sekali**. Semua punya default: URL node
diisi lewat Settings saat runtime (atau diturunkan dari origin halaman), explorer
kosong, backend vault disuntik shell. `.env.example` hanya dokumentasi opsi —
jangan disalin.

Vite juga dilarang memuat `.env` dari root repo (`envDir` dikunci ke folder
`wallet/`), karena root `.env` berisi rahasia node yang tidak ada kaitannya
dengan build wallet.

## Perintah

| Perintah                        | Artinya                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `bun run wallet:dev`            | shell developer, port 5174                                |
| `bun run wallet:build`          | build shell developer → `dist/dev/`                       |
| `bun run wallet:build:desktop`  | build shell desktop → `dist/desktop/`                     |
| `bun run wallet:build:web`      | build PWA → `dist/web/` (index.html di akar)              |
| `bun run wallet:preview:web`    | sajikan `dist/web` di port 5174 (service worker aktif)    |
| `bun run wallet:smoke:pwa`      | gate PWA: build + periksa manifest, ikon, sw.js, precache |
| `bun run wallet:icons`          | regenerasi ikon PWA dari `shells/web/public/*.svg`        |
| `bun run wallet:typecheck`      | typecheck seluruh basis kode + shell                      |
| `bun run wallet:smoke`          | smoke test alur kirim (tanpa node)                        |
| `bun run wallet:smoke:desktop`  | 18 pemeriksaan shell Electron (IPC, jembatan, renderer)   |
| `bun run wallet:smoke:portable` | 3 pemeriksaan mode portabel (lokasi data vault)           |
| `bun run wallet:desktop`        | build lalu jalankan aplikasi desktop                      |
| `bun run wallet:desktop:pack`   | kemas .exe (belum installer)                              |
| `bun run wallet:portable`       | .exe portabel — satu berkas, tanpa instalasi              |
| `bun run wallet:installer`      | installer NSIS                                            |
| `bun run wallet:dist`           | keduanya sekaligus                                        |

## Dua bentuk distribusi

|                             | Terpasang (NSIS)            | Portabel                            |
| --------------------------- | --------------------------- | ----------------------------------- |
| Instalasi                   | perlu                       | tidak — satu `.exe`                 |
| Hak admin                   | perlu                       | tidak                               |
| Data vault                  | `%APPDATA%\NexChain Wallet` | `<folder .exe>\NexChainWallet-Data` |
| Pindah komputer             | wallet tertinggal           | ikut, asal foldernya dibawa         |
| Aman dari hapus tak sengaja | ya                          | tidak                               |

Mode portabel mengalihkan direktori data ke samping `.exe`. Tanpa itu, `.exe`
"portabel" tetap menulis ke `%APPDATA%` dan wallet terlihat **hilang** saat
dibawa ke komputer lain. Deteksinya dijaga oleh `wallet:smoke:portable`.

Lihat `shells/desktop/README.md` untuk detail dan hal yang perlu diketahui
pengguna portabel.

## Catatan yang mudah tertukar

- **`wallet/` (package ini) berbeda dari `wallet/main.json`.** Yang terakhir
  adalah file mnemonic **node**, diabaikan git, dan tidak berhubungan dengan
  package ini. Nama keduanya sama karena keduanya memang "wallet"; lihat
  komentar di `.gitignore`.
- **Ekstensi Chrome sudah dipensiunkan.** Direktori `wallet-ext/` dulu ada dan
  sudah dihapus, bersama seluruh _vendor snapshot_-nya. Jangan menghidupkan
  kembali pola snapshot di sini: `wallet/` di-build di dalam repo, jadi ia
  mengalias `src/` root secara langsung — tidak ada salinan logika crypto yang
  bisa tertinggal saat modul di root diperbaiki.
- **Jangan aktifkan IndexedDB di shell desktop.** Backend berkas wajib
  disuntikkan shell sebelum render pertama, karena `getVault()` menyimpan
  promise singleton. Shell desktop sengaja **gagal keras** kalau lupa, bukan
  diam-diam jatuh ke IndexedDB — vault yang "hilang" tanpa pesan lebih buruk
  daripada error saat boot.
- **Vault PWA terikat pada ORIGIN, bukan pada perangkat.** IndexedDB dipisah
  per origin, jadi wallet yang dibuat di `http://localhost:5174` **tidak**
  muncul di `https://wallet.contoh.com` dan sebaliknya. Tentukan hostname final
  sebelum membuat wallet di HP, atau impor mnemonic yang sama di sana.
- **PWA tidak punya `.env` yang dibutuhkan.** Alamat halaman menentukan default
  RPC (`https://host/rpc` untuk halaman https), jadi deploy normal tidak perlu
  `VITE_RPC_URL` selama `/rpc` berada di origin yang sama.
