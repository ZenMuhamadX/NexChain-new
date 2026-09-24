import { runMiner } from 'client/miner/runMiner'

/**
 * Jalur lokal: `bun run miner [alamat]` — menjalankan miner eksternal yang
 * menghitung PoW di proses INI dan mengirimnya ke node via JSON-RPC.
 *
 * Node TIDAK lagi meng-mine sendiri (dulu `mineBlock` menutup loop PoW di
 * dalam proses node → freeze event loop & RPC harus dimatikan). Dengan pola
 * ini node dan miner bisa jalan berdampingan; RPC tetap melayani selama
 * blok diproduksi ±30 detik sekali (difficulty adaptif).
 *
 * Alamat penerima hadiah: argumen CLI, atau fallback ke wallet node bila
 * tidak ada argumen (pemakaian lokal; miner di mesin lain wajib mengirim
 * alamatnya sendiri).
 */
const argAddress = process.argv[2]
const minerAddress = argAddress

if (!minerAddress) {
	console.error(
		'Usage: bun run miner <NxC...alamat-penerima-hadiah>\n' +
			'(atau sediakan wallet node di config/wallet.conf.json untuk fallback otomatis)',
	)
	process.exit(1)
}

runMiner(minerAddress)
