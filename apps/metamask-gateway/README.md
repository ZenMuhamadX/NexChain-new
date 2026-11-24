# Gateway MetaMask (Stage 1 — baca + registrasi)

Proses terpisah dari node. Node tetap di loopback dengan Basic Auth dan CORS
ketat; gateway yang bicara `eth_*` ke MetaMask dan meneruskan **hanya method
baca** ke node lewat `nex_*`.

```
MetaMask iOS ──HTTPS──> gateway (:8545) ──loopback + Basic Auth──> node (:8000)
```

## Jalankan

```sh
bun run metamask:start
```

Env (semua opsional):

- `METAMASK_GATEWAY_PORT` — default `8545`
- `NEX_RPC_URL` — default `http://127.0.0.1:8000/rpc`
- `RPC_USER` / `RPC_PASSWORD` — kredensial node, dipakai server-side
- `METAMASK_BRIDGE_MAPPING` — default `<NEX_DATA_DIR>/bridge/mappings.json`

iOS mewajibkan HTTPS: pasang reverse proxy dengan sertifikat valid di depan
gateway, lalu pakai URL itu sebagai RPC URL di MetaMask. Buka halaman `/`
dari **tab Browser di dalam aplikasi MetaMask** supaya `window.ethereum` ada.

## Alur registrasi

Impor seed ke MetaMask tidak memindahkan saldo — private key sama (path
`m/44'/60'/0'/0/0`), tapi alamatnya beda:

- MetaMask: `0x…` = `keccak(pubkey)[-20:]`
- NexChain: `NxC…` = `keccak(0x00 ‖ sha256(pubkey))[-20:]`

Halaman onboarding meminta `personal_sign` atas pesan yang memuat chainId dan
nonce sekali pakai. Gateway memulihkan pubkey (EIP-191), memastikan alamat
Ethereum-nya cocok dengan akun MetaMask, lalu menyimpan pasangan
`0x… ↔ NxC…` ke disk. Tanpa registrasi, `eth_getBalance` mengembalikan `0x0`.

Gasprice iklan 10 gwei = 1 nexu/gas (8 desimal NXC); saldo dikonversi ke wei
dengan BigInt faktor `10^10`, tanpa pembulatan.

## Batas Stage 1

`eth_sendRawTransaction` **tidak tersedia**. MetaMask bisa melihat saldo,
nonce, blok, dan receipt, belum bisa kirim. Itu menyusul setelah format
tanda tangan Ethereum masuk konsensus lewat hard-fork by height.

Gate: `bun run check:metamask` (masuk `check:all` fase offline).
