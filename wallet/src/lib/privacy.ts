/**
 * Preferensi privasi tampilan.
 *
 * Satu-satunya nilai sekarang: apakah saldo di beranda disembunyikan. Disimpan
 * di `localStorage`, bukan state komponen, karena kalau tidak ia akan kembali
 * terlihat setiap aplikasi dibuka — dan alasan orang menyembunyikannya (ada
 * yang melihat layar) tidak berhenti saat aplikasi ditutup.
 *
 * Yang TIDAK disimpan di sini: nominal transaksi di daftar aktivitas tetap
 * terlihat. Menyembunyikan semuanya akan membuat daftar tidak bisa dipakai.
 */
const HIDE_BALANCE_KEY = 'nex_hide_balance'

/** `true` = saldo beranda sedang disembunyikan. */
export const getHideBalance = (): boolean => {
	try {
		return localStorage.getItem(HIDE_BALANCE_KEY) === '1'
	} catch {
		// localStorage diblokir (private mode) → tampilkan apa adanya
		return false
	}
}

export const setHideBalance = (value: boolean): void => {
	try {
		if (value) localStorage.setItem(HIDE_BALANCE_KEY, '1')
		else localStorage.removeItem(HIDE_BALANCE_KEY)
	} catch {
		// gagal persist bukan alasan menggagalkan toggle; berlaku sesi ini saja
	}
}
