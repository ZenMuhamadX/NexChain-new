# apps/miner-rs — miner Rust (RPC-only, keyless)

Miner PoW NexChain sebagai **binary native**. Tugasnya hanya satu: minta job,
cari nonce, submit.

```
nex_getWork(minerAddress) → hash payload‖nonce → nex_submitWork(jobId, nonce, hash) → ulangi
```

Tidak ada database, wallet, seed, atau private key. Node memverifikasi ulang
setiap submit; miner tidak bisa memanipulasi rantai. Hanya tiga aturan
konsensus yang disalin: SHA-256, `meetsDifficulty`, dan format alamat — dan
ketiganya dijaga test paritas terhadap vektor Bun (`cargo test`).

## Build

Butuh Rust (https://rustup.rs). Sekali saja:

```
cd apps/miner-rs
cargo build --release
```

Hasil:

- Windows: `apps\miner-rs\target\release\nex-miner.exe`
- Linux/macOS: `apps/miner-rs/target/release/nex-miner`

Binary-nya mandiri — boleh disalin ke mesin lain yang punya Rust tidak.
`cargo build` pertama mengunduh empat crate (`sha2`, `serde_json`, `ureq`,
`rpassword`), sesudahnya offline.

## Jalankan

```
nex-miner --address NxC...
nex-miner --rpc http://192.168.1.10:8000/rpc --address NxC... --threads 6
```

| flag | default | keterangan |
|---|---|---|
| `--address` | wajib (prompt kalau TTY) | alamat penerima hadiah, `NxC`/`NxS` 43 char |
| `--rpc` | `NEX_RPC_URL` → `http://localhost:8000/rpc` | endpoint JSON-RPC |
| `--threads` | jumlah CPU logis | turunkan kalau laptop kepanasan |
| `--user` | `NEX_RPC_USER` | username Basic Auth |
| `-h`, `--help` | | bantuan |

Password **tidak pernah lewat flag** (bocor ke process list dan riwayat shell).
Pakai env `NEX_RPC_PASS`, atau biarkan miner menanyakan dengan input tersembunyi
saat node membalas 401/403.

Headless (systemd/VPS) — simpan di `EnvironmentFile` dengan permission 600:

```
NEX_RPC_USER=miner
NEX_RPC_PASS=...
NEX_RPC_URL=https://node.example/rpc
```

## Node jarak jauh

Method tulis (`nex_getWork`, `nex_submitWork`) **loopback-only kalau
`RPC_USER`/`RPC_PASSWORD` kosong**. Node yang ditambang dari mesin lain harus
disetel:

```
RPC_BIND_HOST=0.0.0.0
RPC_USER=...
RPC_PASSWORD=...
```

Basic Auth lewat `http://` terkirim polos — untuk internet, taruh node di
belakang reverse proxy HTTPS (`--rpc https://...`; ureq memakai rustls).

Kalau miner dan node di mesin yang sama, tidak ada yang perlu diubah.

## Performa

Preimage blok nyata 567 byte = 9 blok SHA-256. Miner menghitung blok penuh
sebelum sisa payload SEKALI per job (midstate lewat `sha2::compress256`), lalu
tiap nonce hanya mengompres ekor: 2 blok untuk payload ini (sisa 55 byte + 7
digit nonce + padding), 1 blok kalau sisa payload < 49 byte.

Terukur di i5-8350U (4C/8T, tanpa SHA-NI), payload blok nyata 567 byte:

| jalur | throughput |
|---|---|
| miner Bun (`apps/miner/miner.ts`, `node:crypto`) | 0.10 MH/s |
| **miner Rust, 1 thread** | **1.18 MH/s** |
| miner Rust, 2 thread | 1.9 MH/s |
| miner Rust, 4 thread | 3.3 MH/s |
| miner Rust, 8 thread | 4.4 MH/s |

Angka 8 thread itu di laptop yang sudah turun ke 1.4 GHz; CPU dengan SHA-NI
jauh lebih cepat. Kalibrasi dengan `--threads` — melebihi jumlah core fisik
biasanya hanya menambah panas. `cargo test --release -- --ignored --nocapture`
mencetak ulang angka 1 thread di mesin Anda.

## Uji

```
cargo test                                   # paritas hash + aturan difficulty
cargo test --release -- --ignored --nocapture # benchmark 1 thread
```

Test paritas memakai vektor yang dihasilkan dari `node:crypto` (sumber yang sama
dengan `apps/miner/miner.ts`). Kalau aturan konsensus di `src/core/` berubah,
perbarui `PARITY_VECTORS` di `src/midstate.rs` dan vektor difficulty di
`src/difficulty.rs` — jangan hanya mengubah test-nya.

## Troubleshooting

| gejala | penyebab |
|---|---|
| `getWork ditolak: ...` berulang | node belum selesai sync (IBD), atau `minerAddress` ditolak |
| `401/403` walau password benar | node memakai `RPC_USER`/`RPC_PASSWORD` berbeda |
| `HTTP: Connection refused` | salah port / node mati / bind hanya loopback di mesin lain |
| selalu `Ditolak: ...` saat submit | hash tidak cocok — jangan ubah aturan nonce; jalankan `cargo test` |
