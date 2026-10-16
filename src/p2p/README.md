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

| Berkas                       | Tanggung jawab                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `config.ts`                  | Baca `NEX_P2P_*` dari env. Default aman (mati, loopback).                                            |
| `types.ts`                   | **Kontrak** lintas modul (tipe + antarmuka). Semua modul hanya bicara lewat sini.                    |
| `protocol/messages.ts`       | Skema pesan v2 + `parseMessage` (fail-closed).                                                       |
| `protocol/handshake.ts`      | Aturan `version`/`verack` (murni, bisa diuji tanpa socket).                                          |
| `transport/framing.ts`       | Framing TCP: length-prefix 4 byte BE + JSON UTF-8.                                                   |
| `transport/connection.ts`    | Satu `PeerConnection` di atas socket Bun.                                                            |
| `transport/server.ts`        | `Bun.listen` (inbound) + `Bun.connect` (outbound).                                                   |
| `peers/banList.ts`           | Daftar ban berbasis alamat, kedaluwarsa otomatis.                                                    |
| `peers/peerManager.ts`       | Siklus hidup peer: handshake, ping/pong, ban, reconnect, maxPeers. Menerbitkan snapshot peer netral. |
| `validation/connectBlock.ts` | Validasi blok asing + jalur cabang (branch pool → reorg), lalu `commitBlock`.                        |
| `sync/syncManager.ts`        | Protokol `getblocks`/`inv`/`getdata`/`block`/`tx`; menandai status sync; re-announce mempool.        |
| `broadcastGate.ts`           | Menekan siaran ganda saat memproses item masuk.                                                      |
| `scheduling.ts`              | Pacing loop layanan: `yieldToLoop` + `forEachChunked` (serahkan giliran ke event loop tiap chunk).   |
| `node.ts`                    | Orkestrator: `startP2P()`. Satu-satunya tempat semua dirangkai.                                      |

Status sinkronisasi sendiri disimpan di `src/core/events/syncState.ts` (netral,
di sisi core) supaya `nex_getWork` dapat membacanya tanpa mengimpor `src/p2p/`.
Snapshot peer disimpan serupa di `src/core/events/peerState.ts` supaya
`nex_getPeerInfo` bisa membacanya tanpa mengimpor `src/p2p/`.

## Protokol v2

Framing: `[uint32 BE length][JSON UTF-8]`.

Pesan: `version`, `verack`, `ping`, `pong`, `getblocks`, `inv`, `getdata`,
`block`, `tx`.

Badan blok & transaksi dibawa sebagai string `base64(rlp(...))`, bukan JSON
mentah — nama field tidak lagi diulang di setiap pesan:

| Pesan   | `payload`                                 |
| ------- | ----------------------------------------- |
| `block` | `base64(rlp(block))` — `encodeBlock`      |
| `tx`    | `base64(0x02 ‖ rlp(signed))` — `encodeTx` |

Skema blok ada di `src/core/encoding/rlp/blockCodec.ts`, transaksi di
`txCodec.ts`; pembungkus base64 di `src/core/encoding/hex/{block,tx}/`.
`decodeBlock` menolak payload rusak keras (base64/RLP/skema), dan
`syncManager` memperlakukannya sebagai pelanggaran wire → ban.

Dua field header/body blok BUKAN bilangan bulat dan dikirim sebagai float64
8 byte big-endian: `size` (`byte / 1024`) dan `difficulty`
(`clampDifficulty` mengkuantisasi ke kelipatan 0.25 bit, jadi 21.5 sah).
Encoding integer untuk keduanya akan MENOLAK blok nyata dan mematikan
pengiriman blok.

**Naik v1 → v2 tidak kompatibel.** `handshake.ts` menolak versi protokol yang
berbeda secara FATAL, tanpa menawar turun-versi: semua node (termasuk peer di
`NEX_P2P_PEERS`) harus naik serentak. `P2P_PROTOCOL_VERSION` didefinisikan di
satu tempat (`protocol/messages.ts`).

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
  _membuka_ gerbang — hanya boleh _menahannya_.
- **Katup pengaman.** Diukur dari kemajuan nyata terakhir (blok ter-commit),
  bukan dari peer menyambung / `inv` masuk. Bila `NEX_P2P_SYNC_TIMEOUT_MS`
  (default 60000, floor 1000) berlalu tanpa kemajuan, mining dibuka dengan
  fase **`assumed`** — bukan `synced`. Fase `assumed` masih boleh ditutup lagi
  bila nanti terbukti kita memang tertinggal.
- **Latch.** Fase `synced` melekat: blok gossip tidak menyalakan ulang gerbang.
  Pengecualian yang disengaja: bila peer yang BARU handshake mengklaim lebih
  tinggi dari tip kita (mis. reconnect ke node yang jauh lebih maju), gerbang
  ditutup lagi — memakai klaim untuk _menahan_ selalu aman, dan menambang fork
  yang tak bisa di-reorg jauh lebih buruk.
- **Probe `getblocks` kedaluwarsa.** Satu peer yang diam (socket hidup karena
  `ping`, tapi tak pernah menjawab `getblocks`) tidak menyumbat pengejaran:
  probe basi diabaikan dan peer berikutnya dicoba.
- **Yang TIDAK digerbang:** `nex_submitWork` dan `connectBlock` — kerja miner
  yang sudah dihitung tetap bisa diselesaikan, dan blok dari peer tetap
  di-commit. Hanya pembuatan job baru (`nex_getWork`) yang ditahan.
- Cek dari klien: `nex_getSyncStatus` → `{ phase, syncing, localHeight,
targetHeight, updatedAt }` (JSON polos, `phase ∈
idle|syncing|assumed|synced|forked`). Fase **`forked`** menahan mining selama
  reorg (lihat bagian berikut); ia sengaja menimpa `synced` karena tip lokal
  memang sedang berubah, lalu ditutup oleh `markSynced()`.

## Reorg (satu rantai, fork choice berbasis kerja)

Reorg **didukung** (M2). Aturan pemilihan cabang mengikuti Bitcoin: kerja
kumulatif terbanyak (`Σ 2^difficulty`), bukan tinggi terpanjang.

- **`connectBlock` punya dua jalur.** Blok yang tepat melanjutkan tip
  (`height == tip+1` dan `previousBlockHash == tip.hash`) **di-commit langsung**.
  Blok lain diverifikasi terhadap **induknya** — timestamp diukur dari rantai
  nenek moyang induk, difficulty dihitung dari induk (lokal ATAU blok pooled) —
  lalu **diparkir di branch pool**. Induk yang belum tiba = orphan; PoW/hash/
  merkle/hadiah sudah lolos, difficulty diukur ulang saat replay.
- **Satu titik deteksi (R-2).** Semua cabang masuk lewat
  `onCompetingTip(hash)` di `src/core/consensus/reorg/reorg.ts`. Bila cabangnya
  tersambung ke rantai lokal DAN lebih berat → fase `forked` → rollback lewat
  undo journal → tx dari blok yang dibalik dikembalikan ke mempool → replay
  cabang pemenang **senyap** (`commitBlock` tidak menyiarkan) → `synced`.
- **Batas kedalaman** `MAX_REORG_DEPTH` (128, sama dengan kedalaman journal):
  cabang yang bercabang lebih dalam DITOLAK dengan pesan jelas.
- **`invalidateFrom(height)` (R-1).** Saat tip berubah, semua state turunan
  ber-key height/hash ≥ titik cabang (untuk sekarang: branch pool) dibuang dari
  satu tempat — bukan tersebar.
- **Selalu senyap saat replay** supaya kita tidak menggosipkan ulang blok yang
  baru saja diterima. Blok lokal yang kalah TIDAK di-commit ulang (dicek
  duplikat).
- **`src/core/consensus/reorg/`** (`forkChoice`, `branchPool`, `ancestry`,
  `reorg`) murni di sisi core; `src/p2p/` hanya memanggilnya. Pool in-memory
  (bukan LevelDB) supaya tak ada store ke-7 yang harus di-rollback.

## Observability & re-announce mempool (M3)

- **`nex_getPeerInfo`** (JSON polos, BUKAN hex) mengembalikan snapshot peer:
  `{ peers, count, maxPeers, banned, updatedAt }`. Setiap peer memuat
  `id`, `remoteAddress`, `remotePort`, `inbound`, `handshaked`, `connectedAt`,
  `lastSeenAt`, dan `status` (`bestHeight`/`bestHash`/`chainId`/`genesisHash`).
  Datanya ditulis `peerManager` ke `src/core/events/peerState.ts` (modul netral)
  dan dibaca RPC, sehingga core tak perlu mengimpor `src/p2p/`. Snapshot adalah
  **salinan** — pemanggil tak bisa memutasi state internal P2P.
- **Re-announce mempool.** Relay tx murni reaktif (`publishTx` → `inv`) sehingga
  peer yang menyambung SETELAH sebuah tx diterima tak pernah tahu tx itu ada.
  `syncManager` menutup celah ini dengan menyiarkan `inv` tx untuk seluruh
  mempool: sekali saat peer selesai handshake (`onPeerReady`) dan berkala tiap
  60 detik. Peer yang belum punya tx lalu meminta lewat `getdata` seperti biasa.

## Pacing layanan (S5/T04)

Node adalah SATU proses: RPC (`nex_getWork`, explorer, wallet) dan P2P berbagi
event loop. Loop layanan `getblocks`/`getdata`/`inv` mengiterasi sampai
`MAX_INV_BATCH` (256) item, dan `await` penyimpanan LevelDB hanya beresolusi
lewat **microtask** — yang dikuras habis sebelum event loop memeriksa
socket/timer. Tanpa jeda, satu permintaan peer yang besar bisa membuat
`nex_getWork` timeout dan UI tersendat.

`sync/syncManager.ts` karena itu memakai `forEachChunked` dari `scheduling.ts`:
memproses item per `NEX_P2P_SERVE_CHUNK` (default 32) lalu memanggil
`yieldToLoop()` (batas **makrotask**, `setImmediate`) di antara chunk. Urutan
item dan isi pesan tak berubah — hanya ada titik serah-giliran. Ini versi
sederhana dari _send queue_ + _token bucket_ Bitcoin; backpressure socket
sendiri belum ditangani (follow-up).

## Aturan keamanan yang penting

- **`connectBlock` menerima blok yang tidak menempel ke tip HANYA sebagai
  kandidat cabang** yang lebih berat (lihat "Reorg" di atas). Rantai-palsu yang
  tidak lebih berat cukup diparkir, tidak pernah mengganti tip.
- **Blok yang sudah ada tidak pernah di-commit ulang.** `commitBlock` menjalankan
  `processTransact`; meng-commit ulang akan mengkredit saldo dua kali.
- **Pelanggaran konsensus = fatal** (PoW/hash/struktur/merkle/hadiah/timestamp/
  difficulty) → peer di-ban. **Tip-link mismatch / duplikat = non-fatal**
  (mungkin hanya balapan), cukup diabaikan.
- Semua validasi blok memakai ulang modul `src/core/consensus/verify/module/*`
  — aturan yang sama dengan jalur mining, bukan salinan kedua.

## Uji

- `bun run check:p2p` — gerbang offline (framing, pesan, config, handshake, ban,
  status sync/IBD termasuk fase `forked`, snapshot observability peer, pacing
  serve `yieldToLoop`/`forEachChunked`, dan arah dependensi `core ↛ p2p`).
- `bun run check:reorg` — gerbang reorg (fork choice, branch pool, penelusuran
  nenek moyang, reorg penuh lewat LevelDB nyata, batas kedalaman, `invalidateFrom`).
- `bun run p2p:smoke` — tiga node localhost; node kedua harus menyusul tinggi
  rantai, `nex_getPeerInfo` di node pertama harus melaporkan peer ter-handshake,
  node kedua harus menerima relay tx, dan node ketiga (peer mati) harus menolak
  `nex_getWork` lalu membukanya lewat katup pengaman.
- `bun run p2p:evil -- <skenario> --host 127.0.0.1 --port 30303` — peer jahat
  (genesis salah, frame raksasa, blok curang) untuk memverifikasi pertahanan.
