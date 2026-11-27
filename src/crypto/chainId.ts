// Identitas jaringan NexChain (EIP-155 chain id).
//
// Nilai diambil dari env `NEX_CHAIN_ID`, fallback 2010 bila env tidak ada.
// Harus SAMA di semua komponen pada jaringan yang sama (node, RPC, wallet, explorer).
//
// Mengikuti standar PoW Bitcoin: identitas jaringan ditentukan oleh konstanta
// genesis + chain id. Fork yang mengubah `NEX_CHAIN_ID` (dan konstanta
// genesis — lihat `nexchain/block/genesis.ts`) menghasilkan rantai yang
// sepenuhnya terpisah; transaksi tidak bisa di-replay lintas jaringan karena
// chain id ikut di-hash ke payload transaksi (`nexchain/transaction/createTxHash`).
const FALLBACK_CHAIN_ID = 2010

/**
 * Baca `NEX_CHAIN_ID` dari env Node/Bun (node RPC, CLI). `process` dijaga
 * typeof supaya bundler browser (paket `wallet/`) tetap aman — pola sama dengan
 * `client/rpc-client/lib/rpcClient.ts`. Di browser `process` tidak ada, jadi
 * kita jatuh ke fallback 2010. Nilai ini harus sama di semua komponen satu
 * jaringan; env menang bila diset di node/gateway.
 */
const readEnvChainId = (): number | undefined => {
	if (typeof process === 'undefined') return undefined
	const raw = process.env?.NEX_CHAIN_ID
	if (raw === undefined) return undefined
	const parsed = Number(raw)
	if (!Number.isSafeInteger(parsed) || parsed <= 0)
		throw new Error(`NEX_CHAIN_ID tidak valid: ${raw}`)
	return parsed
}

export const CHAIN_ID = readEnvChainId() ?? FALLBACK_CHAIN_ID

/**
 * EIP-155: encode recovery param (0/1) ke value `v`.
 * v = recoveryParam + chainId * 2 + 35
 * Contoh (chainId 2010): recovery 0 -> v = 4055, recovery 1 -> v = 4056
 */
export const encodeV = (recoveryParam: number): number =>
	recoveryParam + CHAIN_ID * 2 + 35

/**
 * EIP-155: decode value `v` kembali ke recovery param (0/1) untuk elliptic.
 * Satu-satunya bentuk yang diterima: `recovery + CHAIN_ID * 2 + 35`.
 */
export const decodeV = (v: number): number => {
	const recovery = v - (CHAIN_ID * 2 + 35)
	if (recovery === 0 || recovery === 1) return recovery

	throw new Error(`Invalid signature v value: ${v}`)
}
