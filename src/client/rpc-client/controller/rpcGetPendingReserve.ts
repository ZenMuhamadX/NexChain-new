import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { client } from '../lib/rpcClient'
import { pendingReserve } from 'src/core/transaction/getPendingReserve'

/**
 * Ambil saldo yang masih terkunci (pending) dari node.
 *
 * `nex_getPendingReserve` mengembalikan JSON polos.
 */
export const rpcGetPendingReserve = async (
	address: string,
): Promise<pendingReserve | undefined> => {
	if (!isValidAddress(address)) return undefined
	return (await client.request('nex_getPendingReserve', address)) ?? undefined
}
