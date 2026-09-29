import { hexToString } from 'src/core/encoding/hex/hexToString'
import { HexString } from 'src/types/block'

/**
 * Decode respons RPC yang dikodekan hex-JSON.
 *
 * Sebagian besar endpoint backend mengembalikan `stringToHex(JSON.stringify(x))`
 * — daftarnya terdokumentasi di tabel `explorer/src/api/methods.ts`
 * (`getAccount`, `getNonce`, `getPendingBalance`, ...).
 *
 * Bug yang dihindari helper ini: controller yang menerima respons mentah akan
 * menyimpannya sebagai STRING, sehingga `result.balance` = `undefined` dan
 * `undefined >= amount + fee` selalu `false`. Akibatnya validasi saldo client
 * selalu menjawab "Insufficient balance" dan transaksi TIDAK PERNAH terkirim,
 * meski saldo di node sebenarnya cukup.
 *
 * Bila respons ternyata sudah berupa objek/angka (method tanpa encoding),
 * nilainya diteruskan apa adanya — jadi helper ini aman dipakai umum.
 */
export const decodeHexJson = <T>(raw: unknown): T | undefined => {
	if (raw === undefined || raw === null) return undefined
	if (typeof raw !== 'string') return raw as T
	try {
		return JSON.parse(hexToString(raw as HexString)) as T
	} catch {
		return undefined
	}
}
