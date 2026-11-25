import Joi from 'joi'
import { MAX_SUPPLY_NEXU } from 'src/core/token/constants'
import { TX_TYPE } from 'src/core/encoding/rlp/txCodec'
import { ETH_TX_TYPE } from 'src/core/encoding/rlp/ethTxCodec'

// Validator for memPoolInterface to ensure valid transaction data
//
// TANPA `.unsafe(true)`: sejak Stage 4 seluruh skrip Joi membiarkan Joi
// memakai aturan bawaannya, yang menolak `NaN`, `Infinity`, dan setiap
// bilangan bulat di luar rentang aman (`> 2^53`). Dulu `.unsafe(true)`
// mematikan pemeriksaan itu — sebuah `amount` sebesar `1e20` lolos
// validasi struktur, padahal `1e20` sudah melewati titik di mana `+`/`-`
// membulatkan diam-diam sehingga seluruh aritmetika saldo di belakangnya
// tidak bisa dipercaya.
export const txInterfaceValidator = Joi.object({
	amount: Joi.number()
		.required()
		.positive() // Memastikan nilai positif
		.min(0.999) // Memastikan minimal 1 Nexu
		// Batas atas = plafon suplai. Sebuah transaksi tunggal tidak boleh
		// bernilai lebih dari total suplai yang mungkin ada — kalau lolos,
		// `processReceiver` akan mengkredit saldo melewati plafon sebelum
		// guard `putAccount` sempat bekerja.
		.max(MAX_SUPPLY_NEXU)
		.messages({
			'number.base': '"amount" must be a number',
			'number.positive': '"amount" must be a positive number',
			'number.min': '"amount" must be at least 1 nexu',
			'number.max': '"amount" must not exceed the supply cap (50.000.000 NXC)',
		}),
	// `sender` TIDAK ada lagi: pengirim kini turunan (`from`). Joi menolak
	// key yang tidak dikenal secara bawaan, jadi transaksi yang masih membawa
	// `sender` akan gagal di sini — bukan diabaikan diam-diam.
	receiver: Joi.string().required(),
	// Data arbitrer (hex). Menggantikan `extraMessage`; opsional, tanpa
	// nilai default yang wajib dibawa setiap transaksi.
	data: Joi.string().optional(),
	sign: Joi.object({
		r: Joi.string().required(),
		s: Joi.string().required(),
		v: Joi.number().required(),
	}).required(),
	// Turunan `ecrecover` atas tanda tangan. WAJIB ada pada transaksi yang
	// diterima node (diisi `decodeTx` / `signTransaction`) — karena itu
	// `required()`, bukan `optional()`. Validator lain (`validateAddresses`,
	// `validateAddressLengths`, ...) memakai non-null assertion dan
	// mengandalkan jaminan dari baris ini.
	from: Joi.string().required(),
	// Turunan `sha256(payload bertipe)` — selalu ada pada transaksi yang
	// diterima node (diisi `decodeTx`), dan diverifikasi ulang oleh
	// `validateTransactionSignature`.
	txHash: Joi.string().required(),
	// Fee: bilangan bulat aman, ≥ 0, dan ≤ plafon suplai. `.unsafe(true)`
	// yang dulu ada di sini berarti `fee: -1` dan `fee: 1e20` sama-sama lolos
	// lapisan struktur — keduanya ditangkap terlambat (atau sama sekali tidak)
	// di lapisan berikutnya.
	fee: Joi.number().required().min(0).max(MAX_SUPPLY_NEXU),
	nonce: Joi.number().required().integer().min(0),
	// Tx lama `0x02` tidak membawa field ini. Tx Ethereum `0x03` wajib
	// membawa `raw` — dipakai ulang untuk txHash, fee, dan verifikasi tanda
	// tangan, jadi tidak boleh diisi sembarangan.
	type: Joi.number().integer().valid(TX_TYPE, ETH_TX_TYPE).optional(),
	raw: Joi.string()
		.pattern(/^0x([0-9a-f]{2})+$/)
		.when('type', {
			is: ETH_TX_TYPE,
			then: Joi.required(),
			otherwise: Joi.forbidden(),
		}),
})
