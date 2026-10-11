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
turun dari ~1.228 karakter menjadi ~176 karakter.

## Isi modul

| File          | Tanggung jawab                                                        |
| ------------- | --------------------------------------------------------------------- |
| `rlpEncode.ts` | Encoder RLP murni. `RlpInput = Uint8Array \| RlpInput[]`.             |
| `rlpDecode.ts` | Decoder RLP. Semua akses diperiksa batas; payload rusak melempar.     |
| `txCodec.ts`   | **Skema transaksi** — pemetaan `TxInterface` ↔ list RLP.              |

Ketiganya murni: tanpa I/O, tanpa dependency, tanpa Node API. Dijaga oleh
`bun run check:browser`.

## Bentuk wire

```
bytes  = 0x01 ‖ rlp([ ...10 item... ])
string = base64(bytes)          ← yang lewat di params JSON-RPC
```

`0x01` adalah **tipe transaksi** dan letaknya di LUAR list, mengikuti pola
EIP-2718. Tipe menyiratkan skema, sehingga versi berikutnya (`0x02`) bisa
punya susunan berbeda tanpa merusak yang lama.

Susunan list (posisional — urutan adalah skema):

| # | Field | Bentuk |
|---|-------|--------|
| 0 | `sender` | 1 byte tag prefix + 20 byte |
| 1 | `receiver` | idem |
| 2 | `amount` | big-endian minimal |
| 3 | `fee` | big-endian minimal |
| 4 | `nonce` | big-endian minimal |
| 5 | `timestamp` | big-endian minimal |
| 6 | `extraMessage` | kosong = default, selain itu UTF-8 |
| 7 | `v` | big-endian minimal |
| 8 | `r` | 32 byte |
| 9 | `s` | 32 byte |

## Field yang sengaja TIDAK dikirim

| Field | Alasan |
| ----- | ------ |
| `txHash` | Dihitung ulang oleh node lewat `createTxnHash`. |
| `hexInput` | Dihitung ulang dari field lain dengan rumus yang sama. |
| `status` | Node menimpanya jadi `'pending'` (`txValidator.v.ts`). |
| `isValid` | Node menimpanya jadi `true`. |
| `isPending` | Node menimpanya jadi `true`. |

Ini bukan sekadar hemat byte. Node berhenti **mempercayai** nilai turunan
yang dikirim client: sebelumnya client bisa mengirim `txHash` atau `hexInput`
yang tidak cocok dengan isi transaksinya, dan node menyimpannya begitu saja.

**Konsekuensi yang perlu diketahui:** karena `status`/`isValid`/`isPending`
tidak dikirim, `decodeTxPayload` selalu menghasilkan transaksi berstatus
`'pending'`. Itu benar untuk jalur kirim (satu-satunya pemakai `encodeTx`),
tetapi codec ini **bukan** round-trip lossless untuk transaksi yang sudah
dikonfirmasi.

## Peran `encodeTx` dan `decodeTx`

Keduanya tinggal di `src/core/encoding/hex/tx/` dan berdampingan dengan
sengaja:

- `encodeTx` dipakai **hanya oleh client** (wallet-ui, CLI).
- `decodeTx` dipakai **hanya oleh node** (`src/rpc/method.ts`).

Keduanya tidak dipisah ke `client/` dan `rpc/` karena bersama-sama
mendefinisikan **satu kontrak**. Menaruhnya berjauhan mengundang keduanya
berkembang sendiri-sendiri — dan drift pada format wire adalah bug senyap
yang paling mahal di sini.

Folder `hex/` dipertahankan meski isinya kini RLP, supaya delapan titik impor
yang sudah ada tidak perlu diubah.

## Titik masuk

```ts
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'

const payload = encodeTx(signedTx) // string base64
const tx = decodeTx(payload) // TxInterface (txHash & hexInput dihitung ulang)
```

Primitif tingkat rendah bila perlu menyusun format lain:

```ts
import { rlpEncode, rlpDecode } from 'src/core/encoding/rlp/rlpEncode'
import { txToRlpList, rlpListToTx } from 'src/core/encoding/rlp/txCodec'
```
