# Diskusi: Sumber Wallet NexChain — Desktop GUI + Ekstensi

> **Status: DRAF DISKUSI.** Belum ada keputusan implementasi dan belum ada kode.
> Dokumen ini mencatat lingkup, struktur target, nasib `wallet-ext`, dampak
> arsitektur, risiko, dan keputusan terbuka.

## 1. Lingkup & prinsip

- `wallet-ui` **dilebur** menjadi satu sumber bernama **`wallet`** — kode sumber
  wallet NexChain yang **independen**.
- Hasil build utamanya: **aplikasi GUI desktop (.exe)**.
- Wallet **tidak menjalankan node**, tidak ada *sidecar*; satu-satunya
  ketergantungan eksternal adalah koneksi ke node RPC (`HTTP JSON-RPC`, `POST /rpc`).
- `wallet-ext` **tetap ada** sebagai produk berbasis browser (ekstensi MV3).
- Node tetap validator terakhir; wallet hanya menyusun, menandatangani, lalu
  mengirim lewat `nex_sendRawTransaction`.

## 2. PERINGATAN: nama `wallet/` bertabrakan di root repo

Di root repo NexChain, `wallet/` **sudah dipakai** sebagai direktori data runtime
node dan **di-*gitignore***:

- `.gitignore` baris 33 → `/wallet`
- `src/wallet/utils/loadWallet.ts` → `path.join(__dirname, '../../wallet/${walletName}.json')`
- Isi `wallet/main.json` = phrase wallet node (rahasia).

Konsekuensi: **jangan** menaruh sumber wallet baru di `wallet/` pada root repo
(git akan mengabaikannya; dan bercampur dengan file mnemonic node).

Pilihan:

| Pilihan | Nama/lokasi | Catatan |
| --- | --- | --- |
| **Repo terpisah (disarankan)** | repo `nexchain-wallet` (atau `wallet`) | Benar-benar independen; nama `wallet` bebas. Selaras dengan tujuan "kode sumber independen". |
| Tetap di dalam repo | folder `wallet-app/` (bukan `wallet/`) | Menghindari tabrakan; tapi tidak "independen" secara repo. |
| Rename runtime node | `wallet/` → mis. `nodewallet/` | Invasif: ubah `loadWallet.ts` + `.gitignore` + `config/`; tidak disarankan. |

## 3. Struktur target `wallet`

```
nexchain-wallet/                 # repo sumber independen
├── core/                        # lintas-platform (dipakai desktop & ekstensi)
│   ├── screens/                 # Welcome, Unlock, Dashboard, Send, Receive, History, Settings
│   ├── ui/                      # Icon, Modal, Notice, AmountDisplay, CopyButton, …
│   └── lib/                     # vault, sendFlow, format, rpc (klien), explorerUrl
├── platform/                    # KONTRAK adapter (interface), tanpa implementasi
│   ├── storage.ts               # setara WalletKV (get/set/delete)
│   ├── rpcConfig.ts             # persistensi URL RPC
│   └── cryptoRunner.ts          # worker vs langsung
├── vendor/                      # snapshot core blockchain (dibekukan)
│   └── VENDOR.lock.json         # hash tiap file → deteksi drift
├── desktop/                     # shell GUI → .exe (Tauri/Electron)
│   └── adapters/                # storage file, config file, worker
└── extension/                   # shell MV3 → ekstensi (menyerap wallet-ext)
    ├── background/ content/ inpage/    # provider window.nexchain
    └── adapters/                # chrome.storage, provider
```

Ide intinya: **satu `core/` + satu `vendor/`, dua shell.** `desktop/` dan
`extension/` hanya berbeda pada adapter platform dan lapisan shell (window GUI
vs popup + service worker + provider).

## 4. Nasib `wallet-ext` — tiga opsi

### Opsi 1 — Serap menjadi target `extension/` di repo wallet *(disarankan)*

`wallet-ext` dipindah ke dalam repo wallet sebagai shell `extension/`, berbagi
`core/` dan `vendor/` yang sama dengan desktop.

- **Untung:** satu basis UI (anti-drift), satu snapshot core, satu tempat rilis.
  Fork ganda `wallet-ui` ↔ `wallet-ext` yang ada sekarang hilang.
- **Rugi:** ekstensi kehilangan sifat "detached sendiri" (kini repo wallet yang
  detached). Kompleksitas build naik (dua target dalam satu repo).
- **Catatan:** `window.nexchain` (provider dApp) hanya dimiliki shell ekstensi;
  desktop tidak butuh.

### Opsi 2 — Paket `wallet-core` bersama, dua repo konsumen

Repo `wallet` (desktop) dan `wallet-ext` tetap terpisah, keduanya mengimpor paket
`@nexchain/wallet-core` (screens + lib + kontrak platform).

- **Untung:** dua produk dengan siklus rilis independen; tetap satu sumber UI.
- **Rugi:** butuh setup workspace/paket; root `bun.lock` saat ini sengaja
  diabaikan sehingga perlu keputusan tooling.

### Opsi 3 — `wallet-ext` tetap fork mandiri (status quo, biaya terendah)

`wallet-ext` tidak disentuh; hanya sumber *vendor snapshot*-nya diarahkan ulang
(dari `wallet/core` untuk UI + root `src/` untuk core blockchain).

- **Untung:** desktop bisa dirilis cepat tanpa menyentuh ekstensi.
- **Rugi:** dua basis UI terus diduplikasi → drift UI/UX dan beban pemeliharaan
  ganda. Mekanisme `snapshotVendor.ts` + `VENDOR.lock.json` tetap hidup.

## 5. Bagaimana core blockchain didapat wallet?

Wallet tetap butuh subset core (derive kunci, build tx, sign, encode/decode).
Karena wallet harus independen, ada dua jalur:

| Jalur | Mekanisme | Catatan |
| --- | --- | --- |
| **Vendor snapshot** (seperti `wallet-ext` sekarang) | `snapshotVendor.ts` mengikuti import transitif dari entry point → `vendor/` + `VENDOR.lock.json` | Independen saat build; risiko drift dikelola lewat hash + `vendor:check`. |
| **Paket core bersama** | Ekstraksi `src/core`+`src/crypto`+… ke paket yang dipakai node & wallet | Satu sumber kebenaran; refactor besar pada tata letak repo node. |

Mekanisme repo terpisah sudah didukung: `snapshotVendor.ts` mencari sumber lewat
`--source <path>`, env `NEXCHAIN_ROOT`, atau tetangga `../`. Jadi repo wallet
terpisah tetap bisa menyegarkan snapshot dari repo node.

## 6. Dampak arsitektur

- **Seam storage.** `createWalletVault(kv)` (`src/client/wallet/walletVault.ts`)
  sudah menerima `WalletKV` (`src/client/wallet/kv.ts`). Tambah adapter file
  (desktop) dan chrome.storage (ekstensi) — logika vault tidak disentuh.
- **Skema kripto dipertahankan apa adanya:** PBKDF2-SHA256 310k + AES-GCM 256
  (`vaultCrypto.ts`) dengan fallback JS murni (`jsCrypto.ts`). Private key tetap
  tidak pernah dipersist.
- **Signing tetap secp256k1 via `elliptic`** (Web Crypto tidak mendukung
  secp256k1); PBKDF2 tetap di Web Worker (`workers/crypto.worker.ts`).
- **Konfigurasi RPC.** `localStorage` (web) → file config (desktop) /
  `chrome.storage` (ekstensi). Probe `testRpcUrl` dipakai ulang.
- **Bundle menyusut:** modul sisi node (`state/`, `consensus/`, `blockchain/`,
  `memPool`) tidak masuk. Sudah terbukti cukup oleh `check:browser` dan snapshot
  `wallet-ext` (66 file).

## 7. Opsi shell desktop

| Opsi | Reuse UI | Ukuran | Catatan |
| --- | --- | --- | --- |
| **Tauri 2** (Rust + WebView2) | Tinggi | ~3–10 MB | Webview browser-like → selaras disiplin `check:browser`. Butuh toolchain Rust + WebView2. Backend Rust untuk file/keychain. |
| **Electron** (Chromium + Node) | ~100% | ~80–150 MB | Migrasi paling mulus; packaging/signing/auto-update paling matang. Node API tersedia — tapi **jangan** dipakai agar tetap paritas dengan ekstensi. |
| **Wails / Neutralino** | Tinggi | Kecil | Ringan, ekosistem lebih tipis. |
| **Rewrite native** | Rendah | Kecil | Risiko tinggi: menulis ulang kripto → tx berpeluang ditolak node. |

Karena wallet tidak butuh Node API, keunggulan utama Electron menyusut;
disiplin "browser-clean" repo lebih cocok dengan webview bergaya browser.

## 8. Risiko

1. **Keamanan vault di OS (prioritas #1).** Sandbox origin browser hilang di
   desktop; perlu threat model (DPAPI/Keychain, hygiene memori, clipboard,
   auto-lock, perilaku uninstall).
2. **RPC tanpa autentikasi.** Node RPC saat ini tanpa auth; untuk node remote
   perlu TLS + auth (perubahan sisi node, di luar wallet, tapi harus diakui).
3. **Divergensi kripto.** Porting berisiko signature/hash tidak cocok. Mitigasi:
   reuse modul JS apa adanya + golden-vector test.
4. **Drift multi-codebase.** Empat konsumen core tanpa sumber bersama = drift
   pasti (README `wallet-ext` sudah memperingatkan: tx ditolak node).
5. **Migrasi pengguna `wallet-ui`.** IndexedDB browser tidak terbaca desktop →
   impor ulang mnemonic (UX sensitif keamanan).
6. **Ketergantungan ketersediaan node.** UX "RPC offline" harus dirancang.
7. **Supply chain, signing, auto-update.** Update channel wajib ditandatangani.
8. **Perbedaan webview lintas OS** (WebView2 / WKWebView / WebKitGTK).

## 9. Prinsip non-negosiabel

- **Jangan porting kripto.** Pakai ulang modul JS kanonik.
- **Jangan duplikasi aturan** (hash, `CHAIN_ID`, alamat, difficulty).
- **`WalletKV` adalah satu-satunya titik tukar storage.**
- **Wallet tidak menyentuh LevelDB / konsensus / blockchain.**
- Private key & mnemonic tidak pernah ditulis balik ke penyimpanan.

## 10. Checklist keputusan

- [ ] Lokasi sumber: **repo terpisah `nexchain-wallet`** vs folder `wallet-app/`.
- [ ] Nasib `wallet-ext`: **Opsi 1 (serap)** vs Opsi 2 (paket bersama) vs Opsi 3 (status quo).
- [ ] Cara ambil core: **vendor snapshot** vs paket core bersama.
- [ ] Shell: **Tauri** vs **Electron**.
- [ ] Key-at-rest: file + PBKDF2 saja, atau + DPAPI/Keychain.
- [ ] Platform: **Windows-first** vs multi-OS.
- [ ] Rilis: signing, auto-update, kebijakan wipe saat uninstall.
- [ ] Migrasi: jalur impor mnemonic dari `wallet-ui` lama.

## 11. Urutan diskusi yang disarankan

1. Tetapkan **lokasi & penamaan** sumber wallet (hindari tabrakan `wallet/`).
2. Tetapkan **nasib `wallet-ext`** (Opsi 1/2/3) — ini menentukan struktur repo.
3. Tetapkan **threat model key-at-rest**.
4. Pilih **shell** (Tauri vs Electron).
5. Baru bicara **packaging, signing, dan rilis**.
