import { isContract } from 'nexchain/lib/isContract'
import { client } from '../lib/rpcClient'
import { decodeHexJson } from '../lib/decodeHexJson'

/**
 * Ambil saldo kontrak dari node.
 *
 * `nex_getContractBalance` mengembalikan hex-JSON (angka). Tanpa decode,
 * hasilnya berupa string sehingga `balance >= amount + fee` selalu false
 * dan setiap transfer ke kontrak ditolak oleh validasi client.
 */
export const rpcGetContractBalance = async (
	address: string,
): Promise<number | undefined> => {
	if (!isContract(address)) return undefined
	return decodeHexJson<number>(
		await client.request('nex_getContractBalance', address),
	)
}
