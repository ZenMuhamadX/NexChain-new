// Identitas jaringan NexChain (EIP-155 chain id).
//
// Nilai diambil dari env `NEX_CHAIN_ID` (default 26) dan harus SAMA di semua
// komponen pada jaringan yang sama (node, RPC, wallet, explorer).
//
// Mengikuti standar PoW Bitcoin: identitas jaringan ditentukan oleh konstanta
// genesis + chain id. Fork yang mengubah `NEX_CHAIN_ID` (dan konstanta
// genesis — lihat `nexchain/block/genesis.ts`) menghasilkan rantai yang
// sepenuhnya terpisah; transaksi tidak bisa di-replay lintas jaringan karena
// chain id ikut di-hash ke payload transaksi (`nexchain/transaction/createTxHash`).
const DEFAULT_CHAIN_ID = 26

/**
 * Baca `NEX_CHAIN_ID` dari env Node/Bun (node RPC, CLI). `process` dijaga
 * typeof supaya bundler browser (paket `wallet/`) tetap aman — pola sama dengan
 * `client/rpc-client/lib/rpcClient.ts`. Di browser `process` tidak ada, jadi
 * kita jatuh ke default 26 (chain id devnet). Nilai ini harus sama di semua
 * komponen satu jaringan; untuk jaringan non-default, `NEX_CHAIN_ID` diset
 * di `.env` node dan wallet mengikuti default-nya lewat konfigurasi build.
 */
const readEnvChainId = (): number | undefined => {
	if (typeof process === 'undefined') return undefined
	const raw = process.env?.NEX_CHAIN_ID
	if (raw === undefined) return undefined
	const parsed = Number(raw)
	if (Number.isInteger(parsed) && parsed > 0) return parsed
	return undefined
}

export const CHAIN_ID = readEnvChainId() ?? DEFAULT_CHAIN_ID

/**
 * EIP-155: encode recovery param (0/1) ke value `v`.
 * v = recoveryParam + chainId * 2 + 35
 * Contoh (chainId 26): recovery 0 -> v = 87, recovery 1 -> v = 88
 */
export const encodeV = (recoveryParam: number): number =>
	recoveryParam + CHAIN_ID * 2 + 35

/**
 * EIP-155: decode value `v` kembali ke recovery param (0/1) untuk elliptic.
 * Mendukung juga legacy format (v = recovery + 26) untuk transaksi lama.
 */
export const decodeV = (v: number): number => {
	const eip155 = v - (CHAIN_ID * 2 + 35)
	if (eip155 === 0 || eip155 === 1) return eip155

	// Fallback legacy: v = recovery + 26
	const legacy = v - 26
	if (legacy === 0 || legacy === 1) return legacy

	throw new Error(`Invalid signature v value: ${v}`)
}