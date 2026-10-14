# `src/p2p/` — lapisan jaringan peer-to-peer

Lapisan ini membuat node bisa **menyinkronkan rantai dari peer lain** dan
**menyebarkan blok/transaksi** — tanpa mengubah jalur konsensus. Ia adalah
_konsumen_ `src/core/` (seperti `src/rpc/`), bukan bagian dari konsensus itu
sendiri.

Modelnya **Bitcoin-awal**, bukan Ethereum devp2p: node **tanpa identitas dan
tanpa kunci**. Peer dikenali dari `host:port`. Blok tidak ditandatangani siapa
pun — keamanannya dari PoW + hash chain, dan node hanya _memverifikasi_.

## Menyalakan

P2P **mati secara default**. Set `NEX_P2P_ENABLED=1` lalu isi seed:

```bash
NEX_P2P_ENABLED=1
NEX_P2P_PEERS=127.0.0.1:30303
```

Semua variabel ada di `.env.example`. Bind default `127.0.0.1` (loopback),
mengikuti kebijakan RPC.

## Peta modul

| Berkas                       | Tanggung jawab                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `config.ts`                  | Baca `NEX_P2P_*` dari env. Default aman (mati, loopback).                         |
| `types.ts`                   | **Kontrak** lintas modul (tipe + antarmuka). Semua modul hanya bicara lewat sini. |
| `protocol/messages.ts`       | Skema pesan v1 + `parseMessage` (fail-closed).                                    |
| `protocol/handshake.ts`      | Aturan `version`/`verack` (murni, bisa diuji tanpa socket).                       |
| `transport/framing.ts`       | Framing TCP: length-prefix 4 byte BE + JSON UTF-8.                                |
| `transport/connection.ts`    | Satu `PeerConnection` di atas socket Bun.                                         |
| `transport/server.ts`        | `Bun.listen` (inbound) + `Bun.connect` (outbound).                                |
| `peers/banList.ts`           | Daftar ban berbasis alamat, kedaluwarsa otomatis.                                 |
| `peers/peerManager.ts`       | Siklus hidup peer: handshake, ping/pong, ban, reconnect, maxPeers.                |
| `validation/connectBlock.ts` | Validasi blok asing + cek rantai ke tip, lalu `commitBlock`.                      |
| `sync/syncManager.ts`        | Protokol `getblocks`/`inv`/`getdata`/`block`/`tx`; menandai status sync.          |
| `broadcastGate.ts`           | Menekan siaran ganda saat memproses item masuk.                                   |
| `node.ts`                    | Orkestrator: `startP2P()`. Satu-satunya tempat semua dirangkai.                   |

Status sinkronisasi sendiri disimpan di `src/core/events/syncState.ts` (netral,
di sisi core) supaya `nex_getWork` dapat membacanya tanpa mengimpor `src/p2p/`.

## Protokol v1

Framing: `[uint32 BE length][JSON UTF-8]`.

Pesan: `version`, `verack`, `ping`, `pong`, `getblocks`, `inv`, `getdata`,
`block` (JSON `Block` apa adanya), `tx` (base64 RLP lewat `encodeTx`).

Alur sinkronisasi: peer menyambung → tukar `version`/`verack` (chain id +
genesis harus sama) → node yang tertinggal mengirim `getblocks` (locator dari
tip mundur) → peer membalas `inv` → `getdata` → `block` → `connectBlock`.

## Anti-mining-saat-sync (IBD)

Selama node masih mengejar rantai peer, `nex_getWork` **ditolak** supaya miner
tidak menambang di atas tip yang basi (rantai bercabang yang tak bisa di-reorg).
Statusnya netral — `src/core/events/syncState.ts` — sehingga `src/core/` bisa
membacanya TANPA mengimpor `src/p2p/` (aturan lapisan tetap utuh).

- **Kapan mulai "syncing"?** Saat P2P menyala DENGAN seed. Tanpa seed
  (`NEX_P2P_PEERS` kosong) node langsung "synced" — kasus node penambang
  tunggal devnet.
- **Kapan dianggap "menyusul"?** Hanya bila TERBUKTI dari data lokal: kita
  benar-benar memiliki tip yang diklaim peer itu (`status.bestHash` ada di
  penyimpanan kita) **dan** tak ada peer siap lain yang mengklaim lebih tinggi
  dari kita. `inv` kosong saja TIDAK cukup (bisa datang dari gossip blok lama
  atau peer yang berbohong), dan tinggi klaim peer tidak pernah boleh
  *membuka* gerbang — hanya boleh *menahannya*.
- **Katup pengaman.** Diukur dari kemajuan nyata terakhir (blok ter-commit),
  bukan dari peer menyambung / `inv` masuk. Bila `NEX_P2P_SYNC_TIMEOUT_MS`
  (default 60000, floor 1000) berlalu tanpa kemajuan, mining dibuka dengan
  fase **`assumed`** — bukan `synced`. Fase `assumed` masih boleh ditutup lagi
  bila nanti terbukti kita memang tertinggal.
- **Latch.** Fase `synced` melekat: blok gossip tidak menyalakan ulang gerbang.
  Pengecualian yang disengaja: bila peer yang BARU handshake mengklaim lebih
  tinggi dari tip kita (mis. reconnect ke node yang jauh lebih maju), gerbang
  ditutup lagi — memakai klaim untuk *menahan* selalu aman, dan menambang fork
  yang tak bisa di-reorg jauh lebih buruk.
- **Probe `getblocks` kedaluwarsa.** Satu peer yang diam (socket hidup karena
  `ping`, tapi tak pernah menjawab `getblocks`) tidak menyumbat pengejaran:
  probe basi diabaikan dan peer berikutnya dicoba.
- **Yang TIDAK digerbang:** `nex_submitWork` dan `connectBlock` — kerja miner
  yang sudah dihitung tetap bisa diselesaikan, dan blok dari peer tetap
  di-commit. Hanya pembuatan job baru (`nex_getWork`) yang ditahan.
- Cek dari klien: `nex_getSyncStatus` → `{ phase, syncing, localHeight,
  targetHeight, updatedAt }` (JSON polos, `phase ∈
  idle|syncing|assumed|synced`).

## Aturan keamanan yang penting

- **`connectBlock` menolak blok yang tidak menempel ke tip** (`height == tip+1`
  dan `previousBlockHash == tip.hash`). Karena itu rantai-palsu-yang-lebih-panjang
  mustahil diterima — reorg memang belum didukung.
- **Blok yang sudah ada tidak pernah di-commit ulang.** `commitBlock` menjalankan
  `processTransact`; meng-commit ulang akan mengkredit saldo dua kali.
- **Pelanggaran konsensus = fatal** (PoW/hash/struktur/merkle/hadiah/timestamp)
  → peer di-ban. **Ketidakcocokan tip = non-fatal** (mungkin hanya balapan),
  cukup diabaikan.
- Semua validasi blok memakai ulang modul `src/core/consensus/verify/module/*`
  — aturan yang sama dengan jalur mining, bukan salinan kedua.

## Uji

- `bun run check:p2p` — gerbang offline (framing, pesan, config, handshake, ban,
  status sync/IBD, dan arah dependensi `core ↛ p2p`).
- `bun run p2p:smoke` — tiga node localhost; node kedua harus menyusul tinggi
  rantai dan menerima relay tx, dan node ketiga (peer mati) harus menolak
  `nex_getWork` lalu membukanya lewat katup pengaman.
- `bun run p2p:evil -- <skenario> --host 127.0.0.1 --port 30303` — peer jahat
  (genesis salah, frame raksasa, blok curang) untuk memverifikasi pertahanan.
