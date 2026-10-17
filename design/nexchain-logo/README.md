# NexChain — Set Logo Produksi (Nex Flow)

Ini **satu-satunya** folder yang berisi logo NexChain untuk produksi. Arah **Nex Flow**
(dua chevron mengarah maju) sudah dikunci sebagai marka resmi; empat arah lain di
`../brand/` berstatus arsip eksplorasi dan tidak boleh dipakai.

Buka `preview.html` untuk melihat seluruh varian, uji ukuran, ruang bebas, dan contoh
boleh/tidak dalam satu halaman.

Untuk alasan di balik setiap aturan, lihat `../brand/README.md`.

---

## Isi folder

```
mark/    marka saja — untuk ruang sempit atau persegi
lockup/  marka + wordmark NEXCHAIN — untuk ruang lebar atau tinggi
icon/    ikon aplikasi & favicon — siap pasang
```

### `mark/`

| Berkas | Isi | Dipakai di |
|--------|-----|------------|
| `nexchain-mark.svg` | Biru `#0784c3` + mint `#00c9a7` | Latar terang |
| `nexchain-mark-inverse.svg` | Putih `#ffffff` + mint `#00c9a7` | Latar gelap |
| `nexchain-mark-mono.svg` | Satu warna tinta `#0b1620` | Cetak, ukir, laser, sablon (latar terang) |
| `nexchain-mark-mono-white.svg` | Satu warna putih `#ffffff` | Cetak / ukir (latar gelap) |

### `lockup/`

| Berkas | Isi |
|--------|-----|
| `nexchain-lockup-h.svg` | Horizontal, latar terang |
| `nexchain-lockup-h-inverse.svg` | Horizontal, latar gelap |
| `nexchain-lockup-v.svg` | Vertikal, latar terang |
| `nexchain-lockup-v-inverse.svg` | Vertikal, latar gelap |
| `nexchain-lockup-h-mono.svg` | Horizontal satu warna tinta |

Wordmark NEXCHAIN sudah di-outline (dibangun dari segmen garis, bukan `<text>`), jadi
bentuknya tidak berubah walau font di mesin pengguna berbeda.

### `icon/`

| Berkas | Isi |
|--------|-----|
| `nexchain-appicon.svg` | App icon 256 px, sudut membulat 22 %, sudut transparan |
| `nexchain-appicon-flat.svg` | Versi persegi penuh — untuk maskable / apple-touch |
| `favicon.svg` | Favicon 32 px |
| `favicon.ico` | Berisi 16, 32, dan 48 px |
| `nexchain-appicon-1024.png` | Persegi penuh, untuk toko aplikasi |
| `nexchain-appicon-512.png` | Persegi penuh, untuk manifest PWA |
| `nexchain-appicon-192.png` | Persegi penuh, untuk manifest PWA |
| `nexchain-apple-touch-icon.png` | 180 px, persegi penuh |
| `nexchain-mark-1024.png` | Marka transparan, palet terang — untuk slide/dokumen |
| `nexchain-mark-inverse-1024.png` | Marka transparan, palet gelap |

**Soal PNG ikon.** Semua PNG ikon sengaja **persegi penuh tanpa sudut membulat** — itu
yang diminta manifest PWA dan toko aplikasi; OS/launcher yang memotong sudutnya sendiri.
Kalau butuh tampilan bersudut untuk dipasang manual di UI, pakai `nexchain-appicon.svg`.

**PNG dan ICO adalah turunan.** Sumber kebenaran selalu SVG. Jangan menyunting PNG,
dan jangan memakai PNG sebagai acuan bentuk saat membuat materi baru.

---

## Aturan ringkas

**Ruang bebas.** Minimum `x = 0,25 × tinggi marka` di keempat sisi. Tidak ada teks, garis,
tepi kontainer, atau marka lain di dalam area itu.

**Ukuran minimum.**

| Pemakaian | Digital | Cetak |
|-----------|---------|-------|
| Marka saja | 16 px | 8 mm |
| Lockup horizontal | 96 px | 24 mm |
| Lockup vertikal | 64 px | 16 mm |
| Favicon / ikon tab | 16 px | — |
| App icon | 48 px | — |

**Warna.** `#0784c3` + `#00c9a7` di latar terang. Di latar gelap biru utama diganti
`#ffffff`, mint tetap. Alasannya kontras: `#0784c3` di atas tinta `#0b1620` hanya ≈2,3:1,
di bawah ambang 3:1.

**Jangan.** Meregangkan, memutar, menambah glow/bayangan/gradien, mengganti warna di luar
token, menurunkan opasitas, mengubah jadi outline tipis, menambahkan teks atau tagline,
atau menaruh marka di dalam bentuk lain.

---

## Cara pakai

**Favicon (semua UI).** Taruh `icon/favicon.ico` dan `icon/favicon.svg` di folder publik
aplikasi, lalu di `<head>`:

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

**Manifest PWA.**

```json
{
  "icons": [
    { "src": "/nexchain-appicon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/nexchain-appicon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/nexchain-appicon-flat.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
```

**README GitHub** — GitHub menyalakan tema gelap/terang sendiri, jadi sediakan dua berkas:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="design/nexchain-logo/lockup/nexchain-lockup-h-inverse.svg">
  <img alt="NexChain" src="design/nexchain-logo/lockup/nexchain-lockup-h.svg" height="40">
</picture>
```

**Header UI.** Pakai `lockup-h` di UI terang dan `lockup-h-inverse` di UI gelap, tinggi
28 px. Untuk sidebar sempit pakai `mark-inverse` 32 px.

---

## Regenerasi

```bash
node design/nexchain-logo/build.mjs
```

Skrip ini menulis ulang seluruh isi `mark/`, `lockup/`, `icon/`, dan `preview.html`.
Jangan menyunting berkas-berkas itu langsung — akan tertimpa.

Dua penjagaan yang berjalan otomatis:

1. **Cek penyimpangan.** Hasilnya dibandingkan dengan `../brand/svg/nx-05-*`. Kalau
   geometri di `../brand/build.mjs` diubah tanpa mengubah di sini, skrip **berhenti**
   dengan pesan `BEDA: ...`. Samakan keduanya sebelum lanjut.
2. **Cek raster.** Setiap PNG dibaca ulang dan diperiksa: dimensinya harus tepat, harus
   ada lebih dari satu warna (menangkap hasil kosong), dan PNG marka harus benar-benar
   punya piksel transparan. Kalau gagal, skrip melaporkannya sebagai gagal.

Raster butuh Chrome atau Edge. Skrip mencarinya di lokasi umum; kalau tidak ketemu, set
`CHROME_PATH`. Tanpa browser, SVG tetap dibuat dan raster dilewati.

---

## Status

Terkunci pada v1. Kalau marka ini diubah, naikkan versinya dan sisakan salinan v1 —
brand mark yang berubah tanpa jejak versi membingungkan materi lama yang masih beredar.
