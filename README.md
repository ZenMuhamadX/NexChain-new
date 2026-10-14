# Nexchain Core Integration/Staging

## What is Nexchain Core?

Nexchain is a new generation decentralized blockchain designed to provide a simple, secure, and transparent transaction platform. Nexchain Core connects to the Nex peer-to-peer network, allowing users to efficiently download and validate blocks and transactions.

### Key Features:

- **Decentralized Architecture:** Ensures security and transparency by distributing data across the network.
- **Transaction Facilitation:** Supports fast and secure transaction processing.
- **Wallet Integration:** Includes a built-in wallet for easy digital asset management.
- **Graphical User Interface (GUI):** Offers a user-friendly interface as an additional option.

## Devnet (Bitcoin-standard PoW)

Arsitektur mining mengikuti standar Bitcoin: **blok tidak ditandatangani siapa pun** — hanya transaksi yang ditandatangani (oleh pengirimnya). Node **tidak memiliki wallet** dan tidak pernah menghitung PoW sendiri:

- `bun run rpc:start` → node menyusun template blok, miner eksternal menerima job lewat `nex_getWork` (wajib mengirim `minerAddress`), mencari nonce, lalu mengirim solusi ke `nex_submitWork`.
- Miner eksternal: `bun run apps/miner/miner.ts "NxC…"` atau `apps/miner/runMiner.ts` (keyless, murni HTTP).
- Integritas rantai diverifikasi lewat PoW + hash chain + merkle + struktur (lihat `src/core/consensus/verify/verifyIntegrity.ts`) — tanpa pemeriksaan signature blok.

### Genesis (hardcoded, tanpa premine)

Blok genesis dikunci di kode (`src/core/block/genesis.ts`), deterministik, dan **tidak terhubung wallet mana pun** — coinbase 500 NXC dibayar ke **burned address** (tidak ada private key, dana terkunci selamanya seperti BTC genesis):

- Nama jaringan: devnet · Chain ID: 26 (`NEX_CHAIN_ID`)
- Genesis hash: `0000043b0bc286f26da2957e750d8a2303c492fac66ca56c6f9ba1a99a71be57` · Nonce: 48369
- Burned address: `NxC0000000000000000000000000000000000000000`
- Reward: 500 NXC · Timestamp: `2024-09-28T12:00:00Z` · Difficulty awal: 20 bits

Verifikasi konstanta: `bun run genesis:check`. Pada boot, node menulis genesis dari kode bila DB kosong, dan **menolak start** bila genesis di DB berbeda hash dari konstanta (anti-fork/tamper).

### Fork (jaringan benar-benar terpisah)

1. Ubah `NEX_CHAIN_ID` di `.env` (atau konstanta `GENESIS_TIMESTAMP`/`GENESIS_MESSAGE` di `src/core/block/genesis.ts`).
2. `bun run genesis:solve` → tempel `GENESIS_NONCE` & `GENESIS_HASH` ke `src/core/block/genesis.ts`.
3. `bun run genesis:check` → pastikan valid, lalu reset direktori data (`NEX_DATA_DIR`, default `./data`) dan mulai node.

Data devnet/test: dana uji dikirim lewat transaksi airdrop normal setelah genesis (bukan dari premine).

## Jaringan P2P (opsional, default MATI)

Node dapat menyinkronkan rantai dari peer lain lewat TCP — gaya awal Bitcoin: **tanpa identitas, tanpa tanda tangan blok** (keamanan dari PoW + hash chain). P2P hanya menyala bila `NEX_P2P_ENABLED` diset:

```bash
NEX_P2P_ENABLED=1
NEX_P2P_PEERS=127.0.0.1:30303
```

- Bind default `127.0.0.1` (`NEX_P2P_BIND_HOST`). **P2P tidak punya autentikasi** — perlakukan bind non-loopback seperti membuka method tulis RPC (batasi lewat firewall).
- Node yang baru menyambung otomatis mengejar rantai (`getblocks` → `inv` → `getdata` → `block`). **Reorg belum didukung**: blok hanya diterima bila tepat menempel ke tip lokal (`height === tip + 1` dan `previousBlockHash === tip.hash`).
- Pertahanan peer jahat: batas ukuran pesan, batas peer, timeout handshake/idle, dan ban untuk pelanggaran konsensus (PoW/hash/struktur/merkle/hadiah/timestamp).
- Variabel lengkap ada di `.env.example`; peta modul di `src/p2p/README.md`.
- Uji: `bun run check:p2p` (offline), `bun run p2p:smoke` (dua node lokal), `bun run p2p:evil -- <skenario> --host 127.0.0.1 --port 30303`.

## License

Nexchain Core is released under the MIT license. For more information, please see the [LICENSE](LICENSE) file or visit the [Open Source Initiative](https://opensource.org/licenses/MIT).

## Development Process

The development of Nexchain Core follows a collaborative process, where contributors can submit pull requests (PR) for review. We encourage developers to maintain clear commit messages and provide comprehensive documentation for new features or changes introduced.

### Key Steps in the Development Process:

1. **Feature Development:** Developers implement new features or fixes.
2. **Pull Request Submission:** Once development is complete, a pull request is created for review.
3. **Code Review:** Other contributors review the code for quality, security, and adherence to project standards.
4. **Testing:** The code must be thoroughly tested before merging.

## Testing

Testing and code review are crucial stages in our development cycle, as they help maintain the integrity and security of the Nexchain network. Given the high volume of pull requests, your patience and cooperation in testing others' submissions are greatly appreciated.

### Manual Quality Assurance (QA) Testing

It is important for changes to be tested by individuals other than the original developer. This practice minimizes bias and helps catch potential issues early. For major or high-risk changes, please consider the following:

- **Testing Plan:** Include a detailed testing plan in the pull request description, explaining how the changes should be tested.
- **Documentation:** Document testing procedures, expected results, and potential edge cases to consider.

By following these guidelines, we can ensure that Nexchain Core remains a secure and reliable platform for all users.
