/**
 * SHIM TIPE untuk wallet-ext.
 *
 * Modul asli (nexchain/transaction/setPendingBalance.ts) memuat implementasi
 * yang menulis ke LevelDB lewat `nexchain/db/state` — Node-only dan tidak
 * dipakai wallet browser (wallet membaca pending balance lewat RPC).
 * Yang dibutuhkan hanya INTERFACE-nya, jadi itu saja yang didefinisikan di sini.
 */
export interface pendingBalance {
	address: string
	pendingAmount: number
}
