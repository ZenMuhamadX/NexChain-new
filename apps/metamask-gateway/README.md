# Gateway MetaMask (baca + registrasi + kirim)

Proses terpisah dari node. Node tetap di loopback dengan Basic Auth dan CORS
ketat; gateway yang bicara `eth_*` ke MetaMask. Method baca diteruskan ke node
lewat `nex_*`; satu-satunya method tulis yang diteruskan adalah
`eth_sendRawTransaction`. `nex_getWork`, `nex_submitWork`, `eth_sign`, dan
`personal_sign` tidak pernah diteruskan.

```
MetaMask iOS ──HTTPS──> gateway (:8545) ──loopback + Basic Auth──> node (:2008)
```

## Jalankan

```sh
bun run metamask:start
```

Env (semua opsional):

- `METAMASK_GATEWAY_PORT` — default `8545`
- `NEX_RPC_URL` — default `http://127.0.0.1:8000/rpc`. Set ke endpoint node yang
  dipakai lewat `.env` folder ini; arahkan langsung ke node, bukan ke proxy yang
  meminta autentikasi terpisah
- `RPC_USER` / `RPC_PASSWORD` — kredensial node, dipakai server-side
- `METAMASK_BRIDGE_MAPPING` — default `<NEX_DATA_DIR>/bridge/mappings.json`

Gateway memuat `.env` folder ini lebih dulu, lalu root `.env`; jadi nilai di
`.env` gateway menang. Salin `.env.example` ke `.env` di folder ini (file `.env`
diabaikan git).

iOS mewajibkan HTTPS: pasang reverse proxy dengan sertifikat valid di depan
gateway, lalu pakai URL itu sebagai RPC URL di MetaMask. Buka halaman `/`
dari **tab Browser di dalam aplikasi MetaMask** supaya `window.ethereum` ada.
Di Windows/Chrome pakai `http://127.0.0.1:8545` (bukan `localhost`, yang bisa
resolve ke `::1` lebih dulu). Cloudflare Tunnel menyisipkan `X-Forwarded-For`;
gateway memakai `trust proxy = loopback` supaya rate-limit memakai IP asli dan
tidak mencetak `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.

## Identitas akun

20 byte alamat adalah identitas ledger. `0x…` (MetaMask) dan `NxC…` (NexChain)
adalah byte yang **sama persis**, hanya prefix yang beda:

- MetaMask: `0x…` = `keccak(pubkey)[-20:]`
- NexChain: `NxC…` = 20 byte yang sama

Ini wajib karena `to` di raw Ethereum terikat tanda tangan — gateway tidak
boleh menimpanya dengan alamat hasil turunan lain. Akun lama yang memakai
`keccak(0x00 ‖ sha256(pubkey))` tidak dipakai lagi; mapping lamanya sudah
dihapus dan harus registrasi ulang. Kirim dana ke alamat `NxC…` yang ditampilkan
halaman onboarding, bukan ke string `0x…`.

## Registrasi

Halaman onboarding meminta `personal_sign` atas pesan yang memuat chainId dan
nonce sekali pakai. Gateway memulihkan pubkey (EIP-191), memastikan alamat
Ethereum-nya cocok dengan akun MetaMask, lalu menyimpan pasangan `0x… ↔ NxC…`
ke disk. Tanpa registrasi, `eth_getBalance` mengembalikan `0x0`. Tanda tangan
ini gratis: tanpa gas, tanpa transaksi, tanpa dana pindah.

Gasprice iklan 10 gwei = 1 nexu/gas (8 desimal NXC); konversi wei ↔ nexu pakai
BigInt faktor `10^10`, tanpa pembulatan. Form _Add a network_ MetaMask tidak
punya kolom decimals — EVM memakai 18 secara default (juga diset eksplisit
lewat `wallet_addEthereumChain`). Saldo `latest` bisa tertahan cache MetaMask
setelah registrasi; pindah network bolak-balik atau lock/unlock ekstensi.

## Kirim

`eth_sendRawTransaction` menerima legacy EIP-155 (chainId 26, `v` 87/88) dan
membungkusnya sebagai payload tipe `0x03` sebelum masuk node. Node memulihkan
`from` dari `ecrecover`, memakai 20 byte `to` apa adanya sebagai `NxC…`, dan
mengubah `value` serta `gasPrice × gasLimit` dari wei ke nexu eksak — wei yang
tidak habis dibagi `10^10` ditolak.

Dua hash berbeda dan diterjemahkan gateway:

- MetaMask: `0x…` = `keccak(raw)`
- Node: `TxC…` = `sha256(0x03 ‖ raw)`

`eth_getTransactionByHash` dan `eth_getTransactionReceipt` menerima dua-duanya.

Gate: `bun run check:metamask` dan `bun run check:ethTx` (keduanya masuk
`check:all` fase offline).

## Batas

Tidak ada EVM, kontrak, atau ERC-20: `to` wajib 20 byte, `data` diteruskan apa
adanya dan receipt selalu `status: 0x1`. MetaMask tidak punya RPC standar untuk
riwayat, jadi transaksi masuk tidak muncul di Activity — pakai Explorer.
