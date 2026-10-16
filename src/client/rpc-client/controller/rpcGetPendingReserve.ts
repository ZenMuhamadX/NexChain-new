import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { client } from '../lib/rpcClient'
import { decodeHexJson } from '../lib/decodeHexJson'
import { pendingReserve } from 'src/core/transaction/getPendingReserve'

/**
 * Ambil saldo yang masih terkunci (pending) dari node.
 *
 * `nex_getPendingReserve` mengembalikan hex-JSON. Tanpa decode, field
 * `pendingAmount` menjadi undefined dan diam-diam dianggap 0, sehingga
 * pembatasan saldo terkunci tidak pernah berlaku di sisi client.
 */
export const rpcGetPendingReserve = async (
	address: string,
): Promise<pendingReserve | undefined> => {
	if (!isValidAddress(address)) return undefined
	return decodeHexJson<pendingReserve>(
		await client.request('nex_getPendingReserve', address),
	)
}
