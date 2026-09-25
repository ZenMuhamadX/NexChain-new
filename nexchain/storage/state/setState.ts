import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { Block } from 'nexchain/model/block/block'
import { rocksState } from 'nexchain/db/state'
import { stringToHex } from 'nexchain/hex/stringToHex'
import { getBlockState } from './getState'
import { MAX_SUPPLY_NEXU, NEXU_PER_NXC } from 'nexchain/nexucoin/constants'
import { assertNexuCapped } from 'nexchain/nexucoin/isNexuCapped'

export interface blockState {
	currentBlockHeight: number
	prevBlockHash: string
	currentBlockHash: string
	currentTimestamp: number
	blockReward: number
	lastUpdated: number
	currentBlockSize: number
	/**
	 * Akumulasi seluruh `totalReward` sejak genesis — DASAR PENEGAKAN
	 * PLAFON SUPLAI 50 juta NXC.
	 *
	 * ====================================================================
	 * MENGAPA PERLU KOUNTER TERPISAH
	 * ====================================================================
	 * Plafon suplai adalah hard invariant, bukan properti emergent seperti
	 * jadwal halving Bitcoin. Memeriksanya butuh "berapa total yang sudah
	 * dicetak", dan menghitung ulang `Σ balance` berarti memindai seluruh
	 * DB tiap blok. Kounter berjalan di state membuat pemeriksaan O(1).
	 *
	 * ====================================================================
	 * SIFAT: BATAS ATAS YANG KONSERVATIF
	 * ====================================================================
	 * Inkremen memakai `block.block.totalReward`
	 * (= `blockReward + gasPrice + totalTransactionFees`), yaitu jumlah yang
	 * benar-benar dikreditkan ke akun coinbase.
	 *
	 * Sebagian nilainya BUKAN pencetakan baru: `totalTransactionFees` adalah
	 * transfer dari pengirim ke penambang (pengirim sudah didebit
	 * `amount + fee`). Jadi akumulasi ini ≥ pertambahan suplai sebenarnya:
	 *
	 *     Σ totalReward  ≥  Σ (blockReward + gasPrice)  =  Δ suplai riil
	 *
	 * Konservatif ke arah AMAN: penegakan bisa menghentikan rantai lebih
	 * awal, tapi tidak pernah mengizinkan suplai melewati plafon. Agar
	 * pengecekan ini tercapai lebih dulu, fee-nya harus menyentuh ~25 juta
	 * NXC (ratusan juta transaksi) — di luar jangkauan rantai mana pun.
	 */
	totalIssued: number
}

/**
 * Kontribusi satu blok ke `totalIssued`.
 *
 * `totalReward` adalah jumlah coinbase — field yang selalu ada (genesis
 * pun mengisinya) dan tidak bergantung pada `metadata` opsional.
 */
const issuanceOf = (block: Block): number => block.block.totalReward

/**
 * `key` `blockState` belum ada = rantai masih kosong (posisi awal 0).
 *
 * Semua error LAIN (DB korup, terkunci, CRC rusak) TIDAK diperlakukan
 * sebagai "belum ada" — kalau tidak, kegagalan baca akan melemparkan
 * plafon ke nol dan membuat guard melewatkan commit yang seharusnya
 * ditolak. Hanya "not found" yang boleh diplesetkan jadi 0.
 */
const isNotFound = (error: unknown): boolean => {
	if (typeof error !== 'object' || error === null) return false
	const e = error as { code?: unknown; notFound?: unknown; name?: unknown }
	return (
		e.notFound === true ||
		e.code === 'LEVEL_NOT_FOUND' ||
		e.code === 'ERR_LEVEL_NOT_FOUND' ||
		e.name === 'NotFoundError'
	)
}

/**
 * Proyeksi `totalIssued` SETELAH blok ini di-commit — **tanpa menulis apa
 * pun**. Dipakai `BlockChains.commitBlock` untuk menolak blok sebelum
 * satu byte pun masuk DB (gagal-dulu, bukan tulis-lalu-mogok).
 *
 * @throws Error bila state sebelumnya tidak bisa dibaca selain karena
 *         memang belum ada — menolak meneruskan tanpa tahu posisi awal.
 */
export const projectTotalIssued = async (block: Block): Promise<number> => {
	let prev: blockState | undefined
	try {
		prev = await getBlockState()
	} catch (error) {
		if (!isNotFound(error)) {
			throw new Error(
				`Gagal membaca blockState sebelumnya — menolak commit ` +
					`(posisi totalIssued tidak diketahui): ` +
					`${error instanceof Error ? error.message : String(error)}`,
			)
		}
		prev = undefined
	}

	if (prev === undefined) return issuanceOf(block)
	if (typeof prev.totalIssued !== 'number') {
		// State tanpa field ini. Hanya mungkin bila `blockState` ditulis kode
		// LAMA — dan rantai demikian TIDAK BISA boot (genesis hash versi lama
		// ≠ konstanta baru → `rpc/server.ts` keluar). Jadi kasus ini praktis
		// cuma terjadi kalau `blockState` terhapus sendiri.
		//
		// Anggap 0: membuat plafon sementara longgar, TIDAK PERNAH lebih
		// ketat dari kenyataan.
		return issuanceOf(block)
	}
	return prev.totalIssued + issuanceOf(block)
}

export const setBlockState = async (block: Block) => {
	// ---- Guard plafon suplai (gagal-dulu) -------------------------------
	// Dilempar, bukan dicatat: `saveBlock` mengubah throw menjadi `false`,
	// `saveBlockToChain` mengangkatnya jadi error, dan `commitBlock`
	// membatalkan seluruh blok. Tidak ada state yang tertulis.
	const totalIssued = await projectTotalIssued(block)
	if (totalIssued > MAX_SUPPLY_NEXU) {
		throw new Error(
			`Plafon suplai terlampaui: totalIssued=${totalIssued} > ` +
				`MAX_SUPPLY_NEXU=${MAX_SUPPLY_NEXU} ` +
				`(${MAX_SUPPLY_NEXU / NEXU_PER_NXC} NXC) pada blok ` +
				`height=${block.block.height}. Menolak commit.`,
		)
	}
	// Kedua nilai harus bilangan bulat aman dan ≤ plafon — kalau tidak,
	// aritmetika `number` di titik ini sudah mulai membulatkan diam-diam.
	assertNexuCapped(totalIssued, `setBlockState.totalIssued@${block.block.height}`)
	assertNexuCapped(block.block.blockReward, `setBlockState.blockReward@${block.block.height}`)

	const blockState: blockState = {
		currentBlockSize: block.block.size,
		prevBlockHash: block.block.header.previousBlockHash,
		currentBlockHash: block.block.header.hash,
		currentBlockHeight: block.block.height,
		currentTimestamp: block.block.header.timestamp,
		lastUpdated: generateTimestampz(),
		blockReward: block.block.blockReward,
		totalIssued,
	}
	const parseState = stringToHex(JSON.stringify(blockState))
	await rocksState.put(`blockState`, parseState, {
		sync: true,
	})
}
