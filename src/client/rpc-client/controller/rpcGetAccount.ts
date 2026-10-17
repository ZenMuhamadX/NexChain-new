import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { client } from '../lib/rpcClient'
import { structBalance } from 'src/types/balance'

/**
 * Ambil data akun dari node.
 *
 * `nex_getAccount` mengembalikan JSON polos.
 */
export const rpcGetAccount = async (
	address: string,
): Promise<structBalance | undefined> => {
	if (!isValidAddress(address)) return undefined
	return (await client.request('nex_getAccount', address)) ?? undefined
}
