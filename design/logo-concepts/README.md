# NexChain — Konsep Logo

Lima arah bentuk logo mark untuk **NexChain** (node proof-of-work TypeScript/Bun).
Semua marka asli, murni vektor, tanpa font eksternal — huruf N dibangun dari path, bukan `<text>`.

**Cara melihat:** buka `PREVIEW.html` di browser (klik dua kali saja, tidak perlu server).
Tiap konsep tampil di ukuran **256 px, 64 px, 16 px**, di latar **gelap dan terang**, plus kolom
**Monokrom** untuk menguji versi satu warna (favicon, ikon, ukir/laser).

Siluet tiap konsep sengaja dibuat berbeda jauh — bukan satu bentuk yang cuma diganti warna:

| # | Nama | Bentuk inti |
|---|------|-------------|
| 1 | Tangga Heks |Diagonal naik, tiga heksagon |
| 2 | Tri-Link |Tiga cincin lingkaran mengait |
| 3 | Monogram N |Huruf N angular, bingkai persegi |
| 4 | Cincin N |Cincin lingkaran + huruf N |
| 5 | Balok Heks |Balok isometrik 3D |

Palet dasar yang dipakai (mengikuti token UI explorer/wallet/miner yang sudah ada):

| Peran | Hex |
|-------|-----|
| Biru utama | `#0784c3` |
| Mint aksen | `#00c9a7` |
| Biru gelap (bayangan) | `#05628f` |
| Gelap UI | `#212529` |

---

## 01 — Tangga Heks

**Bentuk.** Tiga heksagon datar (blok ledger) disusun naik dari kiri-bawah ke kanan-atas,
dihubungkan dua batang penghubung yang menyerupai mata rantai. Heksagon paling atas diberi warna
mint sebagai “blok terbaru”.

**Kenapa cocok.** Heksagon adalah bentuk paling kuat untuk “blok”, dan arah diagonal naik membawa
makna *Nex* = next/berikutnya. Deretan tiga blok langsung membaca sebagai *chain* tanpa perlu
menggambar rantai penuh.

**Warna.** Blok `#0784c3`, penghubung `#0784c3`, blok terbaru `#00c9a7`. Versi monokrom: satu warna,
bentuk tetap terbaca.

**Kelemahan.** Arah diagonal sangat khas, sehingga saat dipasang di tempat yang sempit (header
sejajar, watermark sudut) ia cenderung terlihat miring dan butuh ruang kosong di sekitarnya.

---

## 02 — Tri-Link

**Bentuk.** Tiga mata rantai lingkaran dengan ketebalan sama, bertumpuk membentuk segitiga dan
saling mengait — mata rantai A menutup B, B menutup C, C menutup A. Susunan ini dibuat dengan mask,
bukan sekadar tiga lingkaran bertumpuk.

**Kenapa cocok.** Ini satu-satunya konsep yang menggabungkan dua metafor sekaligus: *rantai* (mata
rantai yang mengait) dan *jaringan node* (tiga titik yang saling terhubung). Selain itu, bentuknya
siklis — cocok untuk sistem yang terus bertambah bloknya.

**Warna.** Cincin atas `#00c9a7`, kanan `#0784c3`, kiri `#05628f`. Tiga nada membuat anyaman
“atas-bawah-atas” terbaca jelas. Monokrom tetap terbaca karena ketebalan sama.

**Kelemahan.** Dengan tiga warna, marka ini paling “ribet” dari semuanya — kalau dipakai di ukuran
sangat kecil, ketiga cincin mulai menyatu dan terlihat seperti satu bola berbunga. Di bawah 16 px
sebaiknya dipakai versi satu warna.

---

## 03 — Monogram N

**Bentuk.** Huruf N geometris berisi persegi. Dua batang vertikal dibangun dari path dengan potongan
chamfer di ujung (seperti ujung mata rantai), sementara diagonalnya diberi warna mint terpisah
sehingga terbaca sebagai mata rantai tengah.

**Kenapa cocok.** Pilihan paling aman untuk brand recognition: huruf pertama *Nex* langsung menjadi
marka, dan pekerjaan diagonal yang kontras memberi kesan “bergerak maju”. Legibilitas tertinggi dari
kelima konsep, bahkan di 16 px, karena siluetnya hanya terdiri dari garis tegas.

**Warna.** Batang `#0784c3`, diagonal `#00c9a7`. Di atas tile gelap, N putih juga jadi alternatif
kuat; versi monokrom cukup satu warna.

**Kelemahan.** Huruf N adalah elemen yang digunakan banyak brand lain, jadi tanpa warna mint di
diagonal ia mudah tertukar dengan logo generic. Bagian diagonal yang kontras jadi sangat menentukan
identitasnya.

---

## 04 — Cincin N

**Bentuk.** Cincin rantai tebal (stroke 20 px) yang terbuka 60° di sisi kanan, melingkupi huruf N di
tengah. Ujung cincin dipotong rata (butt cap) sehingga terlihat seperti mata rantai yang sudah
dipotong mesin, bukan lengkung biasa.

**Kenapa cocok.** Bentuk “lencana/cincin” paling kuat saat marka harus berdiri sendiri di ukuran
kecil (favicon tab browser, ikon app) karena massa visualnya padat dan bulat. Kesan “tertutup dan
terjamin” juga cocok untuk wallet.

**Warna.** Cincin `#0784c3`, N `#00c9a7`. Untuk aplikasi gelap, N bisa diganti putih agar kontras
maksimal. Monokrom: satu warna, tetap terbaca karena lubang tengah cukup besar.

**Kelemahan.** Konsep dengan huruf di dalam lingkaran adalah pola yang sangat umum di industri
blockchain, jadi risikonya terasa “sudah pernah dilihat”. Bukaannya 60° juga harus dijaga supaya
tidak kebetulan mirip simbol lembaga lain.

---

## 05 — Balok Heks

**Bentuk.** Balok isometrik dengan tiga muka: atas (mint), kiri (biru gelap), kanan (biru). Di muka
depan ada lubang berbentuk mata rantai yang tertembus, seolah ada rantai yang menembus balok.
Siluetnya heksagonal, tapi dibaca sebagai objek 3D, bukan belah ketupat datar.

**Kenapa cocok.** Satu-satunya konsep yang benar-benar terlihat seperti “blok”. Pemberian tiga nada
pada tiga muka memberi kesan volume dan kedalaman (ledger yang bertumpuk), dan lubang rantai
mengikatnya ke ide *chain* tanpa menambah elemen baru.

**Warna.** Atas `#00c9a7`, kiri `#05628f`, kanan `#0784c3`. Versi monokrom tetap berfungsi karena
ketiga muka hanya dibedakan oleh arah cahaya, bukan warna.

**Kelemahan.** Ini konsep yang paling rumit secara geometri, sehingga butuh perawatan ekstra kalau
nanti diekspor ke ikon bundar/app icon — bagian kiri dan kanan bisa terpotong. Lubang mata rantai
juga harus diperbesar sedikit agar tidak terbaca sebagai titik biasa di ukuran kecil.

---

## Catatan teknis

- Setiap file adalah SVG 256×256 mandiri, viewBox `0 0 256 256`, tanpa dependensi eksternal.
- Konsep 02 dan 05 memakai `<mask>` internal (ID unik per file), jadi aman dipakai bersamaan
  dalam satu halaman.
- Cukup ganti nilai `fill`/`stroke` untuk membuat versi monokrom: seluruh bentuk sudah berupa
  fill solid, bukan outline tipis.
- Palet mengikuti token `explorer/skillui-etherscan/etherscan-design/tokens/colors.json`
  (`#0784c3`, `#00c9a7`, `#212529`) agar logo langsung cocok dengan UI yang sudah ada.
