# Kontrak Data Wallet NexChain — Konteks Rebuild

Dokumen ini adalah ringkasan kontrak data yang dipakai wallet: tipe, format wire,
alur tanda tangan, RPC, dan jebakan. Tujuannya supaya agen yang membangun ulang
wallet tidak perlu menebak dari implementasi. Sumber implementasi tetap menjadi
kebenaran; path sumber tercantum di tiap bagian.

> `docs/WALLET.md` adalah draf diskusi lama (repo terpisah, ekstensi MV3, node
> punya wallet, RPC tanpa auth). Statusnya sudah usang — jangan dipakai sebagai
> acuan. Lihat `AGENTS.md` untuk arsitektur saat ini.

## 0. Prinsip

1. **Node = ledger, bukan wallet.** Node tidak punya mnemonic, kunci, atau saldo
   sendiri; `nex_createWallet` tidak ada. Kunci hanya hidup di klien.
   `src/core/state/account/` adalah ledger semua alamat, bukan dompet node.
2. **Hasil RPC = JSON polos**, bukan envelope hex. Pengecualian: `params` tx
   berupa `base64` dan `nex_getBalance` mengembalikan string bersatuan.
3. **Tiga sumber kebenaran, jangan diduplikasi:** tipe domain `src/types/`,
   wire tx `src/core/encoding/rlp/txCodec.ts`, vault `src/client/wallet/walletVault.ts`.
4. **Field turunan tidak dikirim:** `from` (ecrecover), `txHash` (sha256 payload),
   `timestamp` (blok), `status` (keanggotaan blok).

## 1. Identitas & satuan

| Hal | Format | Sumber |
| --- | --- | --- |
| Alamat | `NxC` + 40 hex lowercase = 43 char → 20 byte | `src/core/encoding/rlp/codecScalars.ts` |
| txHash | `TxC` + 64 hex lowercase = 67 char | `src/core/encoding/rlp/txHash.ts` |
| Hash blok | 64 hex tanpa prefix | `src/types/block.ts` |
| Chain ID | default `26` (`NEX_CHAIN_ID`) | `src/crypto/chainId.ts` |
| Satuan | `1 NXC = 100_000_000 nexu` (8 desimal) | `src/core/token/constants.ts` |
| Plafon suplai | `50_000_000 NXC = 5×10^15 nexu` | `src/core/token/constants.ts` |

Jangan cek `txHash.length === 64` — selalu salah dan mematikan relay; pakai
`isTxHash()`. Format lama `NxS` + 1-byte tag sudah dihapus.

Konversi uang **wajib aritmetika string**: `toNexu('0.00025') → 25000`,
`formatNxc(25000) → '0.00025'`. Jangan `Number()`, `toFixed()`, atau pembagian
float (riwayat bug: `100.00049999999901 NXC`). Lihat `src/core/token/`.

## 2. Vault (data lokal sensitif)

Sumber: `src/client/wallet/{walletVault,vaultCrypto,kv,idbKv,jsCrypto}.ts`.

```ts
// Publik, boleh dibaca tanpa unlock
interface WalletInfo { address: string; publicKey: string; createdAt: number }

// Yang tersimpan di KV
interface VaultRecord {
  id: string; address: string; publicKey: string; createdAt: number
  blob: EncryptedBlob
}

// Hanya di memori setelah unlock — TIDAK pernah dipersist
interface UnlockedWallet {
  address: string; publicKey: string; privateKey: string; mnemonic: string
}

interface EncryptedBlob {
  version: number          // 1
  kdf: 'PBKDF2-SHA256'
  iterations: number       // 310k desktop / 100k mobile, maks 10 juta
  salt: string             // 16 byte hex
  iv: string               // 12 byte hex
  ciphertext: string       // hex, termasuk tag GCM 16 byte
}
```

- Yang dienkripsi **hanya mnemonic**. Private key diturunkan ulang saat
  `unlock` (BIP39 → BIP32 `m/44'/60'/0'/0/0` → secp256k1).
- API: `create()`, `importMnemonic()`, `unlock()`, `lock()`, `wipe()`,
  `getUnlocked()`. `unlock` memverifikasi alamat hasil turunan sama dengan
  `record.address` — record korup ditolak.
- PBKDF2-HMAC-SHA256 → AES-256-GCM. Web Crypto di secure context; fallback
  `@noble` JS di `http://<IP>` dengan **format blob identik**.
- `WalletKV { get, set, delete }`: IndexedDB (`nex-wallet`) untuk web/dev,
  memory untuk tes, file untuk desktop.
- **4 titik suntik shell** (`dev/`, `web/` PWA, `desktop/`): `vaultStore.ts`
  (KV), `deviceCrypto.ts` (iterasi), `rpcUrl.ts` (URL + kredensial),
  `platform.ts` (presentasi install/update). Injeksi wajib sebelum render
  pertama — `getVault()` menyimpan promise singleton.

## 3. Transaksi

### 3a. Dua bentuk

```ts
// Niat pengguna (form), belum on-chain
interface comTxInterface {
  receiver: string
  format: 'NXC' | 'nexu'  // HANYA konversi, tidak ikut ke rantai
  sender: string          // untuk ambil nonce
  amount: number
  fee: number
  data?: `0x${string}`
}

// On-chain, immutable
interface TxInterface {
  nonce: number
  fee: number             // nexu
  receiver: string
  amount: number          // nexu
  data?: `0x${string}`
  sign: { v: number; r: string; s: string }
  from?: string           // turunan, bukan field wire
  txHash?: string         // turunan, bukan field wire
}
```

### 3b. Wire format

```
unsigned = [ chainId, nonce, fee, receiver, amount, data ]       // 6 item
sighash  = sha256(rlp(unsigned))                  ← yang ditandatangani
signed   = [ nonce, fee, receiver, amount, data, v, r, s ]       // 8 item
payload  = 0x02 ‖ rlp(signed)
txHash   = 'TxC' + sha256(payload)
RPC param = base64(payload)
```

- `encodeTx()` → base64 payload; `decodeTx()` menghitung ulang `from` dan
  `txHash`, tidak mempercayai nilai dari luar.
- `v = recoveryParam + chainId*2 + 35` (EIP-155; chainId 2010 → 4055/4056).
  `decodeV` juga menerima legacy `v = recovery + 26`.
- ECDSA secp256k1 dengan `canonical: true` (low-s) → anti-malleability.
  `r`/`s` di-pad 64 hex lowercase.
- Integer RLP = big-endian minimal kanonik (nol depan ditolak); `0 → empty`.
  Jangan pakai `| 0` (int32, merusak nonce ≥ 2³¹).

### 3c. Alur kirim

1. `nex_getNextNonce(address)`.
2. `createUnsignedTransaction(comTx, nonce)`.
3. `signTransaction(tx, privateKey)` dengan sighash (bukan hash ganda).
4. `buildSignedTransaction` — fee otomatis: seed 100, cari fixed point
   `fee === encodeTxPayload(tx).length`, maks 4 iterasi. Lantai laju-fee node
   = 1 nexu/byte; tx paling ramping 96 byte. Tampilkan tx final di review,
   **jangan bangun ulang** saat klik kirim (nonce bisa berubah).
5. `clientSideTxValidate(tx)` → `nex_sendRawTransaction(encodeTx(tx))`
   (Basic Auth) → `{ status, txHash, error? }`.
6. RBF/percepat: nonce sama, fee 2× (node mensyaratkan laju-fee lebih tinggi).

Sumber: `wallet/src/lib/sendFlow.ts`, `wallet/src/lib/rpc.ts`,
`src/client/lib/*`, `src/core/encoding/hex/tx/*`.

## 4. Akun / saldo

```ts
interface structBalance {
  address: string
  balance: number                   // nexu
  transactionCount: number          // naik saat KIRIM dan TERIMA (self +2)
  lastTransactionDate: number | null // timestamp BLOK (epoch ms)
  nonce: number                     // hanya naik untuk tx KELUAR
}
```

- Alamat valid belum ada → akun-nol, bukan error.
- State LevelDB: leaf RLP v1 `RLP([1, nonce, balance, txCount, lastTxTime])`.
- `nex_getNonceAccount` = nonce terkonfirmasi; **`nex_getNextNonce`** = nonce
  + jumlah tx pending pengirim. Pakai yang terakhir untuk kirim.

## 5. Riwayat

```ts
interface HistoryEntry extends TxInterface {
  metadata?: {
    blockHeight: number
    blockHash: string
    blockTimestamp: number  // source of truth waktu tx
    merkleRoot: string
  }
}
```

Keberadaan `metadata.blockHeight` = fakta "sudah dieksekusi" (pengganti
`status`). Dua kunci store `history`:

- `txnHash:<txHash>` → JSON `HistoryEntry`.
- `addr:<address>:<height 8-digit>:<txHash>` → `'in' | 'out' | 'self'`.
  Reverse range scan → terbaru dulu; zero-pad menjaga urutan leksikografis.

`nex_getTransactionsByAddress` menerima dua bentuk:

- string alamat → `{ count, history }` (explorer)
- `{ address, page?, pageSize? }` → `{ count, history, page, pageSize, totalPages }`
  (wallet). Default 25, maks 100. `count` = total, bukan panjang halaman.

Penggabungan pending ada di klien (`wallet/src/lib/rpc.ts` →
`fetchActivityPage`): halaman terkonfirmasi + `nex_getPendingByAddress`,
dedup by `txHash`, pending di atas. Jangan sortir ulang.

Coinbase bukan transaksi: `from: 'COINBASE'`,
`txHash = 'TxC' + sha256('coinbase:<height>')`, `data = Block reward` (hex).
Muncul di riwayat penambang sebagai `in`, tidak pernah di `block.transactions`.

Sumber: `src/core/transaction/saveTxHistory.ts`,
`saveTransactionByAddress.ts`, `processTransaction.ts`,
`src/core/block/query/onChain/Transaction/getHistoryByAddress.ts`.

## 6. Mempool (node-local, bukan konsensus)

| Kunci | Fungsi |
| --- | --- |
| `<txHash>` | entri `TxInterface` penuh |
| `mpf:<from>:<txHash>` | indeks per-pengirim, nilai `{ cost: amount + fee }` |

- `pendingReserve = Σ cost` indeks `mpf:` — **turunan, bukan counter**, jadi
  tidak bisa drift. `nex_getPendingReserve` dipakai wallet untuk saldo
  tersedia = `balance - pendingAmount`.
- Maks **16 tx pending per pengirim** (`MAX_PENDING_PER_SENDER`); ada juga
  cap byte global.
- `nex_getMempool` dibatasi 100 entri global (explorer). **Jangan** dipakai
  wallet untuk cek tx sendiri — pakai `nex_getPendingByAddress`.
- Tx **masuk** yang masih pending belum tampil di riwayat (indeks hanya
  per-pengirim); muncul setelah masuk blok.

Sumber: `src/core/transaction/memPool.ts`,
`src/core/state/storage/mempool/*`.

## 7. RPC (`POST /rpc`)

| Method | Params → hasil |
| --- | --- |
| `nex_getAccount` | address → `structBalance` |
| `nex_getBalance` | address → `"… NXC"` (string) |
| `nex_getNonceAccount` / `nex_getNextNonce` | address → number |
| `nex_getTransactionCount` | address → number |
| `nex_getPendingReserve` | address → `{address, pendingAmount}` |
| `nex_getTransactionsByAddress` | string \| objek → `{count, history, …}` |
| `nex_getTransactionByTxHash` | txHash → `HistoryEntry` |
| `nex_getPendingByAddress` | address → `TxInterface[]` |
| `nex_getMempool` | – → `TxInterface[]` (≤100) |
| `nex_sendRawTransaction` | base64 tx → `{status, txHash, error?}` **(WRITE)** |
| `nex_authCheck` | – → `{status:true}` **(WRITE, uji kredensial)** |
| `nex_getChainId` | – → number |
| `nex_getSyncStatus` | – → `{phase, syncing, localHeight, targetHeight, updatedAt}` |
| `nex_getBlockByHeight` / `ByHash` | → `{ block }` |
| `nex_getRecentBlocks` / `nex_getBlocksRange` | → `blockSummary[]` |

Auth: method tulis butuh `Authorization: Basic …` bila node menyetel
`RPC_USER`/`RPC_PASSWORD`; tanpa kredensial hanya loopback yang boleh (node
non-loopback tanpa kredensial menolak boot). Probe: 401 = kredensial ditolak,
403 = auth tidak dipakai. Lihat `src/rpc/authLogic.ts`.

URL runtime: `localStorage 'nex_rpc_url'` → `VITE_RPC_URL` → default
`https://node1.zuns.my.id/rpc`. Guard `localStorage 'nex_chain_id'` — alamat
yang sama di chain lain = akun berbeda.

## 8. Blok (detail tx)

`blockStruct { header, height, size, totalTransactionFees, merkleRoot,
minerId, chainId?, status, blockReward, totalReward, coinbaseTransaction,
metadata?, transactions }`. `header.difficulty` **float** (kuantisasi 0,25
bit), `timestamp` epoch ms, ada `stateRoot` (ikut preimage PoW). `size` = Σ
byte wire tx pengguna; `transactions` tidak memuat coinbase.

## 9. Jebakan yang harus disampaikan ke agen

1. `src/core/encoding/rlp/README.md` masih menulis alamat = 1-byte tag + 20
   byte. **Usang.** Implementasinya 20 byte telanjang tanpa tag.
2. `src/types/walletToSave.ts`, `walletConfig.ts`, `defaultConfig.ts`,
   `privateData.ts` adalah tipe warisan Node/CLI, bukan vault browser.
3. Tiga panjang berbeda: txHash 67, alamat 43, hash blok 64.
4. `nex_getBalance` mengembalikan string, bukan number.
5. Semua `amount`/`balance`/`fee` di wire dan RPC = nexu; UI yang ke NXC.
6. Fee bukan input user — dihitung otomatis = ukuran wire. Jangan buat fee
   market.
7. Jangan pernah persist private key/mnemonic plaintext.
8. Node replay state saat boot dan exit bila mismatch; jalur tulis state hanya
   lewat `putAccount`/`saveTxHistory`/write-buffer.

## 10. Bentuk UI (jika UI ikut dibangun ulang)

8 layar: `Welcome, SetupWallet, Unlock, Home, History, Send, Receive,
Settings`. Kirim/Terima adalah sheet, bukan navigasi. Method `wallet/src/lib/rpc.ts`:
`fetchAccount`, `fetchPending`, `fetchNextNonce`, `fetchActivityPage`,
`sendRawTransaction`, `testRpcUrl`. Tampilkan `formatNxcCompact()/
AmountDisplay` untuk saldo utama; nexu exact hanya di detail disclosure.
