import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { Block } from 'src/core/block/blockModel'
import { rocksState } from 'src/core/state/db/state'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { getBlockState } from './getState'
import { MAX_SUPPLY_NEXU, NEXU_PER_NXC } from 'src/core/token/constants'
import { assertNexuCapped } from 'src/core/token/isNexuCapped'

export interface blockState {
	currentBlockHeight: number
	prevBlockHash: string
	currentBlockHash: string
	currentTimestamp: number
	blockReward: number
	lastUpdated: number
	currentBlockSize: number
	/**
	 * Akumulasi seluruh `blockReward` sejak genesis — DASAR PENEGAKAN
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
	 * SIFAT: PENCETAKAN PERSIS (bukan lagi perkiraan konservatif)
	 * ====================================================================
	 * Sejak P2 inkremen memakai `block.block.blockReward` SAJA:
	 *
	 *   - `gasPrice` dihapus — dulu ia "nxc dari udara" di luar jadwal;
	 *   - `totalTransactionFees` TIDAK dihitung: fee adalah TRANSFER dari
	 *     pengirim ke penambang (pengirim sudah didebit `amount + fee`),
	 *     bukan pencetakan baru. Kredit − debit per blok tepat
	 *     `blockReward`, jadi kounter ini = suplai riil yang beredar.
	 *
	 * Dengan jadwal halving baru: Σ blockReward (closed-form, lihat
	 * `distributeBlockReward.ts`) = 4_999_999_978_000_000 nexu
	 * (49_999_999.78 NXC) + genesis 0 (GENESIS_REWARD_NEX = 0 sejak P2)
	 * = di bawah plafon 50 juta NXC. Guard di `prepareBlockState` karena
	 * itu menjadi tripwire terhadap BUG jadwal — bukan mekanisme yang
	 * dipacu fee.
	 */
	totalIssued: number
}

/**
 * Kontribusi satu blok ke `totalIssued` — `blockReward` murni.
 *
 * Bukan `totalReward` (blockReward + fee): fee tidak menambah suplai.
 * Field ini selalu ada (genesis pun mengisinya) dan tidak bergantung pada
 * `metadata` opsional.
 */
const issuanceOf = (block: Block): number => block.block.blockReward

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

/**
 * Siapkan objek `blockState` untuk blok ini — guard plafon suplai + proyeksi
 * `totalIssued` — **tanpa menulis apa pun** (gagal-dulu).
 *
 * Dipisah dari tulisan supaya jalur commit (`saveBlock`) bisa menjalankan
 * SEMUA guard lebih dulu, baru menulis blok secara atomik. Selama guard
 * melempar, tidak satu byte pun masuk DB — bukan "setengah blok" seperti
 * bila guard berada setelah put pertama.
 */
export const prepareBlockState = async (block: Block): Promise<blockState> => {
	// ---- Guard plafon suplai (gagal-dulu) -------------------------------
	// Dilempar, bukan dicatat: `saveBlock` mengubah throw menjadi `false`,
	// `saveBlockToChain` mengangkatnya jadi error, dan `commitBlock`
	// membatalkan seluruh blok. Tidak ada state yang tertulis.
	//
	// `blockReward` diperiksa PALING AWAL — bahkan sebelum
	// `projectTotalIssued` membaca DB. Nilai ini milik INPUT, jadi
	// menolaknya tidak boleh membutuhkan I/O: selain tidak perlu membuka
	// kunci penyimpanan, ini membuat titik penegakan ketiga ini bisa
	// diuji langsung oleh `check:cap` tanpa menyentuh DB.
	assertNexuCapped(
		block.block.blockReward,
		`setBlockState.blockReward@${block.block.height}`,
	)

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
	assertNexuCapped(
		totalIssued,
		`setBlockState.totalIssued@${block.block.height}`,
	)

	return {
		currentBlockSize: block.block.size,
		prevBlockHash: block.block.header.previousBlockHash,
		currentBlockHash: block.block.header.hash,
		currentBlockHeight: block.block.height,
		currentTimestamp: block.block.header.timestamp,
		lastUpdated: generateTimestampz(),
		blockReward: block.block.blockReward,
		totalIssued,
	}
}

/**
 * Tulis `blockState` tunggal ke DB state (satu `put`, sync).
 *
 * Catatan jalur commit: `saveBlock` TIDAK memakai fungsi ini secara langsung
 * — ia memakai `prepareBlockState` lalu menggabungkan tulisan state ke dalam
 * SATU `batch` atomik bersama indeks `blockHeight:` (lihat `saveBlock`).
 * Fungsi ini dipertahankan sebagai jalur tulis satu-tujuan (dipakai gate
 * `check:cap` untuk menguji guard tanpa menyentuh batch).
 */
export const setBlockState = async (block: Block) => {
	const blockState = await prepareBlockState(block)
	const parseState = stringToHex(JSON.stringify(blockState))
	await rocksState.put(`blockState`, parseState, {
		sync: true,
	})
}
