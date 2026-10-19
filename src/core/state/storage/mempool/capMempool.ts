import { TxInterface } from 'src/types/transaction'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { logToConsole } from 'src/logging/logging'
import { formatStr } from 'src/core/encoding/lib/formatString'
import { loadAllMempool } from './loadMempool'
import { removeMemPool } from './removeMempool'

/**
 * Cap byte GLOBAL mempool — KEBIJAKAN node, BUKAN konsensus.
 *
 * MENGAPA ada (Gelombang 3/A3): `MAX_PENDING_PER_SENDER` membatasi per
 * pengirim, tapi jumlah PENGIRIM tak berbatas — tanpa cap global satu
 * gerombolan pengirim bisa menumbuhkan mempool tanpa akhir. Dua akibatnya:
 *   - pindai template (`loadAllMempool` + seleksi laju-fee di `nex_getWork`)
 *     dan seluruh pindai prefix indeks tumbuh linear tanpa plafon;
 *   - tx yang tak pernah bisa ditambang (di luar cakupan blok) menahan ruang
 *     dan reserve pengirimnya selamanya — tidak ada expiry berbasis umur.
 *
 * Angkanya 10 blok (`MAX_BLOCK_WIRE_BYTES` = 100 kB): cukup menampung
 * lonjakan beberapa blok ke depan tanpa menjadi gudang. Karena isi mempool
 * itu node-local, angka berbeda antar node TIDAK memicu fork — persis
 * seperti cap per-pengirim.
 *
 * shortcut: byte pool dihitung dengan pindai PENUH tiap admission, bukan
 * counter tersimpan. Alasannya sama dengan indeks per-pengirim: nilai
 * turunan tidak bisa drift dari kenyataan (counter pernah dibuang di sini
 * justru karena itu). Biayanya sebanding ukuran pool, dan ukuran pool
 * memang dibatasi cap ini — tetapi biaya itu dibayar per admission, sehingga
 * jalur yang menambah banyak tx berturut-turut (tambah-ulang tx yatim
 * sesudah reorg) ikut mengalikannya. Bila cap dinaikkan jauh atau reorg
 * dalam atas pool penuh jadi lazim, simpan total byte di dalam batch yang
 * sama dengan entri mempool (satu nilai di indeks per-pengirim, bukan
 * counter terpisah).
 */
export const MAX_MEMPOOL_WIRE_BYTES = 10 * 100 * 1000

/** Satu entri pool beserta ukuran wire kanoniknya (dihitung sekali). */
type Entry = { tx: TxInterface; size: number }

/**
 * Ukuran wire kanonik tx (`encodeTxPayload`) — 0 bila tak ter-encode.
 *
 * 0 berarti "tak bisa diukur": entri seperti itu DIABAIKAN dalam akuntansi
 * (tidak dihitung, tidak boleh jadi korban evictasi) — dan memang tak akan
 * pernah bisa masuk blok, karena codec yang sama dipakai merelay blok.
 */
const wireSize = (tx: TxInterface): number => {
	try {
		return encodeTxPayload(tx).length
	} catch {
		return 0
	}
}

/**
 * `true` bila laju `a` (fee/byte) LEBIH RENDAH dari `b` — perkalian silang,
 * bukan float. Dipakai untuk memilih korban evictasi.
 */
const lowerRate = (
	aFee: number,
	aSize: number,
	bFee: number,
	bSize: number,
): boolean => aFee * bSize < bFee * aSize

/**
 * Antrean pengirim TERMURAH (tx paling murah yang ia tahan lebih rendah dari
 * laju `feeIn`/`sizeIn`), atau `undefined` bila tak ada yang lebih murah.
 *
 * Yang DIBUANG adalah EKOR antrean (nonce tertinggi), sedangkan yang
 * menentukan "termurah" adalah tx termurah di antrean itu. MENGAPA ekor:
 * membuang tx di tengah antrean membuat nonce pengirim berlubang, dan sisa
 * antreannya tak akan pernah bisa ditambang (konsensus
 * `verifyBlockNonceOrder` menuntut kontigu). MENGAPA laju tx masuk jadi
 * batas: tx yang lebih murah tidak boleh menghalau tx yang lebih mahal —
 * evictasi hanya untuk tx yang benar-benar menang.
 */
const cheapestQueue = (
	queues: { sender: string; queue: Entry[] }[],
	skipSender: string,
	feeIn: number,
	sizeIn: number,
): { sender: string; queue: Entry[] } | undefined => {
	let best: { sender: string; queue: Entry[] } | undefined
	let bestFee = 0
	let bestSize = 0
	for (const candidate of queues) {
		// Pengirim tx masuk sendiri DILEWATI: membuang tx-nya yang ber-nonce
		// lebih rendah akan membuat tx yang baru lolos jadi gap.
		if (candidate.sender === skipSender || candidate.queue.length === 0) {
			continue
		}
		let minFee = 0
		let minSize = 0
		for (const entry of candidate.queue) {
			const fee = entry.tx.fee ?? 0
			if (minSize === 0 || lowerRate(fee, entry.size, minFee, minSize)) {
				minFee = fee
				minSize = entry.size
			}
		}
		if (!lowerRate(minFee, minSize, feeIn, sizeIn)) continue
		if (!best || lowerRate(minFee, minSize, bestFee, bestSize)) {
			best = candidate
			bestFee = minFee
			bestSize = minSize
		}
	}
	return best
}

/**
 * Tegakkan cap byte global: `true` = tx boleh masuk (evictasi sudah
 * dijalankan bila perlu), `false` = tolak.
 *
 * Dipanggil admission serial (`MemPool.doAddTransaction`) SEBELUM tx
 * disimpan, sesudah validasi, cap per-pengirim, dan saldo lolos — jadi pool
 * tidak pernah menyusut untuk tx yang toh ditolak lebih awal.
 *
 * Evictasi hanya menyentuh tx pengirim LAIN dan hanya yang laju-fee-nya
 * lebih rendah dari tx masuk; kandidat dibuang lewat `removeMemPool`
 * (satu-satunya jalur hapus yang ikut membersihkan indeks per-pengirim).
 * Evictasi yang sudah terjadi TETAP ditulis walau tx masuk akhirnya ditolak
 * — pool memang harus mengecil.
 *
 * @param tx - Transaksi yang akan masuk.
 * @param replaced - Tx pending pada nonce yang sama yang akan digantikan
 *   (RBF); byte-nya dilepas lebih dulu, sehingga penggantian tidak pernah
 *   ditolak hanya karena pool kebetulan penuh.
 * @param maxBytes - Batas byte. Parameter hanya untuk gate (menguji
 *   evictasi tanpa fixture 1 MB); produksi memakai bawaannya.
 */
export const enforceMempoolWireCap = async (
	tx: TxInterface,
	replaced?: TxInterface,
	maxBytes: number = MAX_MEMPOOL_WIRE_BYTES,
): Promise<boolean> => {
	const size = wireSize(tx)
	// Tx tak ter-encode tak akan pernah bisa masuk blok — fail-closed.
	if (size <= 0) return false

	// Susun antrean per-pengirim sekaligus hitung byte pool yang PERSIS.
	const bySender = new Map<string, Entry[]>()
	let total = 0
	for (const entry of await loadAllMempool()) {
		const entrySize = wireSize(entry)
		if (entrySize <= 0) continue
		// Tx yang sedang digantikan meninggalkan pool pada langkah berikutnya
		// (`replaceMempool`) — jangan dihitung dua kali.
		if (replaced && entry.txHash === replaced.txHash) continue
		total += entrySize
		const owner = entry.from
		if (typeof owner !== 'string' || owner.length === 0) continue
		const queue = bySender.get(owner)
		if (queue) queue.push({ tx: entry, size: entrySize })
		else bySender.set(owner, [{ tx: entry, size: entrySize }])
	}

	if (total + size <= maxBytes) return true

	// Antrean diurut NONCE (kunci indeks urut txHash, bukan nonce) supaya
	// "ekor" benar-benar tx ber-nonce tertinggi.
	const queues = [...bySender].map(([owner, queue]) => {
		queue.sort((a, b) => a.tx.nonce - b.tx.nonce)
		return { sender: owner, queue }
	})

	const dropped: string[] = []
	let freed = 0
	while (total + size - freed > maxBytes) {
		const victim = cheapestQueue(queues, tx.from ?? '', tx.fee ?? 0, size)
		if (!victim) break
		const tail = victim.queue.pop()!
		freed += tail.size
		if (tail.tx.txHash) dropped.push(tail.tx.txHash)
	}
	for (const txHash of dropped) await removeMemPool(txHash)

	if (total + size - freed > maxBytes) {
		// Tolak: bahkan sesudah membuang semua kandidat yang lebih murah, tx
		// ini tak muat — ukurannya sendiri melebihi cap, atau seluruh ruang
		// dipegang pengirimnya sendiri.
		logToConsole(
			`Mempool penuh (cap ${maxBytes} byte): ${formatStr(tx.txHash ?? '')} ` +
				`ditolak (butuh ${total + size - freed} byte)`,
		)
		return false
	}

	if (dropped.length > 0) {
		logToConsole(
			`Cap mempool: buang ${dropped.length} tx laju-fee terendah ` +
				`(${freed} byte) demi ${formatStr(tx.txHash ?? '')}`,
		)
	}
	return true
}
