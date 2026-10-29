import { verifyStruct } from './module/verifyStruct'
import { verifyPow } from './module/verifyPow'
import { verifyHashLength } from './module/verifyHashLength'
import { verifyBlockHash } from './module/verifyBlockHash'
import { verifyBlockReward } from './module/verifyReward'
import {
	checkBlockTimestamp,
	getPreviousTimestamps,
	MTP_WINDOW,
} from './module/verifyTimestamp'
import { expectedDifficulty } from '../difficulty'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { Block } from 'src/core/block/blockModel'
import { verifyMerkleRoot } from './module/verifyMerkleRoot'
import { logToConsole } from 'src/logging/logging'
import { loggingErr } from 'src/logging/errorLog'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { GENESIS_HASH } from 'src/core/block/genesis'
import { currentHeight as storedTipHeight } from 'src/core/state/journal/store'
import {
	getVerifyMarker,
	resetVerifyMarker,
	setVerifyMarker,
} from './verifyMarker'

/**
 * Model verifikasi — **standar PoW Bitcoin**: blok TIDAK ditandatangani
 * siapa pun (field `sign` dihapus dari struktur blok). Yang mengamankan
 * rantai:
 *   1. `verifyStruct`  — struktur blok & transaksi sesuai skema, termasuk
 *      sejak C1: plafon `size`/jumlah tx dan `size` wajib = Σ byte wire
 *      transaksi isinya (lihat `blockLimits.ts`);
 *   2. `verifyHashLength` — hash 64 digit;
 *   3. `verifyPow`     — hash memenuhi `header.difficulty`;
 *   4. `verifyBlockHash` — hash = SHA-256(preimage ‖ nonce);
 *   5. `verifyMerkleRoot` — merkle cocok dengan transaksi (kecuali genesis);
 *   6. `verifyBlockReward` — hadiah/fee/coinbase direhitung dari
 *      fungsi deterministik (kecuali genesis, lihat pengecualian di bawah);
 *   7. `checkBlockTimestamp` — timestamp > median-time-past 11 blok
 *      sebelumnya dan tidak lebih dari 2× target blok ke depan;
 *   8. difficulty — `header.difficulty` **DIHITUNG ULANG** dari data induk
 *      (`expectedDifficulty`), BUKAN dipercaya (kecuali genesis);
 *   9. genesis — hash WAJIB sama dengan konstanta `GENESIS_HASH` kode ini
 *      (identitas jaringan; anti-fork / anti-tamper).
 *
 * Seluruh hasil dievaluasi; kegagalan mencatat height, hash, dan check yang
 * gagal, lalu mengembalikan false (rantai dianggap rusak → `nex_getWork`
 * menolak membangun blok baru di atasnya).
 *
 * Pengecualian sadar:
 *   - height 0 (genesis): merkle root memakai sentinel 64 "0" tanpa
 *     transaksi (bootstrap, bukan hasil `createMerkleRoot`) — dicek lewat
 *     PoW + hash, identitas via `GENESIS_HASH`, dan difficulty-nya bagian
 *     dari konstanta hardcoded (tidak dihitung ulang).
 *
 * ## Dua jalur (S4 / T03)
 *
 *   - `verifyChainIntegrity()` — **penuh** dari height 0. Dipakai saat boot
 *     / pemanggilan pertama / setelah marker dibatalkan reorg.
 *   - `verifyChainIncremental()` — **inkremental**: memverifikasi HANYA sufiks
 *     di atas marker hash-keyed (`verifyMarker.ts`), memakai loop yang SAMA
 *     (`verifyRange`) sehingga hasilnya identik dengan jalur penuh. Inilah
 *     yang dipakai `nex_getWork` (lewat `isChainsValid`), mengubah biaya
 *     O(N) per panggilan menjadi O(Δ).
 */

/**
 * Keadaan lintas-blok yang dibawa loop verifikasi: jendela MTP-11 rolling +
 * data induk untuk hitung-ulang difficulty deterministik.
 */
interface VerifySeed {
	previousTimestamps: number[]
	prevDifficulty: number | undefined
	prevTimestamp: number | undefined
	prevHeight: number
}

const EMPTY_SEED: VerifySeed = {
	previousTimestamps: [],
	prevDifficulty: undefined,
	prevTimestamp: undefined,
	prevHeight: -1,
}

/**
 * Verifikasi blok `startHeight`, `startHeight + 1`, … sampai blok terakhir yang
 * ada, dimulai dari keadaan lintas-blok `seed`.
 *
 * SATU-SATUNYA loop verifikasi: jalur penuh memanggilnya dengan
 * `startHeight = 0` + `EMPTY_SEED`, jalur inkremental dengan seed yang
 * direkonstruksi dari marker. Karena keduanya memakai loop ini, hasil
 * keduanya identik **oleh konstruksi**.
 *
 * Marker dimajukan setiap blok yang lolos; pada kegagalan marker
 * DI-RESET (rantai rusak tak boleh menyisakan titik terpercaya).
 */
const verifyRange = async (
	startHeight: number,
	seed: VerifySeed,
): Promise<boolean> => {
	let currentHeight = startHeight
	// Salin array agar pemanggil tak ikut termutasi.
	const previousTimestamps = [...seed.previousTimestamps]
	let prevDifficulty = seed.prevDifficulty
	let prevTimestamp = seed.prevTimestamp
	let prevHeight = seed.prevHeight

	while (true) {
		const block = (await getBlockByHeight(currentHeight)) as Block | undefined
		if (!block) {
			// Dulu blok hilang di TENGAH rantai dianggap "verified" — lubang
			// lolos tanpa jejak. Tinggi terakhir yang benar-benar dibaca wajib
			// sama dengan tip yang diakui `blockState`: kurang = blok hilang,
			// lebih = penunjuk tip mendahului data.
			const tip = await storedTipHeight()
			const reached = currentHeight - 1
			if (reached !== tip) {
				loggingErr({
					message: `Chain integrity gagal: verifikasi berhenti di height ${reached}, tetapi blockState.currentBlockHeight=${tip}`,
					stack: new Error().stack!,
					timestamp: generateTimestampz(),
					level: 'error',
					priority: 'high',
					context: 'verifyChainIntegrity',
					hint: 'Blok hilang di tengah rantai atau penunjuk tip mendahului data. Reset direktori data (NEX_DATA_DIR) atau pulihkan dari node lain.',
				})
				resetVerifyMarker()
				return false
			}
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
		// + batas masa depan 2× target blok dari sekarang.
		const timestampReason = checkBlockTimestamp(
			block.block.header.timestamp,
			previousTimestamps,
			Date.now(),
		)
		if (timestampReason !== null) {
			failures.push(`timestamp (${timestampReason})`)
		}

		// Difficulty: DIHITUNG ULANG dari data induk (deterministik) — angka
		// header TIDAK dipercaya. Genesis (height 0) dikecualikan; blok
		// pertama di atas genesis ditangani `expectedDifficulty` sendiri
		// (parentHeight 0 → difficulty tidak berubah).
		if (
			currentHeight > 0 &&
			prevDifficulty !== undefined &&
			prevTimestamp !== undefined
		) {
			const expected = expectedDifficulty(
				prevDifficulty,
				prevTimestamp,
				block.block.header.timestamp,
				prevHeight,
			)
			if (block.block.header.difficulty !== expected) {
				failures.push(
					`difficulty (header ${block.block.header.difficulty} != expected ${expected})`,
				)
			}
		}

		// Rolling window: simpan timestamp blok yang baru lolos (atau tidak —
		// bila gagal, loop berhenti anyway) dan jaga maksimal MTP_WINDOW.
		previousTimestamps.push(block.block.header.timestamp)
		if (previousTimestamps.length > MTP_WINDOW) previousTimestamps.shift()
		prevDifficulty = block.block.header.difficulty
		prevTimestamp = block.block.header.timestamp
		prevHeight = currentHeight

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
			// Rantai tidak valid → jangan sisakan titik terpercaya.
			resetVerifyMarker()
			return false
		}

		// Blok lolos SELURUH pemeriksaan → majukan marker (hash-keyed) ke blok
		// ini. Inilah yang membuat pemanggilan berikutnya hanya memeriksa
		// sufiks baru, bukan dari genesis.
		setVerifyMarker(currentHeight, hash)

		currentHeight++
	}
}

/**
 * Verifikasi penuh dari height 0. Mereset marker lebih dulu supaya titik
 * terpercaya selalu berasal dari pemeriksaan yang benar-benar berjalan.
 */
export const verifyChainIntegrity = async (): Promise<boolean> => {
	logToConsole('Checking chain integrity...')
	resetVerifyMarker()
	return await verifyRange(0, EMPTY_SEED)
}

/**
 * Verifikasi inkremental: hanya blok di ATAS marker hash-keyed.
 *
 *   - tanpa marker → jalankan verifikasi penuh (boot / baru dibatalkan reorg);
 *   - marker menunjuk blok yang tak ada / ber-hash berbeda (rantai berubah di
 *     bawah marker) → mulai dari nol (fail-closed);
 *   - selain itu → rekonstruksi jendela MTP + data induk dari blok NYATA
 *     (fungsi `getPreviousTimestamps` yang sama dipakai `createBlockTemplate`),
 *     lalu verifikasi sufiks dengan loop yang sama.
 *
 * Biaya O(Δ) (Δ = blok baru sejak pemeriksaan terakhir), bukan O(N).
 */
export const verifyChainIncremental = async (): Promise<boolean> => {
	const marker = getVerifyMarker()
	if (marker === undefined) {
		return await verifyChainIntegrity()
	}

	// Marker tetap sah? Blok di `marker.height` HARUS ada dan ber-hash SAMA.
	// Hash-keyed: setelah reorg, blok di height itu berganti → marker basi.
	const anchor = (await getBlockByHeight(marker.height)) as Block | undefined
	if (anchor === undefined || anchor.block.header.hash !== marker.hash) {
		return await verifyChainIntegrity()
	}

	// Verifikasi HANYA sufiks di atas marker. Jendela MTP + data induk
	// direkonstruksi dari blok nyata sehingga keadaan awal identik dengan
	// jalur penuh pada height itu (lihat `VerifySeed`).
	const startHeight = marker.height + 1
	const seed: VerifySeed = {
		previousTimestamps: await getPreviousTimestamps(startHeight),
		prevDifficulty: anchor.block.header.difficulty,
		prevTimestamp: anchor.block.header.timestamp,
		prevHeight: marker.height,
	}
	return await verifyRange(startHeight, seed)
}
