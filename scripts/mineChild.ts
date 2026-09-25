/**
 * Entry point miner NON-INTERAKTIF untuk proses anak.
 *
 * Dipakai oleh `scripts/e2ePostRemoval.ts` (`spawn('bun', [ ... ])`) supaya
 * E2E bisa mem-blok tanpa prompt readline. `mineCLI.ts` interaktif (tanya
 * URL, alamat, konfirmasi) sehingga tidak bisa dipakai sebagai proses anak.
 *
 * Referensi `mine.ts` di E2E rusak sejak file itu dihapus pada commit
 * `a377d8a` — skrip ini menggantikannya.
 *
 * Pakai:
 *   bun run scripts/mineChild.ts <alamat-miner>
 *
 * Miner berjalan sampai prosesnya di-kill (E2E menghentikannya begitu
 * height naik). Semua submit diverifikasi ulang oleh node lewat
 * `nex_submitWork` — entry ini tidak memberi kekuatan apa pun pada miner.
 */
import { runMiner } from 'client/miner/runMiner'
import { isValidAddress } from 'nexchain/transaction/utils/isValidAddress'

const address = process.argv[2]

if (!address || !isValidAddress(address)) {
	console.error(
		`Alamat miner tidak valid: ${address ?? '(kosong)'}\n` +
			'pakai: bun run scripts/mineChild.ts <alamat-miner>',
	)
	process.exit(2)
}

await runMiner(address)
