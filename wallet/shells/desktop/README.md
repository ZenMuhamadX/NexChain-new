# wallet/shells/desktop

Shell desktop NexChain Wallet — **Electron**. Sembilan layar wallet tidak
diubah sama sekali; folder ini hanya menyuntikkan backend lalu merender
komponen yang sama.

## Berkas

| Berkas | Peran |
|---|---|
| `index.html` | Dokumen jendela + CSP (`connect-src` http/https, `worker-src` self/blob) |
| `src/main.tsx` | Renderer: pasang backend → render `App` dari `../../../src/` |
| `electron/main.cjs` | Proses utama: jendela, IPC vault, penulisan atomik |
| `electron/preload.cjs` | `contextBridge` — mengekspos `window.nexVaultBridge` |

## Urutan boot renderer

1. `installVaultKV()` — backend berkas lewat jembatan. **Sebelum render**,
   karena `getVault()` menyimpan promise singleton.
2. `installDeviceClass('desktop')` — memaksa PBKDF2 penuh (310k iterasi).
   Tanpa ini, laptop layar sentuh turun ke 100k tanpa peringatan.
3. `initRpcUrl()` — URL node sebelum request pertama.

## Kontrak jembatan

Proses utama menyediakan empat operasi lewat IPC; preload mengeksposnya:

```ts
interface NexVaultBridge {
  read(key: string): Promise<string | undefined>
  write(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  dataDir(): Promise<string>
}
```

Nilai adalah JSON `VaultRecord` — berkas berisi **blob terenkripsi**, bukan
mnemonic mentah.

### Lokasi berkas

Ditentukan proses utama lewat `app.getPath('userData')`:

| Platform | Terpasang | Portabel |
|---|---|---|
| Windows | `%APPDATA%\NexChain Wallet\wallet\` | `<folder .exe>\NexChainWallet-Data\wallet\` |
| macOS | `~/Library/Application Support/NexChain Wallet/wallet/` | `<folder .app>\NexChainWallet-Data\wallet\` |
| Linux | `~/.config/NexChain Wallet/wallet/` | `<folder .exe>\NexChainWallet-Data\wallet\` |

**Jangan** menaruh berkas vault di sebelah executable pada mode **terpasang**.
Direktori program read-only di Windows dan bisa terhapus saat update — pengguna
kehilangan dana tanpa peringatan.

## Mode portabel

`.exe` tunggal, tanpa instalasi, tanpa hak admin. Cocok untuk USB atau
komputer bersama.

Cara kerjanya: launcher `portable` electron-builder menyetel
`PORTABLE_EXECUTABLE_DIR`, dan `main.cjs` memakainya untuk memindahkan
direktori data ke `NexChainWallet-Data/` di samping `.exe`.

```bash
bun run wallet:portable      # hanya .exe portabel
bun run wallet:installer     # hanya installer NSIS
bun run wallet:dist          # keduanya
```

**Ini bagian yang mudah salah.** Tanpa pengalihan direktori data, `.exe`
"portabel" tetap menulis ke `%APPDATA%` — sehingga wallet terlihat **hilang**
saat `.exe` dibawa ke komputer lain. Deteksi ini dijaga oleh
`bun run wallet:smoke:portable`, yang menguji tiga skenario: tanpa env
(profil pengguna), dengan env (dialihkan), dan env menunjuk folder yang tidak
bisa ditulis (kembali ke profil, tidak crash).

Yang perlu diketahui pengguna portabel:

- Pindahkan `.exe` **dan** `NexChainWallet-Data/` bersama-sama. Hanya `.exe`
  = wallet hilang.
- Backup = salin folder `NexChainWallet-Data/`.
- Folder itu berisi blob **terenkripsi**, bukan mnemonic mentah. Passphrase
  tetap wajib untuk membukanya.
- Jangan taruh di folder yang dibersihkan otomatis (Downloads, Temp).

Kalau folder tujuan tidak bisa ditulis (CD-ROM, folder jaringan read-only),
aplikasi **tidak** gagal — ia kembali ke profil pengguna dan mencetak
peringatan ke konsol.

## Keamanan

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Renderer **tidak** punya akses filesystem — hanya empat operasi di atas.
- Kunci divalidasi di proses utama: hanya `[a-z0-9._-]{1,64}`, dan path hasil
  resolusi wajib tetap di dalam `walletDir` (menolak `../`).
- Nilai dibatasi 1 MiB; penulisan atomik (tmp → fsync → rename) agar mati
  listrik tidak menyisakan JSON separuh yang merusak vault.
- Tautan eksternal dibuka di browser sistem; navigasi jendela diblokir.
- Uninstaller **tidak** menghapus data vault (`deleteAppDataOnUninstall: false`).

## Perintah

```bash
bun run wallet:desktop           # build + jalankan
bun run wallet:desktop:dev       # dev server Vite + Electron
bun run wallet:smoke:desktop     # 18 pemeriksaan (IPC, jembatan, renderer)
bun run wallet:smoke:portable    # 3 pemeriksaan mode portabel
bun run wallet:desktop:pack      # kemas .exe (belum installer)
bun run wallet:portable          # .exe portabel
bun run wallet:installer         # installer NSIS
bun run wallet:dist              # keduanya
```

## Tanpa `.env`

Wallet desktop **berjalan tanpa `.env`**. Semua nilai punya default: URL node
diisi lewat layar Settings, explorer kosong, backend vault disuntik shell.
Lihat komentar di `wallet/.env.example`.

## Catatan lingkungan uji

Di lingkungan tanpa GPU/display (sandbox, CI, sesi terpencil), proses GPU
Chromium mati dan Electron **mematikan aplikasi** dengan
`GPU process isn't usable. Goodbye.` Ini terjadi juga pada Electron vanilla
tanpa kode kita. Untuk menjalankan uji di lingkungan seperti itu, set
`NEX_DISABLE_GPU=1`.

`disable-gpu` **sendiri tidak cukup** di Electron 44 — Chromium tetap
menjalankan proses GPU untuk compositing, dan proses itu tetap crash dan tetap
membunuh aplikasi. Yang benar-benar menghentikannya adalah
`disable-gpu-sandbox`. Lihat blok `NEX_DISABLE_GPU` di `main.cjs`.

Skrip uji juga menghapus `ELECTRON_RUN_AS_NODE` dari lingkungan anak. Bila env
itu ada, Electron berjalan sebagai Node biasa dan `require('electron')`
mengembalikan path executable (string), bukan API — sehingga `app` menjadi
`undefined`.

