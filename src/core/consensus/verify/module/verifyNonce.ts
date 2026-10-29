import { Block } from 'src/core/block/blockModel'
import { getAccount } from 'src/core/state/account/getAccount'
import { isTxExecuted } from 'src/core/transaction/isTxExecuted'

/**
 * Galat khusus urutan nonce per-pengirim di dalam blok.
 *
 * Dibedakan dari galat lain supaya penolakan nonce mudah dikenali di log
 * (`commitBlock` mencatat pesan ini) — pola kelas + type-guard `is*Error`.
 */
export class NonceMismatchError extends Error {
	readonly sender: string
	readonly expected: number
	readonly actual: number
	constructor(sender: string, expected: number, actual: number) {
		super(
			`Urutan nonce rusak untuk ${sender}: ` +
				`diharapkan ${expected}, dapat ${actual} — ` +
				`transaksi tiap pengirim di dalam blok wajib urut ` +
				`tanpa lompat (kontigu dari nonce akun pra-blok).`,
		)
		this.name = 'NonceMismatchError'
		this.sender = sender
		this.expected = expected
		this.actual = actual
	}
}

export const isNonceMismatchError = (error: unknown): boolean =>
	error instanceof NonceMismatchError ||
	(error instanceof Error && error.name === 'NonceMismatchError')

/**
 * Pra-penerbangan nonce per-pengirim — fail-early SEBELUM tulisan WAL/state.
 *
 * MENGAPA ada: `verifyBlockReward` menjumlah fee SEMUA tx di blok dan
 * membayarnya ke miner lewat coinbase, sementara `processTransact` mendebet
 * tiap tx (`amount + fee`) dari pengirimnya. Tanpa cek urutan, blok berisi
 * tx nonce-lompat (mis. nonce 0 lalu 2 tanpa 1) tetap lolos: fee tx nonce-2
 * ikut dibayar ke miner padahal tx itu TIDAK PERNAH dieksekusi dengan benar
 * (akuntansi nonce pengirim rusak). Invarian yang ditegakkan: "masuk blok
 * ⇒ tereksekusi" — tiap tx non-duplikat di blok harus tepat nonce
 * yang diharapkan pengirimnya saat itu.
 *
 * Aturan (per-pengirim, urutan blok dipertahankan):
 *   - telusuri transaksi blok sesuai urutan;
 *   - bila `isTxExecuted(txHash)` benar, LEWATI (toleransi residu crash
 *     antara tulis-riwayat dan hapus-mempool) — lewatan TIDAK memajukan
 *     penghitung (tx yang dilewati memang tidak diterapkan ulang);
 *   - selain itu nonce tx WAJIB sama dengan penghitung berjalan yang mulai
 *     dari `account.nonce` pra-blok (akun tak dikenal = nonce 0).
 *     Ketidakcocokan → LEMPAR `NonceMismatchError` → `commitBlock`
 *     menolak blok (di titik ini belum ada yang ditulis, jadi penolakan
 *     bersih tanpa rollback).
 *
 * Urutan antar-pengirim TIDAK relevan — hanya urutan internal tiap
 * pengirim yang diperiksa.
 *
 * @param block blok yang akan diperiksa
 */
export const verifyBlockNonceOrder = async (block: Block): Promise<void> => {
	const nextExpected = new Map<string, number>()
	const txs = block.block.transactions
	for (const tx of txs) {
		if (tx.txHash && (await isTxExecuted(tx.txHash))) continue
		const sender = tx.from
		if (!sender) {
			throw new NonceMismatchError('(tanpa pengirim)', -1, tx.nonce ?? -1)
		}
		let expected = nextExpected.get(sender)
		if (expected === undefined) {
			const account = await getAccount(sender)
			expected = account?.nonce ?? 0
			nextExpected.set(sender, expected)
		}
		const actual = tx.nonce ?? -1
		if (actual !== expected) {
			throw new NonceMismatchError(sender, expected, actual)
		}
		nextExpected.set(sender, expected + 1)
	}
}
