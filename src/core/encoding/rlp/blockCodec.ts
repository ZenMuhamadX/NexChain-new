/**
 * Skema wire BLOK NexChain — pemetaan `blockStruct` ke list RLP.
 *
 * Seperti `txCodec` untuk transaksi, ini DEFINISI KONTRAK wire blok: node yang
 * mengirim dan node yang menerima memakai file ini, sehingga tidak mungkin
 * berbeda pendapat soal urutan field.
 *
 * ## Kenapa RLP, bukan JSON
 *
 * Blok sebelumnya dikirim sebagai JSON mentah dengan SETIAP nama field diulang
 * di setiap blok. RLP hanya mengenal byte string dan list, jadi nama field
 * hilang sepenuhnya; urutannya ditentukan POSISI.
 *
 * ## Field mana yang wajib eksak
 *
 * Identitas blok adalah `sha256(JSON.stringify(preimage) ‖ nonce)` dengan
 * preimage dari `prepareBlockForHashing`: `previousBlockHash`, `timestamp`,
 * `version`, `hashingAlgorithm`, `difficulty`, `height`, `merkleRoot`,
 * `chainId`, `status`, `blockReward`, `minerId`, `totalReward`,
 * `coinbaseTransaction`, `transactions`. Karena hash dihitung dari
 * REPRESENTASI OBJEK, setiap field di preimage harus round-trip nilai DAN
 * urutan key-nya (JSON.stringify sensitif urutan). Field di luar preimage
 * (`size`, `metadata`, `totalTransactionFees`, `header.hash`) tetap dikirim
 * supaya blok hasil decode sama utuh dengan aslinya; kesalahan di sana tidak
 * mengubah hash, `verifyStruct`/`verifyReward` yang menjaganya.
 *
 * Urutan list — KONTRAK, jangan diubah tanpa menaikkan versi protokol:
 *
 *     0  header: [ previousBlockHash, timestamp, hash, nonce,
 *                  version, difficulty, hashingAlgorithm ]
 *     1  height
 *     2  size                  (float64 8 byte — `size` adalah float!)
 *     3  totalTransactionFees  (uint WAJIB)
 *     4  merkleRoot            (UTF-8 string — hex64 ATAU `TxC…`, lihat bawah)
 *     5  minerId
 *     6  chainId
 *     7  status
 *     8  blockReward
 *     9  totalReward
 *     10 coinbaseTransaction: [ receiver, amount, extraData ]
 *     11 metadata: [] bila absen, selain itu [ txCount, created_at, extraData ]
 *     12 transactions: [ payload tx, ... ]
 *
 * ## `difficulty` juga float64
 *
 * `clampDifficulty` mengkuantisasi difficulty ke kelipatan 0.25 bit, jadi nilai
 * seperti 21.5 sah dan benar-benar muncul di rantai nyata (retarget naik 2 bit
 * saat jeda antar-blok nyaris nol). Encoding integer akan MENOLAK blok seperti
 * itu dan mematikan pengiriman blok lewat P2P — karena itu ia memakai float64,
 * sama seperti `size`.
 *
 * ## `totalTransactionFees` WAJIB, bukan opsional
 *
 * Meski Joi menandainya opsional, `verifyReward` membandingkannya dengan
 * `!==` terhadap Σ fee yang dihitung ulang. Kalau 0 di-decode menjadi "absen"
 * (`undefined`), `undefined !== 0` menolak blok yang sebenarnya sah. Karena
 * itu 0 di-encode sebagai byte string kosong dan kembali sebagai 0 — bukan
 * sebagai absen.
 *
 * ## Transaksi di dalam blok
 *
 * Setiap transaksi dikirim sebagai payload bertipe yang SAMA dengan wire
 * transaksi mandiri (`encodeTxPayload`), sehingga decode-nya memakai
 * `decodeTxPayload`. Fungsi itu juga MENGHITUNG `from` (ecrecover) dan
 * `txHash`, dan keduanya wajib: `verifyStruct` menuntutnya (`from`/`txHash`
 * required) dan `createMerkleRoot` memakai `txHash` sebagai daun.
 */
import type { blockStruct } from 'src/types/block'
import type { header } from 'src/types/header'
import type { metadata } from 'src/types/metadata'
import type { TxInterface } from 'src/types/transaction'
import { CHAIN_ID } from 'src/crypto/chainId'
import type { RlpInput } from './rlpEncode'
import { decodeTxPayload, encodeTxPayload } from './txCodec'
import {
	addressToBytes,
	bytesToAddress,
	bytesToData,
	bytesToFloat64,
	bytesToHex,
	bytesToNumber,
	bytesToString,
	dataToBytes,
	float64ToBytes,
	hexToBytes,
	numberToBytes,
	stringToBytes,
} from './codecScalars'

const LABEL = 'blockCodec'

/** Panjang list di tiap tingkat — bagian dari kontrak. */
const BLOCK_ITEM_COUNT = 13
const HEADER_ITEM_COUNT = 7
const COINBASE_ITEM_COUNT = 3
const METADATA_ITEM_COUNT = 3

/** Ambil item byte string pada indeks tertentu, atau melempar. */
const item = (list: RlpInput[], index: number, field: string): Uint8Array => {
	const value = list[index]
	if (!(value instanceof Uint8Array)) {
		throw new Error(`${LABEL}: item ${index} (${field}) harus byte string`)
	}
	return value
}

/** Integer >= 0 dengan label codec blok. */
const uint = (value: number, field: string): Uint8Array =>
	numberToBytes(value, field, LABEL)

/** List RLP pada indeks tertentu dengan panjang tetap, atau melempar. */
const subList = (
	value: RlpInput,
	length: number,
	field: string,
): RlpInput[] => {
	if (!Array.isArray(value)) {
		throw new Error(`${LABEL}: ${field} harus list`)
	}
	if (value.length !== length) {
		throw new Error(
			`${LABEL}: ${field} harus ${length} item, dapat ${value.length}`,
		)
	}
	return value
}

// ---------------------------------------------------------------------------
// Struct -> RLP
// ---------------------------------------------------------------------------

export const blockToRlpList = (block: blockStruct): RlpInput[] => {
	const header: RlpInput[] = [
		hexToBytes(block.header.previousBlockHash),
		uint(block.header.timestamp, 'header.timestamp'),
		hexToBytes(block.header.hash),
		uint(block.header.nonce, 'header.nonce'),
		stringToBytes(block.header.version),
		// `difficulty` BUKAN bilangan bulat: `clampDifficulty` mengkuantisasi ke
		// kelipatan 0.25 bit (`QUANTUM_BITS`), jadi nilai seperti 21.5 sah dan
		// memang muncul di rantai nyata. `uint` akan menolaknya dan menggagalkan
		// pengiriman blok. float64 = round-trip eksak, sama seperti `size`.
		float64ToBytes(block.header.difficulty, 'header.difficulty', LABEL),
		// Opsional di Joi: absen → byte string kosong (bukan string kosong).
		block.header.hashingAlgorithm === undefined
			? new Uint8Array(0)
			: stringToBytes(block.header.hashingAlgorithm),
	]

	const coinbase: RlpInput[] = [
		addressToBytes(block.coinbaseTransaction.receiver, LABEL),
		uint(block.coinbaseTransaction.amount, 'coinbaseTransaction.amount'),
		dataToBytes(block.coinbaseTransaction.extraData, LABEL),
	]

	const metadata: RlpInput[] =
		block.metadata === undefined
			? []
			: [
					uint(block.metadata.txCount, 'metadata.txCount'),
					uint(block.metadata.created_at, 'metadata.created_at'),
					dataToBytes(block.metadata.extraData, LABEL),
				]

	return [
		header,
		uint(block.height, 'height'),
		float64ToBytes(block.size, 'size', LABEL),
		uint(block.totalTransactionFees, 'totalTransactionFees'),
		// `merkleRoot` adalah STRING BIASA, bukan hex64: dengan tepat satu
		// transaksi `createMerkleRoot` mengembalikan `txHash` (`TxC` + 64 hex,
		// 67 karakter). Meng-encode-nya sebagai byte hex akan merusak nilainya
		// secara senyap — di-encode sebagai UTF-8 supaya bentuk apa pun utuh.
		stringToBytes(block.merkleRoot),
		addressToBytes(block.minerId, LABEL),
		uint(block.chainId ?? CHAIN_ID, 'chainId'),
		stringToBytes(block.status),
		uint(block.blockReward, 'blockReward'),
		uint(block.totalReward, 'totalReward'),
		coinbase,
		metadata,
		block.transactions.map((tx) => encodeTxPayload(tx)),
	]
}

// ---------------------------------------------------------------------------
// RLP -> struct
// ---------------------------------------------------------------------------

export const rlpListToBlock = (list: RlpInput): blockStruct => {
	if (!Array.isArray(list) || list.length !== BLOCK_ITEM_COUNT) {
		const got = Array.isArray(list) ? `${list.length} item` : typeof list
		throw new Error(
			`${LABEL}: list RLP harus ${BLOCK_ITEM_COUNT} item, dapat ${got}`,
		)
	}

	const [headerList, , , , , , , , , , coinbaseList, metadataList] = list
	const headerItems = subList(headerList, HEADER_ITEM_COUNT, 'header')
	const coinbaseItems = subList(
		coinbaseList,
		COINBASE_ITEM_COUNT,
		'coinbaseTransaction',
	)
	if (!Array.isArray(metadataList)) {
		throw new Error(`${LABEL}: metadata harus list`)
	}

	let metadataValue: metadata | undefined
	if (metadataList.length === METADATA_ITEM_COUNT) {
		const extraData = bytesToData(item(metadataList, 2, 'metadata.extraData'))
		// Cast: interface menandai `extraData` wajib, Joi `optional`. Saat
		// absen key-nya memang hilang dari JSON.stringify — persis seperti blok
		// aslinya — jadi cast ini tidak menutupi nilai yang salah.
		metadataValue = {
			txCount: bytesToNumber(
				item(metadataList, 0, 'metadata.txCount'),
				'metadata.txCount',
				LABEL,
			),
			created_at: bytesToNumber(
				item(metadataList, 1, 'metadata.created_at'),
				'metadata.created_at',
				LABEL,
			),
			...(extraData === undefined ? {} : { extraData }),
		} as metadata
	} else if (metadataList.length !== 0) {
		throw new Error(
			`${LABEL}: metadata harus 0 atau ${METADATA_ITEM_COUNT} item`,
		)
	}

	const txItems = list[12]
	if (!Array.isArray(txItems)) {
		throw new Error(`${LABEL}: transactions harus list`)
	}
	const transactions: TxInterface[] = txItems.map((entry) => {
		if (!(entry instanceof Uint8Array)) {
			throw new Error(`${LABEL}: item transaksi harus byte string`)
		}
		return decodeTxPayload(entry)
	})

	const hashingAlgorithm = bytesToString(
		item(headerItems, 6, 'header.hashingAlgorithm'),
		'header.hashingAlgorithm',
		LABEL,
	)

	// `coinbaseTransaction.extraData` opsional: saat absen, key-nya hilang
	// (bukan bernilai `undefined`) supaya `JSON.stringify` preimage identik.
	const coinbaseExtra = bytesToData(
		item(coinbaseItems, 2, 'coinbaseTransaction.extraData'),
	)

	const headerValue: header = {
		previousBlockHash: bytesToHex(
			item(headerItems, 0, 'header.previousBlockHash'),
		),
		timestamp: bytesToNumber(
			item(headerItems, 1, 'header.timestamp'),
			'header.timestamp',
			LABEL,
		),
		hash: bytesToHex(item(headerItems, 2, 'header.hash')),
		nonce: bytesToNumber(
			item(headerItems, 3, 'header.nonce'),
			'header.nonce',
			LABEL,
		),
		version: bytesToString(
			item(headerItems, 4, 'header.version'),
			'header.version',
			LABEL,
		),
		difficulty: bytesToFloat64(
			item(headerItems, 5, 'header.difficulty'),
			'header.difficulty',
			LABEL,
		),
		// Byte kosong = absen (Joi `optional`). Cast: interface menandainya
		// wajib, Joi tidak — `undefined` membuat key hilang dari JSON.stringify,
		// persis seperti blok aslinya.
		hashingAlgorithm: (hashingAlgorithm || undefined) as string,
	}

	return {
		header: headerValue,
		height: bytesToNumber(item(list, 1, 'height'), 'height', LABEL),
		size: bytesToFloat64(item(list, 2, 'size'), 'size', LABEL),
		totalTransactionFees: bytesToNumber(
			item(list, 3, 'totalTransactionFees'),
			'totalTransactionFees',
			LABEL,
		),
		merkleRoot: bytesToString(item(list, 4, 'merkleRoot'), 'merkleRoot', LABEL),
		minerId: bytesToAddress(item(list, 5, 'minerId'), LABEL),
		chainId: bytesToNumber(item(list, 6, 'chainId'), 'chainId', LABEL),
		status: bytesToString(
			item(list, 7, 'status'),
			'status',
			LABEL,
		) as blockStruct['status'],
		blockReward: bytesToNumber(
			item(list, 8, 'blockReward'),
			'blockReward',
			LABEL,
		),
		totalReward: bytesToNumber(
			item(list, 9, 'totalReward'),
			'totalReward',
			LABEL,
		),
		// URUTAN KEY DI SINI ADALAH KONSENSUS. `coinbaseTransaction` ikut
		// preimage hash dan `JSON.stringify` sensitif urutan, jadi urutan ini
		// harus sama dengan yang dipakai PEMBUAT blok — `genesis.ts` dan
		// `createBlockTemplate.ts` sama-sama memakai `amount, receiver,
		// extraData`. Mengubahnya mengubah hash setiap blok.
		coinbaseTransaction: {
			amount: bytesToNumber(
				item(coinbaseItems, 1, 'coinbaseTransaction.amount'),
				'coinbaseTransaction.amount',
				LABEL,
			),
			receiver: bytesToAddress(
				item(coinbaseItems, 0, 'coinbaseTransaction.receiver'),
				LABEL,
			),
			...(coinbaseExtra === undefined ? {} : { extraData: coinbaseExtra }),
		},
		...(metadataValue === undefined ? {} : { metadata: metadataValue }),
		transactions,
	}
}
