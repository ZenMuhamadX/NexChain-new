// Konstanta chain jaringan NexChain.
// Nilai ini HARUS sama di semua komponen (node, RPC, wallet, explorer).
export const CHAIN_ID = 26

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
