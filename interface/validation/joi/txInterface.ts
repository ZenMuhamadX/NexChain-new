import Joi from 'joi'
import { MAX_SUPPLY_NEXU } from 'nexchain/nexucoin/constants'

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
	format: Joi.string().valid('nexu').required(),
	sender: Joi.string().required(),
	receiver: Joi.string().required(),
	// Flag kontrak DIHAPUS dari transaksi baru (fitur smart contract
	// dibuang) — tetap diterima (opsional) untuk data/klien lama.
	isSenderContract: Joi.boolean().optional(),
	isReceiverContract: Joi.boolean().optional(),
	sign: Joi.object({
		r: Joi.string().required(),
		s: Joi.string().required(),
		v: Joi.number().required(),
	}).required(),
	timestamp: Joi.number().required(),
	txHash: Joi.string().required(),
	// Fee: bilangan bulat aman, ≥ 0, dan ≤ plafon suplai. `.unsafe(true)`
	// yang dulu ada di sini berarti `fee: -1` dan `fee: 1e20` sama-sama lolos
	// lapisan struktur — keduanya ditangkap terlambat (atau sama sekali tidak)
	// di lapisan berikutnya.
	fee: Joi.number().required().min(0).max(MAX_SUPPLY_NEXU),
	nonce: Joi.number().required().integer().min(0),
	status: Joi.string().required(),
	isValid: Joi.boolean().required(),
	isPending: Joi.boolean().required(),
	extraMessage: Joi.string().optional(),
	hexInput: Joi.string().required(),
})
