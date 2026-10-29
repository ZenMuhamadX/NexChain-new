# shells/web/ — PWA (iOS/Android)

Shell ketiga: wallet yang **dipasang** ke layar utama HP. Ia memakai `src/`
yang sama dengan desktop dan dev — tidak ada layar yang diduplikasi.

```bash
bun run wallet:build:web     # tsc + vite build --mode web → wallet/dist/web
bun run wallet:preview:web   # sajikan dist/web di http://localhost:5174
bun run wallet:smoke:pwa     # gate: build ulang + periksa seluruh artefak
```

## Kenapa direktori ini adalah Vite ROOT

`vite.config.ts` memakai `root: shells/web` **hanya** untuk target `web`.
Alasannya bukan selera: `vite-plugin-pwa` menurunkan `navigateFallback`,
scope, dan daftar precache dari root build. Dengan root di sini, hasilnya:

```
wallet/dist/web/
  index.html              ← AKAR, bukan subfolder shell
  sw.js
  manifest.webmanifest
  workbox-<hash>.js
  assets/…                ← bundle ber-hash
  pwa-192x192.png  pwa-512x512.png  maskable-icon-512x512.png
  apple-touch-icon-180x180.png  favicon.ico  favicon.svg
```

Kalau HTML-nya tetap di `dist/web/shells/web/index.html`, service worker akan
jatuh ke fallback navigation yang salah tanpa error yang jelas. Shell dev dan
desktop tetap memakai `wallet/` sebagai root, jadi keduanya tidak berubah.

`preview.port` sengaja **5174**: `defaultRpcUrl()` menurunkan
`http://localhost:8000/rpc` untuk halaman loopback, dan allowlist CORS node
hanya memuat `:5173`/`:5174`. Port default `vite preview` (4173) akan diblokir
browser dan membuat wallet tampil "RPC offline" padahal node hidup.

## Berkas

| Berkas                          | Isi                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `index.html`                    | meta PWA + CSP + meta iOS (`apple-mobile-web-app-*`, `apple-touch-icon`, `viewport-fit=cover`) |
| `main.tsx`                      | urutan boot: vault IndexedDB → platform PWA → URL RPC → render                                 |
| `PwaOverlay.tsx`                | banner "versi baru tersedia" (dibuat shell, bukan layar bersama)                               |
| `public/*.svg`                  | sumber ikon: `favicon.svg` (badge) dan `maskable.svg` (full-bleed)                             |
| `public/*.png`, `favicon.ico`   | hasil generator, **di-commit**                                                                 |
| `pwa-assets.config.ts`          | preset ikon "any" (padding 0)                                                                  |
| `pwa-assets.maskable.config.ts` | preset maskable + apple-touch (padding 0)                                                      |

`<link rel="manifest">` **tidak** ditulis tangan — plugin menyuntikkannya saat
build. Menambahkannya manual berisiko menunjuk berkas yang tidak pernah
dihasilkan.

## Keputusan PWA (dan alasannya)

| Setelan                    | Nilai        | Kalau salah                                                                                     |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `registerType`             | `prompt`     | `autoUpdate` memaksa `skipWaiting` + reload sendiri — transaksi yang sedang dikirim bisa hilang |
| `injectRegister`           | `null`       | pendaftaran dilakukan `src/pwa/register.ts` supaya status update bisa dirender React            |
| `runtimeCaching`           | `[]`         | meng-cache respons RPC = saldo/riwayat basi tanpa gejala                                        |
| `navigateFallbackDenylist` | `[/^\/rpc/]` | navigasi ke `/rpc` akan dilayani `index.html`                                                   |
| `devOptions.enabled`       | `false`      | SW dev meng-cache HMR dan membuat perubahan tidak muncul                                        |
| `includeManifestIcons`     | `false`      | ikon masuk precache dua kali (glob + manifest) → entri duplikat                                 |

Di dev (`devOptions` mati) `virtual:pwa-register` di-resolve plugin menjadi
**no-op**, jadi `vite --mode web` tetap bisa dipakai untuk mengerjakan UI shell
ini. Yang tidak boleh diharapkan di dev: service worker, prompt pemasangan, dan
mode offline. Uji itu lewat `wallet:preview:web`.

## Ikon

Ikon dihasilkan sekali dari mark brand yang sama dengan header wallet
(`src/ui/BrandMark.tsx`), lalu **di-commit** — build tidak butuh generator.

```bash
bun run wallet:icons     # butuh @vite-pwa/assets-generator (devDependency)
```

Dua sumber, dua tujuan:

- `favicon.svg` → `pwa-192x192.png`, `pwa-512x512.png`, `favicon.ico`.
  Badge rounded-square mengisi penuh kanvas, `padding: 0`.
- `maskable.svg` → `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`.
  Latar gradient **full-bleed** (mark 72%, masuk safe-zone 80% Android), supaya
  setelah iOS/Android menerapkan mask squircle tidak ada sudut transparan.

Padding bawaan generator (0.3) sengaja dimatikan: ia membuat ikon mengambang
dengan bingkai kosong, dan itu terlihat jelas di launcher.

## Menguji

### Di desktop (paling cepat)

```bash
bun run wallet:build:web
bun run wallet:preview:web
```

1. Buka `http://localhost:5174` di Chrome.
2. DevTools → **Application → Manifest**: tidak ada error, ikon tampil.
3. **Application → Service Workers**: status _activated and is running_.
4. Ikon "install" muncul di address bar (atau menu ⋮ → Instal).
5. Aktifkan **Offline** di DevTools → reload: aplikasi tetap terbuka (unlock
   tetap jalan karena kripto lokal; saldo akan menampilkan "RPC offline").
6. Uji update: ubah sesuatu → `bun run wallet:build:web` → reload tab dua kali.
   Banner "Versi baru tersedia" muncul dan **hanya** reload kalau diklik.

### Di Android

`chrome://inspect` → _Port forwarding_ `5174 → localhost:5174`, lalu buka
`http://localhost:5174` di Chrome HP. Origin-nya tetap `localhost`, jadi service
worker dan install prompt aktif tanpa sertifikat.

### Di iOS

Tidak ada trik port-forwarding. iPhone hanya memasang PWA dari **HTTPS** (atau
`localhost`) dan hanya lewat **Safari**:

1. Buka alamat wallet di Safari, tunggu sekali muat penuh.
2. Bagikan → **Tambah ke Layar Utama**.
3. Buka dari ikon: harus tanpa address bar. Kalau masih ada address bar, berarti
   terbaca sebagai bookmark — periksa `display: standalone` dan
   `apple-mobile-web-app-capable`.

Lewat `http://192.168.x.x`, browser mematikan service worker tanpa peringatan.
Kartu "Aplikasi" di Settings menampilkan peringatan itu (`platform.secure`).

## Yang perlu diketahui saat deploy

- Wallet mengasumsikan dirinya berada di **akar satu origin** (`base: '/'`,
  `scope: '/'`). `/rpc` harus berada di origin yang sama — dengan begitu tidak
  ada CORS, tidak ada mixed content, dan URL node tidak perlu diisi manual.
- `sw.js`, `index.html`, dan `manifest.webmanifest` wajib **tidak** di-cache
  panjang oleh proxy/CDN. `sw.js` basi = update tidak pernah sampai ke pengguna.
  `/assets/*` boleh `immutable` (nama berkas ber-hash).
- Jangan sisipkan skrip pihak ketiga (analytics, Rocket Loader, auto-minify) di
  origin wallet: CSP memblokirnya, dan mengubah byte halaman berarti mengubah
  apa yang di-cache service worker.
- Vault terikat **origin**. Membuat wallet di lokal lalu pindah domain berarti
  wallet tidak ikut — impor mnemonic di origin final.

## Debugging

- Service worker "nyangkut" saat eksperimen: DevTools → Application → Service
  Workers → **Unregister**, lalu _Clear storage_. Banner update juga tidak akan
  muncul kalau registrasinya sudah ter-unregister.
- Cache dari build lama: `cleanupOutdatedCaches` hanya menghapus cache Workbox
  versi lama; kalau perlu bersih total, pakai _Clear storage_.
- Kalau ikon membuka Safari penuh (bukan standalone), yang salah adalah meta
  iOS atau cara pemasangannya (bookmark), bukan manifest.
