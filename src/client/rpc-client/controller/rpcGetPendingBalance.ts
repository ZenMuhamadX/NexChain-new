import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { client } from '../lib/rpcClient'
import { decodeHexJson } from '../lib/decodeHexJson'
import { pendingBalance } from 'src/core/transaction/getPendingBalance'

/**
 * Ambil saldo yang masih terkunci (pending) dari node.
 *
 * `nex_getPendingReserve` mengembalikan hex-JSON. Tanpa decode, field
 * `pendingAmount` menjadi undefined dan diam-diam dianggap 0, sehingga
 * pembatasan saldo terkunci tidak pernah berlaku di sisi client.
 */
export const rpcGetPendingBalance = async (
	address: string,
): Promise<pendingBalance | undefined> => {
	if (!isValidAddress(address)) return undefined
	return decodeHexJson<pendingBalance>(
		await client.request('nex_getPendingReserve', address),
	)
}
