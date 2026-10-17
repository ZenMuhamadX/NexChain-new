# NexChain — Standarisasi Logo (v1)

> **Status: arah sudah dipilih.** Marka resmi NexChain adalah **05 — Nex Flow**.
> Set produksinya ada di **`design/nexchain-logo/`** — pakai berkas dari sana, bukan
> dari folder ini. Folder ini tetap disimpan sebagai catatan eksplorasi dan sebagai
> sumber aturan yang berlaku untuk marka terpilih.

Dokumen ini adalah aturan tetap untuk marka NexChain. Isinya: lima arah bentuk yang
dipertimbangkan, plus sistem aturan yang berlaku untuk marka resmi.

**Lihat dulu:** buka `index.html` di browser (klik dua kali, tidak perlu server).
Halaman itu menampilkan kelima arah, lockup, uji ukuran 16–256 px, diagram ruang bebas,
pratinjau app icon/favicon, contoh boleh/tidak, dan tombol unduh tiap berkas SVG.

Semua berkas di `svg/` adalah SVG mandiri (`viewBox` rapi, tanpa font eksternal, tanpa
gradien, tanpa filter). Marka digambar dengan `path`/`rect`/`polygon`; wordmark NEXCHAIN
dibangun dari segmen garis pada grid 5×7 sehingga sudah ter-outline — tidak bergantung
pada font yang terpasang di mesin pengguna.

---

## 1. Lima arah

| # | Nama | Bentuk inti | Siluet | Min. |
|---|------|-------------|--------|------|
| 01 | **Monogram N** | Huruf N, diagonal mint | huruf N | 16 px |
| 02 | **Hex Core** | Heksagon garis + inti segitiga | heksagon | 24 px |
| 03 | **Satu Mata Rantai** | Satu mata rantai miring 45°, ujung mint | lozenge | 16 px |
| 04 | **Tumpukan Blok** | Tiga bilah anak tangga naik ke kanan | anak tangga | 16 px |
| 05 | **Nex Flow** ← **dipilih** | Dua chevron maju | chevron | 16 px |

Ringkasan pertimbangan:

- **01 Monogram N** — paling aman dan paling tinggi legibilitasnya. Huruf pertama brand
  langsung jadi marka. Risiko: huruf N dipakai banyak brand, jadi aksen mint di diagonal
  bukan hiasan — itu yang membedakannya.
- **02 Hex Core** — heksagon sebagai cangkang blok, segitiga mint sebagai inti yang sudah
  tervalidasi. Paling seimbang secara optis. Risiko: heksagon adalah pola umum di industri
  kripto, jadi proporsinya harus dijaga.
- **03 Satu Mata Rantai** — metafor rantai paling langsung dan hanya memakai satu objek.
  Risiko: tanpa ujung mint, bentuknya bisa terlihat seperti ikon tautan biasa.
- **04 Tumpukan Blok** — siluet anak tangga membaca "ledger yang bertambah". Paling
  sederhana, paling aman di ukuran ekstrem. Risiko: tanpa mint, bisa terlihat seperti
  ikon grafik batang.
- **05 Nex Flow** — paling ringkas dan paling netral maknanya. Risiko: satu keluarga
  bentuk dengan ikon *fast-forward*, jadi jarak 28 px antar chevron wajib dijaga.

Catatan: `design/logo-concepts/` berisi lima eksplorasi lama (Tangga Heks, Tri-Link,
Monogram N, Cincin N, Balok Heks). Folder itu arsip eksplorasi, bukan bagian dari sistem
ini. Jangan pakai berkas dari sana untuk produksi.

---

## 2. Sistem logo

Tiga tingkatan, dipakai berurutan sesuai ruang yang tersedia.

| Tingkatan | Isi | Dipakai kalau |
|-----------|-----|---------------|
| **Marka** | Bentuk saja, tanpa teks | Ruang sempit atau persegi: ikon, avatar, favicon, sidebar |
| **Lockup horizontal** | Marka + wordmark NEXCHAIN sejajar | Ruang lebar: header, README, dokumen |
| **Lockup vertikal** | Marka di atas, wordmark di bawah | Ruang tinggi dan sempit: splash, poster, kartu |

Proporsi lockup yang dikunci (jangan diubah):

- Tinggi kapital wordmark = **0,36 ×** tinggi marka
- Jarak marka ke wordmark = **0,34 ×** tinggi marka
- Marka selalu dinormalkan ke kotak **100 × 100** (sisi terpanjang = 100) sebelum ditempel
- Wordmark selalu satu warna (biru utama, atau putih di latar gelap) — tidak pernah dua warna

Penulisan nama:

- Prosa dan UI: **NexChain** (camel case)
- Wordmark: **NEXCHAIN** (kapital penuh)
- Jangan menulis "Nexchain", "nexchain", "Nex Chain", atau "NEX CHAIN" di materi baru.

---

## 3. Ruang bebas

Ruang bebas minimum di keempat sisi = **x = 0,25 × tinggi marka**.

Tidak ada apa pun yang boleh masuk ke area itu: teks, garis pemisah, tepi kontainer,
tombol, atau marka lain. Untuk lockup, `x` dihitung dari tinggi marka, bukan tinggi
keseluruhan lockup.

Di dalam `index.html` ada diagram yang menggambarkan aturan ini untuk arah terpilih.

---

## 4. Ukuran minimum

| Pemakaian | Digital | Cetak |
|-----------|---------|-------|
| Marka saja | 16 px | 8 mm |
| Lockup horizontal | 96 px | 24 mm |
| Lockup vertikal | 64 px | 16 mm |
| Favicon / ikon tab | 16 px | — |
| App icon | 48 px | — |

Khusus **02 Hex Core**: minimum 24 px. Garis heksagonnya setebal 15/256, jadi di 16 px
tebal garis efektifnya hanya 0,94 px dan inti segitiga luntur menjadi gumpalan. Kalau
memang harus muncul di 16 px, pakai versi satu warna dan naikkan kontras latar.

Di bawah 24 px, kalau latar di belakangnya ramai (foto, pola, gradien), pakai versi
satu warna — bukan versi dua warna.

---

## 5. Warna

Palet logo memakai empat token yang sudah ada di explorer, wallet, dan miner-ui.
Logo **tidak menambah warna baru**.

| Peran | Hex | Keterangan |
|-------|-----|------------|
| Biru utama | `#0784c3` | Warna utama marka di latar terang |
| Mint aksen | `#00c9a7` | Elemen penanda: diagonal, inti, ujung rantai, bilah teratas, chevron kedua |
| Biru gelap | `#05628f` | Hanya untuk muka bayangan (dipakai di arsip konsep lama) |
| Tinta | `#0b1620` | Latar gelap resmi, dan warna versi mono untuk latar terang |

Aturan per latar:

| Latar | Berkas | Isi |
|-------|--------|-----|
| Terang (putih / `#f6f8fa`) | `*-mark.svg`, `*-lockup-h.svg` | Biru `#0784c3` + mint `#00c9a7` |
| Gelap (`#0b1620`) | `*-mark-inverse.svg`, `*-lockup-h-inverse.svg` | Putih `#ffffff` + mint `#00c9a7` |
| Satu warna, latar terang | `*-mark-mono.svg` | `#0b1620` penuh |
| Satu warna, latar gelap | `*-favicon.svg` (isi marka) | `#ffffff` penuh |

Kontras minimum yang harus dijaga: **3:1** antara marka dan latarnya. Biru `#0784c3` di
atas putih lolos; biru `#0784c3` di atas tinta `#0b1620` tidak lolos — karena itu versi
`inverse` wajib dipakai di latar gelap.

---

## 6. Ikon aplikasi & favicon

- App icon: kanvas persegi, sudut **56/256 ≈ 22 %**, latar tinta `#0b1620`, marka
  dinormalkan ke **140/256 ≈ 55 %** dari sisi kanvas. Jangan menambahkan teks.
- Favicon: bentuk yang sama pada 32 px, radius **7/32**. Untuk tab browser cukup
  `favicon.svg` — tidak perlu `.ico` selama target browser modern.
- Marka tidak pernah menyentuh tepi kanvas ikon. Sisa ruang di luar marka adalah ruang bebas.

---

## 7. Boleh & tidak

**Boleh**

- Mengubah ukuran secara proporsional (kedua sisi dikali angka yang sama)
- Memilih versi normal atau `inverse` sesuai latar
- Memakai versi satu warna untuk cetak, ukir, laser, sablon, atau favicon
- Menempatkan marka di atas latar polos apa pun yang memenuhi kontras 3:1

**Tidak**

- Meregangkan atau mengepengkan — rasionya tidak boleh berubah
- Memutar marka dari sudut aslinya (kecuali 03 yang memang sudah miring 45°)
- Menambah glow, bayangan, gradien, bevel, atau tekstur
- Mengganti warna di luar token palet
- Menurunkan opasitas, atau mengubah marka jadi outline tipis
- Menambahkan teks, tagline, atau angka di dalam atau menempel pada marka
- Menaruh marka di dalam bentuk lain (lingkaran, perisai, badge) yang bukan app icon resmi
- Menyusun ulang, memotong, atau memisahkan elemen marka

---

## 8. Konvensi penamaan berkas

```
nx-<nomor>-<jenis>[-inverse|-mono].svg
```

| Bagian | Nilai |
|--------|-------|
| `nomor` | `01` … `05` |
| `jenis` | `mark`, `lockup-h`, `lockup-v`, `appicon`, `favicon` |
| `inverse` | Versi untuk latar gelap (putih + mint) |
| `mono` | Versi satu warna (hanya untuk `mark`) |

Contoh: `nx-03-lockup-h-inverse.svg`.

Aturan tambahan:

- Jangan mengganti nama berkas yang sudah ada — ganti isinya.
- Jangan menyimpan ekspor PNG kecuali untuk keperluan yang memang butuh raster
  (screenshot toko aplikasi, misalnya). Sumber kebenaran selalu SVG.
- Setiap berkas hanya berisi satu logo. Jangan menggabungkan beberapa varian dalam
  satu kanvas.

---

## 9. Peta pemakaian di repo

| Permukaan | Berkas | Tinggi | Catatan |
|-----------|--------|--------|---------|
| Header `explorer/` | `lockup-h-inverse` | 28 px | UI explorer bertema gelap |
| Header `wallet/`, `wallet-ui/` | `lockup-h` | 28 px | UI terang |
| Sidebar `miner-ui/` | `mark-inverse` | 32 px | Ruang sempit, marka saja |
| `favicon` tiap UI | `favicon` | 16 / 32 px | Satu berkas, dipakai semua UI |
| README & `docs/` (latar terang) | `lockup-h` | 40 px | |
| README (GitHub dark) | `lockup-h-inverse` | 40 px | GitHub menyalakan `<picture>` sesuai tema |
| App icon / PWA | `appicon` | 192–512 px | Ekspor PNG dari SVG ini kalau manifest menuntut PNG |
| Stempel, ukir, sablon satu warna | `mark-mono` | ≥ 8 mm | |

Belum ada satu pun permukaan di repo yang memakai logo ini. Saat mulai memasangnya,
pakai berkas dari `design/brand/svg/`, jangan menggambar ulang.

---

## 10. Regenerasi

`build.mjs` adalah satu-satunya sumber kebenaran. Semua SVG dan `index.html` dihasilkan
dari sana — jangan menyunting berkas di `svg/` secara langsung, karena akan tertimpa.

```bash
node design/brand/build.mjs
```

Kalau perlu mengubah bentuk, proporsi lockup, atau warna: ubah di `build.mjs` lalu
jalankan ulang. Sesudah itu buka `index.html` dan periksa ulang uji ukuran 16 px.

---

## 11. Status keputusan

**Diputuskan.** Arah **05 — Nex Flow** dikunci sebagai marka resmi NexChain v1.

Yang menyertainya:

1. Set produksi ada di `design/nexchain-logo/` — 20 berkas, termasuk raster (PNG + ICO).
2. Empat arah lain (01, 02, 03, 04) tetap ada di `svg/` folder ini sebagai riwayat
   keputusan. **Jangan dipakai untuk produksi.**
3. `design/logo-concepts/` (lima eksplorasi yang lebih lama) juga tetap sebagai arsip.

Langkah lanjutan yang belum dikerjakan:

- Memasang favicon di `explorer/`, `wallet/`, `wallet-ui/`, dan `miner-ui/`.
- Mengganti header tiap UI ke lockup yang sesuai (lihat tabel di bagian 9).
- Memakai lockup di README dan `docs/`.

Kalau marka ini diubah, naikkan versinya dan sisakan salinan v1 — brand mark yang
berubah tanpa jejak versi membingungkan materi lama yang masih beredar.
