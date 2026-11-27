import { buildMiningPayload } from 'src/core/block/miningPayload'
import { hashWithNonce } from 'src/core/consensus/Pow'
import { Block } from 'src/core/block/blockModel'

/**
 * Verifikasi identitas blok: `header.hash` harus sama dengan
 * `SHA256d(buildMiningPayload(block) dengan slot nonce = header.nonce)`.
 *
 * Tidak ada `node:crypto` di sini — primitifnya `sha256d` (js-sha256) supaya
 * jalur shared core tetap browser-safe. Nonce dibaca dari blok tersimpan dan
 * ditambal ke 4 byte terakhir payload, jadi blok mana pun bisa direkonstruksi
 * ulang dari field-nya sendiri (tidak ada payload yang perlu dipercaya).
 */
export const verifyBlockHash = (currentBlock: Block) => {
	const payload = buildMiningPayload(currentBlock)
	const hash = hashWithNonce(payload, currentBlock.block.header.nonce)
	if (hash !== currentBlock.block.header.hash) {
		throw new Error('Block hash is invalid')
	}
	return true
}
