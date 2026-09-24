import { askQuestion } from 'client/inquirer/askQuestion'
import { runMiner } from 'client/miner/runMiner'
import { getMyWalletAddress } from 'account/myWalletAddress'
import { isValidAddress } from 'nexchain/transaction/utils/isValidAddress'

/**
 * CLI interaktif untuk menjalankan miner eksternal.
 *
 * Berbeda dengan versi lama yang memanggil `mineBlock` (loop PoW di dalam
 * proses node — RPC harus dimatikan saat mining), kini mining sepenuhnya
 * terjadi lewat `nex_getWork`/`nex_submitWork` ke node: proses ini hanya
 * klien HTTP penghitung PoW, sehingga node tetap melayani RPC 24/7.
 * Ctrl+C ditangani di dalam `runMiner` (berhenti rapi di antara chunk hash).
 */
export const CLIMining = async () => {
	// Default alamat dari wallet node bila ada (hanya baca file wallet).
	let defaultAddress = ''
	try {
		defaultAddress = getMyWalletAddress() ?? ''
	} catch {
		defaultAddress = ''
	}

	let address: string = await askQuestion({
		message: 'Enter your address (penerima hadiah blok)',
		name: 'address',
		type: 'input',
		description:
			'Miner eksternal: PoW dihitung di sini, node tetap melayani RPC.',
		default: defaultAddress || undefined,
	})

	while (!isValidAddress(address)) {
		console.log(`Alamat tidak valid (format NxC + 40 hex): "${address}"`)
		address = await askQuestion({
			message: 'Enter your address (penerima hadiah blok)',
			name: 'address',
			type: 'input',
			default: defaultAddress || undefined,
		})
	}

	console.log('Mining dimulai dengan alamat:', address)
	await runMiner(address)
}
