import { rocksState } from 'src/core/state/db/state'
import { assertNexuCapped } from 'src/core/token/isNexuCapped'

/**
 * Fungsi untuk menyimpan pending balance ke database
 * @param {string} userId - ID unik user
 * @param {number} pendingAmount - Jumlah pending balance yang akan disimpan
 * @returns {Promise} - Resolusi ketika data telah tersimpan
 */

export interface pendingBalance {
	address: string
	pendingAmount: number
}

export const setPendingBalance = async (data: pendingBalance): Promise<any> => {
	// GUARD FAIL-CLOSED di LUAR try/catch: blok `catch` di bawah hanya
	// `console.error` lalu kembali normal, sehingga guard di dalamnya akan
	// dicatat tetapi data tetap tersimpan.
	//
	// `pendingAmount` adalah reserve untuk transaksi yang belum dieksekusi
	// — nilainya `Σ(amount + fee)`, selalu bilangan bulat aman ≥ 0 dan
	// tidak boleh melebihi plafon suplai.
	assertNexuCapped(
		data.pendingAmount,
		`setPendingBalance(${data.address}).pendingAmount`,
	)

	try {
		const pendingBalanceData: pendingBalance = {
			address: data.address,
			pendingAmount: data.pendingAmount,
		}
		const stringData = JSON.stringify(pendingBalanceData)
		// Simpan pending balance ke database dengan key berdasarkan userId
		await rocksState.put(`pendingBalance:${data.address}`, stringData)
	} catch (error) {
		console.error(error)
	}
}
