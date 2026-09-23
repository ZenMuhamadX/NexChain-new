import { rpcRequest } from '../lib/rpcRequest'
import { hexToString } from 'nexchain/hex/hexToString'
import { HexString } from 'interface/structBlock'

/**
 * Query nonce akun dari node via RPC.
 * Return angka number (default 0 jika akun belum ada / belum pernah transaksi).
 */
export const getNonce = async (address: string): Promise<number> => {
	try {
		const raw = await rpcRequest('nex_getNonceAccount', address)
		if (raw === undefined || raw === null) return 0
		const parsed = JSON.parse(hexToString(raw as HexString))
		return typeof parsed === 'number' ? parsed : 0
	} catch {
		return 0
	}
}
