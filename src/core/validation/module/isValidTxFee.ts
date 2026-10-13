import { validateRule } from './validateField'
import { TxInterface } from 'src/types/transaction'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'

/**
 * Lantai laju-fee: 1000 nexu per kB wire (1 kB = 1000 byte) = 1 nexu/byte.
 *
 * Konstanta kebijakan diletakkan DI SINI (modul aturan yang menegakkannya),
 * bukan di `token/constants` (fakta satuan) supaya perubahan laju selalu
 * berdampingan dengan pesan error dan aturan yang memakainya. Satuan laju
 * memakai kB desimal 1000 agar `ceil(size × rate / 1000)` = `size` untuk
 * rate 1000 — tanpa pembulatan 1024 yang membingungkan.
 *
 * Ukuran yang ditimbang = ukuran wire transaksi TERTANDATANGAN kanonik:
 * panjang byte hasil `encodeTxPayload` (`0x02 ‖ rlp(signed)`), yaitu
 * persis byte yang dikirim klien dan di-hash menjadi `txHash` — bukan
 * ukuran JSON objek yang bisa dibengkakkan tanpa mengubah transaksi.
 */
export const MIN_FEE_RATE_NEXU_PER_KB = 1000

/**
 * Aturan fee (STAGE 1 + P1 kebijakan laju-fee):
 *   1. fee tidak boleh negatif (guard fail-closed, lihat catatan);
 *   2. fee tidak boleh melebihi jumlah transaksi (aturan bisnis yang sudah
 *      disepakati sejak awal, dipertahankan agar Stage 1 tidak mengubah
 *      economics jaringan);
 *   3. P1: fee tidak boleh di bawah lantai laju-fee — `fee >= ceil(ukuran
 *      wire × rate / 1000)`. Tanpa lantai, satu akun bisa membanjiri
 *      mempool dengan transaksi senilai 1 nexu secara cuma-cuma (biaya
 *      penyimpanan & pemrosesan ditanggung seluruh jaringan).
 *
 * `sizeBytes` OPSIONAL: bila dilewatkan, ukuran wire dihitung ulang dari
 * transaksi lewat codec kanonik (`encodeTxPayload`). Kebijakan ini sengaja
 * ditanam DI DALAM validator sehingga SEMUA jalur admission — server
 * (`txValidator.v`) maupun client (`clientValidateTx`) — otomatis
 * memakainya tanpa perlu mengingat parameter baru; parameter eksplisit
 * disediakan untuk gate/regresi yang ingin mengunci batas ukuran tertentu.
 * Transaksi yang tidak bisa di-encode (tanda tangan/alamat rusak) DITOLAK
 * (fail-closed) — validasi berikutnya tidak relevan bila wire-nya sendiri
 * tidak ada bentuknya.
 *
 * STAGE 1 FIX: sebelumnya argumen helper dibalik sehingga fee yang
 * MELEBIHI amount justru lolos, sedangkan fee wajar ditolak.
 *
 * Catatan fail-closed: fee negatif pernah lolos karena tidak ada sama sekali
 * pemeriksaan tanda. Before Stage 1 hal ini tidak bisa dieksploitasi karena
 * amount positif selalu ditolak lebih dulu; setelah Stage 1 amount positif
 * menjadi legal, sehingga guard `fee >= 0` WAJIB ikut dipasang di commit yang
 * sama agar tidak membuka celah baru.
 *
 * Catatan bilangan: transaksi yang diterima node selalu melewati `decodeTx`,
 * yang menolak integer non-kanonik — jadi `fee` di sini sudah bilangan bulat
 * aman ≥ 0. Guard `fee >= 0` tetap dipertahankan untuk pemanggil client
 * (draft builder) yang belum tentu melewati codec.
 */
export const validateTransactionFees = (
	transaction: TxInterface,
	sizeBytes?: number,
): boolean => {
	if (
		!validateRule(
			transaction.fee! >= 0,
			'transactionValidator',
			'Invalid transaction fee: fee must not be negative',
		)
	) {
		return false
	}
	if (
		!validateRule(
			transaction.fee! <= transaction.amount,
			'transactionValidator',
			'Invalid transaction fee',
		)
	) {
		return false
	}

	// ---- Lantai laju-fee (P1) -------------------------------------------
	let size = sizeBytes
	if (size === undefined) {
		try {
			size = encodeTxPayload(transaction).length
		} catch {
			return validateRule(
				false,
				'transactionValidator',
				'Invalid transaction fee: ukuran wire tidak dapat dihitung ' +
					'(transaksi tidak sah)',
			)
		}
	}
	if (
		!validateRule(
			Number.isSafeInteger(size) && size > 0,
			'transactionValidator',
			'Invalid transaction fee: ukuran wire tidak sah',
		)
	) {
		return false
	}

	const minFee = Math.ceil((size * MIN_FEE_RATE_NEXU_PER_KB) / 1000)
	return validateRule(
		transaction.fee! >= minFee,
		'transactionValidator',
		`Invalid transaction fee: fee ${transaction.fee} nexu di bawah lantai ` +
			`laju-fee ${minFee} nexu (ukuran wire ${size} byte × ` +
			`${MIN_FEE_RATE_NEXU_PER_KB} nexu/kB = 1 nexu/byte)`,
	)
}
