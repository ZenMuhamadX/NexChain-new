import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { client } from '../lib/rpcClient'
import { decodeHexJson } from '../lib/decodeHexJson'
import { structBalance } from 'src/types/balance'

/**
 * Ambil data akun dari node.
 *
 * `nex_getAccount` mengembalikan hex-JSON, jadi WAJIB di-decode — tanpa itu
 * `balance` menjadi string dan `balance.balance` = undefined, yang membuat
 * validasi saldo client selalu gagal (lihat `decodeHexJson`).
 */
export const rpcGetAccount = async (
	address: string,
): Promise<structBalance | undefined> => {
	if (!isValidAddress(address)) return undefined
	return decodeHexJson<structBalance>(
		await client.request('nex_getAccount', address),
	)
}
