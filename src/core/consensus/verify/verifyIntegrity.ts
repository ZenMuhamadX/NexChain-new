import { verifyStruct } from './module/verifyStruct'
import { verifyPow } from './module/verifyPow'
import { verifyHashLength } from './module/verifyHashLength'
import { verifyBlockHash } from './module/verifyBlockHash'
import { verifyBlockReward } from './module/verifyReward'
import { checkBlockTimestamp, MTP_WINDOW } from './module/verifyTimestamp'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { Block } from 'src/core/block/blockModel'
import { verifyMerkleRoot } from './module/verifyMerkleRoot'
import { logToConsole } from 'src/logging/logging'
import { loggingErr } from 'src/logging/errorLog'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { GENESIS_HASH } from 'src/core/block/genesis'

/**
 * Verifikasi integritas seluruh rantai, blok per blok, dari height 0.
 *
 * Model verifikasi — **standar PoW Bitcoin**: blok TIDAK ditandatangani
 * siapa pun (field `sign` dihapus dari struktur blok). Yang mengamankan
 * rantai:
 *   1. `verifyStruct`  — struktur blok & transaksi sesuai skema;
 *   2. `verifyHashLength` — hash 64 digit;
 *   3. `verifyPow`     — hash memenuhi difficulty tersimpan di header;
 *   4. `verifyBlockHash` — hash = SHA-256(preimage ‖ nonce);
 *   5. `verifyMerkleRoot` — merkle cocok dengan transaksi (kecuali genesis);
 *   6. `verifyBlockReward` — hadiah/fee/gasPrice/coinbase direhitung dari
 *      fungsi deterministik (kecuali genesis, lihat pengecualian di bawah);
 *   7. `checkBlockTimestamp` — timestamp > median-time-past 11 blok
 *      sebelumnya dan tidak lebih dari 2 jam ke depan;
 *   8. genesis — hash WAJIB sama dengan konstanta `GENESIS_HASH` kode ini
 *      (identitas jaringan; anti-fork / anti-tamper).
 *
 * Seluruh hasil dievaluasi; kegagalan mencatat height, hash, dan check yang
 * gagal, lalu mengembalikan false (rantai dianggap rusak → `nex_getWork`
 * menolak membangun blok baru di atasnya).
 *
 * Pengecualian sadar:
 *   - height 0 (genesis): merkle root memakai sentinel 64 "0" tanpa
 *     transaksi (bootstrap, bukan hasil `createMerkleRoot`) — dicek lewat
 *     PoW + hash, dan identitas via `GENESIS_HASH`;
 *   - difficulty memakai nilai TERSIMPAN di header (verifyPow) — data lama
 *     ber-skema lama tetap valid bila hashnya memenuhi syaratnya, dan
 *     konsistensi retarget dijamin saat penyusunan template, bukan di sini.
 */
export const verifyChainIntegrity = async (): Promise<boolean> => {
	logToConsole('Checking chain integrity...')
	let currentHeight = 0
	// Jendela MTP-11 rolling lintas-blok: timestamp blok yang sudah
	// diverifikasi, maksimal MTP_WINDOW (dipakai `checkBlockTimestamp`).
	const previousTimestamps: number[] = []

	while (true) {
		const block = (await getBlockByHeight(currentHeight, 'json')) as
			Block | undefined
		if (!block) {
			logToConsole('Chain integrity verified.')
			return true
		}

		const hash = block.block.header.hash
		const failures: string[] = []

		if (!(await verifyStruct(block))) failures.push('structure')
		if (!verifyHashLength(hash)) failures.push('hash length')
		if (!verifyPow(block)) {
			failures.push(`pow (needs ${block.block.header.difficulty} bits)`)
		}
		try {
			verifyBlockHash(block)
		} catch {
			failures.push('block hash mismatch')
		}
		// Genesis: identitas jaringan — hash wajib sama dengan konstanta kode.
		if (currentHeight === 0 && hash !== GENESIS_HASH) {
			failures.push('genesis hash mismatch (bukan rantai jaringan ini)')
		}
		// Genesis: lihat catatan fungsi — merkle di-skip, sisanya tetap dicek.
		if (
			currentHeight > 0 &&
			!verifyMerkleRoot(block.block.transactions, block.block.merkleRoot)
		) {
			failures.push('merkle root')
		}

		// Hadiah/fee/coinbase: semua direhitung (genesis exempt — lihat
		// catatan fungsi `verifyBlockReward`).
		const rewardReason = verifyBlockReward(block)
		if (rewardReason !== null) failures.push(`reward (${rewardReason})`)

		// Timestamp: MTP-11 (rolling di seluruh loop, bukan per-blok terisolir)
		// + batas masa depan 2 jam dari sekarang.
		const timestampReason = checkBlockTimestamp(
			block.block.header.timestamp,
			previousTimestamps,
			Date.now(),
		)
		if (timestampReason !== null) {
			failures.push(`timestamp (${timestampReason})`)
		}
		// Rolling window: simpan timestamp blok yang baru lolos (atau tidak —
		// bila gagal, loop berhenti anyway) dan jaga maksimal MTP_WINDOW.
		previousTimestamps.push(block.block.header.timestamp)
		if (previousTimestamps.length > MTP_WINDOW) previousTimestamps.shift()

		if (failures.length > 0) {
			loggingErr({
				message: `Block ${currentHeight} (${hash}) invalid: ${failures.join(', ')}`,
				stack: new Error().stack!,
				timestamp: generateTimestampz(),
				level: 'error',
				priority: 'high',
				context: 'verifyChainIntegrity',
				hint: 'Rantai rusak atau bukan milik jaringan ini — hentikan node, periksa NEX_CHAIN_ID, atau reset direktori data (NEX_DATA_DIR). Mining ditolak sampai rantai valid.',
			})
			return false
		}

		currentHeight++
	}
}
