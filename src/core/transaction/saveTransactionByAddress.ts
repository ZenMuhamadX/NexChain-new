import { bufferPut } from 'src/core/state/journal/writeBuffer'
import { COINBASE_SENDER } from 'src/core/transaction/createCoinbaseTransaction'

/**
 * Indeks riwayat alamat — SATU entri per (alamat, transaksi).
 *
 * Dulu satu kunci `address:<alamat>` berisi array JSON seluruh txHash alamat
 * itu: setiap transaksi harus membaca lalu menulis ulang array utuh, jadi biaya
 * tulis untuk alamat ke-n tumbuh kuadratik terhadap n — dan record journal/WAL
 * satu blok ikut membengkak seiring panjang riwayat. Dengan key per-entri,
 * satu transaksi selalu satu `put` kecil yang ukurannya tetap.
 *
 * Key: `addr:<alamat>:<tinggi 8 digit>:<txHash>`; nilai: arah `in`/`out`
 * (`self` bila pengirim == penerima). Tinggi di-zero-pad supaya urutan
 * leksikografis key sama dengan urutan rantai.
 *
 * Hadiah blok ditulis oleh `processTransact` dengan `from = COINBASE_SENDER`
 * (bukan alamat sah), jadi sisi `out`-nya dilewati agar indeks tidak berisi
 * entri untuk alamat palsu.
 */
export const saveTxByAddress = async (
	from: string,
	receiver: string,
	txHash: string,
	height: number,
): Promise<void> => {
	const key = (address: string): string =>
		`addr:${address}:${String(height).padStart(8, '0')}:${txHash}`

	if (from !== COINBASE_SENDER)
		await bufferPut('history', key(from), from === receiver ? 'self' : 'out')
	if (from !== receiver) await bufferPut('history', key(receiver), 'in')
}
