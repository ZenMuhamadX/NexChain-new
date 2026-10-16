import type { blockStruct } from 'src/types/block'
import { rlpDecode } from 'src/core/encoding/rlp/rlpDecode'
import { rlpListToBlock } from 'src/core/encoding/rlp/blockCodec'
import { base64ToUint8 } from '../base64/base64ToUint8'

/**
 * Decode badan blok dari pesan P2P `block` (base64 RLP).
 *
 * Payload rusak DITOLAK KERAS — base64 tidak valid, RLP terpotong, list
 * dengan jumlah item salah, atau tipe item yang keliru semuanya melempar.
 * Pemanggil (`syncManager.handleBlock`) memperlakukannya sebagai pelanggaran
 * wire, bukan sekadar balapan.
 *
 * Catatan: ini hanya decode bentuk. Validasi konsensus (Joi, PoW, hash,
 * merkle, hadiah, timestamp, difficulty) tetap milik `connectBlock`.
 */
export const decodeBlock = (payload: string): blockStruct => {
	if (typeof payload !== 'string' || payload.length === 0) {
		throw new Error(
			'decodeBlock: payload harus string base64 yang tidak kosong',
		)
	}
	return rlpListToBlock(rlpDecode(base64ToUint8(payload)))
}
