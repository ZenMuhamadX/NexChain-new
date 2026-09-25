import Joi from 'joi'
import { MAX_SUPPLY_NEXU } from 'nexchain/nexucoin/constants'

// Validator untuk struktur akun Ethereum
//
// CATATAN: skrip ini saat ini TIDAK dipanggil dari mana pun (pembacaan saldo
// memakai `getAccount` + guard `isNexuCapped` di `putAccount`). Batas plafon
// tetap dipasang supaya bila suatu saat disambungkan kembali, ia sudah
// konsisten dengan aturan yang berlaku di tempat lain.
export const nexAccountValidator = Joi.object({
	address: Joi.string().required(), // Alamat akun Ethereum
	balance: Joi.number().required().min(0).max(MAX_SUPPLY_NEXU), // Saldo dalam nexu — tidak boleh melebihi plafon suplai
	timesTransaction: Joi.number().required().min(0), // Jumlah transaksi
	lastTransactionDate: Joi.number().allow(null), // Tanggal transaksi terakhir (bisa null)
	nonce: Joi.number().required().min(0), // Nonce untuk menghindari replay attack
	isContract: Joi.boolean().required(), // Legacy: selalu false (fitur smart contract sudah dihapus)
})
