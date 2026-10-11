# src/core/encoding/rlp — codec wire transaksi

Modul serialisasi **RLP** (Recursive Length Prefix) — format biner milik
Ethereum — yang dipakai sebagai kontrak wire antara wallet dan node.

## Kenapa RLP

RLP hanya mengenal dua jenis nilai: **byte string** dan **list**. Tidak ada
nama field, tidak ada tanda kutip, tidak ada pemisah. Urutan field ditentukan
oleh **posisi** di dalam list.

Konsekuensinya RLP bersifat **kanonik**: satu nilai selalu menghasilkan satu
representasi byte yang persis sama. Itu sebabnya ia aman dipakai sebagai
preimage hash dan sebagai format wire — tidak ada ruang untuk dua pihak
"berbeda pendapat" soal cara menuliskan nilai yang sama.

Dibanding format sebelumnya (`base64(msgpack(JSON.stringify(tx)))`), payload
turun dari ~1.228 karakter menjadi ~154 karakter.

## Isi modul

| File           | Tanggung jawab                                                       |
| -------------- | -------------------------------------------------------------------- |
| `rlpEncode.ts` | Encoder RLP murni. `RlpInput = Uint8Array \| RlpInput[]`.            |
| `rlpDecode.ts` | Decoder RLP. Semua akses diperiksa batas; payload rusak melempar.    |
| `txCodec.ts`   | **Skema transaksi** — pemetaan `TxInterface` ↔ list RLP + turunannya. |

Ketiganya murni: tanpa I/O, tanpa Node API. Dijaga oleh
`bun run check:browser`.

## Bentuk wire

```
unsigned = [ chainId, nonce, fee, receiver, amount, data ]      (6 item)
sighash  = sha256(rlp(unsigned))                     ← yang di-sign
signed   = [ nonce, fee, receiver, amount, data, v, r, s ]      (8 item)
payload  = 0x02 ‖ rlp(signed)
string   = base64(payload)                           ← params JSON-RPC
txHash   = sha256(payload)                           ← identitas
```

`0x02` adalah **tipe transaksi** dan letaknya di LUAR list, mengikuti pola
EIP-2718. Tipe menyiratkan skema, sehingga versi berikutnya (`0x03`) bisa
punya susunan berbeda tanpa merusak yang lama.

### List yang ditandatangani (6 item)

| # | Field      | Bentuk                |
|---|------------|-----------------------|
| 0 | `chainId`  | big-endian minimal    |
| 1 | `nonce`    | big-endian minimal    |
| 2 | `fee`      | big-endian minimal    |
| 3 | `receiver` | 1 byte tag prefix + 20 byte |
| 4 | `amount`   | big-endian minimal    |
| 5 | `data`     | byte mentah; kosong = `0x80` |

### List yang dikirim (8 item)

Sama seperti di atas **tanpa `chainId`**, ditambah `v`, `r`, `s` di akhir.
`chainId` tidak perlu dikirim ulang karena sudah dibawa `v` (EIP-155) dan ikut
di preimage tanda tangan.

## Dua hash, bukan satu

| Hash      | Dihitung dari                    | Peran               |
| --------- | -------------------------------- | ------------------- |
| `sighash` | `sha256(rlp(list unsigned))`     | yang ditandatangani |
| `txHash`  | `sha256(payload bertipe lengkap)`| identitas transaksi |

Sebelumnya satu nilai merangkap dua peran sekaligus — yang ditandatangani DAN
identitasnya — sehingga `txHash` tidak pernah mengikat byte yang dikirim.
Dengan pemisahan ini, `txHash` berubah bila satu bit pun berubah di wire, dan
`validateTransactionSignature` benar-benar menegakkan komitmen itu.

## Pengirim TIDAK dikirim

`from` (pengirim) **tidak ada di wire**. Ia dipulihkan dari tanda tangan:

```
from = ecrecover(sighash, v, r, s)
```

Ini model Ethereum: tanda tangan **adalah** definisi pengirim, bukan klaim
tentang pengirim. Konsekuensinya lebih dari sekadar hemat 22 byte:

- Tidak ada lagi klaim yang harus dicocokkan dengan kenyataan. Sebelumnya node
  memverifikasi `signer === sender`; sekarang nilai hasil pemulihan **langsung
  menjadi** `from`, sehingga ketidakcocokan tidak mungkin terjadi.
- `from` tidak bisa dipalsukan tanpa memalsukan tanda tangan, karena ia
  dihitung DARI tanda tangan itu.
- Explorer tidak perlu kripto sama sekali: node menyimpan `from` hasil
  pemulihan di record riwayat, dan UI tinggal membacanya.

`createCoinbaseRecord` adalah satu-satunya tempat `from` diisi nilai bukan
alamat (`'COINBASE'`) — dan itu **record riwayat**, bukan transaksi: ia tidak
pernah lewat kodek maupun validasi.

## Field yang sengaja TIDAK dikirim

| Field                             | Alasan                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| `from`                            | Turunan — `ecrecover` atas tanda tangan.                       |
| `txHash`                          | Turunan — `sha256(payload bertipe)`.                           |
| `chainId` (di list signed)        | Dibawa `v` (EIP-155) dan sudah ada di list unsigned.           |
| `timestamp`                       | Milik BLOK; dibaca dari `metadata.blockTimestamp` di riwayat.  |
| `format`                          | Digantikan byte tipe transaksi di wire.                        |
| `hexInput`                        | Dihapus — turunan yang tidak pernah diverifikasi siapa pun.    |
| `status`/`isValid`/`isPending`    | State siklus hidup; diturunkan dari keanggotaan blok.          |

Ini bukan sekadar hemat byte. Node berhenti **mempercayai** nilai turunan yang
dikirim client: sebelumnya client bisa mengirim `txHash` atau `hexInput` yang
tidak cocok dengan isi transaksinya, dan node menyimpannya begitu saja.

`encodeTx` juga **membuang setiap field di luar skema**, sehingga field warisan
(mis. `isSenderContract`) tidak pernah sampai ke node.

**Konsekuensi yang perlu diketahui:** `decodeTxPayload` menghasilkan transaksi
tanpa `timestamp` dan tanpa state siklus hidup. Waktu transaksi dibaca dari
blok yang memuatnya, dan "sudah dikonfirmasi?" diturunkan dari keanggotaan
blok (`metadata.blockHeight`).

## Peran `encodeTx` dan `decodeTx`

Keduanya tinggal di `src/core/encoding/hex/tx/` dan berdampingan dengan
sengaja:

- `encodeTx` dipakai **hanya oleh client** (wallet-ui, CLI).
- `decodeTx` dipakai **hanya oleh node** (`src/rpc/method.ts`).

Keduanya tidak dipisah ke `client/` dan `rpc/` karena bersama-sama
mendefinisikan **satu kontrak**. Menaruhnya berjauhan mengundang keduanya
berkembang sendiri-sendiri — dan drift pada format wire adalah bug senyap
yang paling mahal di sini.

Folder `hex/` dipertahankan meski isinya kini RLP, supaya titik impor yang
sudah ada tidak perlu diubah.

## Titik masuk

```ts
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'

const payload = encodeTx(signedTx) // string base64
const tx = decodeTx(payload) // TxInterface — `from` & `txHash` terisi
```

Primitif tingkat rendah:

```ts
import {
  txSighash,   // Uint8Array 32 byte — yang ditandatangani
  txHashOf,    // 'TxC…' — identitas
  txFrom,      // alamat penanda tangan hasil ecrecover
  txToRlpList, // list RLP yang dikirim
  rlpListToTx, // list RLP → TxInterface (tanpa field turunan)
  decodeTxPayload,
  encodeTxPayload,
} from 'src/core/encoding/rlp/txCodec'
```
