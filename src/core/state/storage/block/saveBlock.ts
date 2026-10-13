/** @format */
import { Block } from 'src/core/block/blockModel'
import { rocksState } from 'src/core/state/db/state'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { prepareBlockState } from '../state/setState'
import { writeBlockHash } from './writeBlockHash'

/**
 * Simpan blok hasil commit — jalur tulis semua-atau-tidak-sama-sekali.
 *
 * ## Mengapa atomik (audit P1b #2)
 *
 * Sebelumnya jalur ini MEMISAHKAN tiga `put` bersambung:
 * `blockHash:<hash>` (DB blok) → `blockHeight:<n>` (DB state) →
 * `blockState` (DB state). Crash di antara put meninggalkan blok SETENGAH:
 * indeks height menunjuk hash yang badannya belum ada, atau `blockState`
 * sudah di blok baru sementara indeks height tertinggal — membohongi
 * pembaca (boot/`verifyChainIntegrity`) dengan rantai yang "ada" tetapi
 * tidak konsisten. Guard plafon suplai juga baru berjalan di put terakhir,
 * sehingga penolakan NORMAL pun menyisakan dua key yatim.
 *
 * ## Bentuk sekarang (urutan logika COMMIT tidak berubah: verifikasi dulu)
 *
 *   1. `prepareBlockState` — guard plafon suplai + proyeksi `totalIssued`,
 *      TANPA menulis apa pun (gagal-dulu; sama seperti guard lama di
 *      `setBlockState`, hanya dipindah mendahului SEMUA tulis);
 *   2. badan blok ke DB blok (`writeBlockHash`, sync) — DIDAHULUKAN dan
 *      dipaksa tahan-crash supaya badan sudah berada di disk sebelum
 *      state merujuknya;
 *   3. SATU `rocksState.batch` (sync) berisi `blockHeight:<n>` + `blockState`
 *      — pasangan yang paling berbahaya bila berjauahan kini tidak mungkin
 *      berjauahan: batch LevelDB atomik lewat WAL grup.
 *
 * ## Sisa jendela yang disadari (tidak bisa dihapus tanpa transaksi lintas-DB)
 *
 * `blockHash:` berada di LevelDB TERPISAH dari `blockHeight:`/`blockState`
 * (dua folder data) — satu batch tidak bisa menjangkau keduanya. Urutan di
 * atas memilih sisa jendela yang AMAN: crash setelah (2) sebelum (3)
 * menyisakan badan blok YATIM yang tidak direferensikan siapa pun (sampah
 * tak berbahaya; key yang sama ditulis ulang identik bila commit diulang).
 * Kebalikannya — state menyebut badan yang hilang — tidak mungkin terjadi
 * karena badan dipaksa sinkron lebih dulu.
 */
export const saveBlock = async (blockData: Block): Promise<boolean> => {
	try {
		const blockHash = blockData.block.header.hash
		const blockHeight = blockData.block.height

		// (1) Guard dulu, nol tulis.
		const blockState = await prepareBlockState(blockData)

		// (2) Badan blok — sync, sebelum apa pun merujuknya.
		await writeBlockHash(blockHash, blockData)

		// (3) Indeks height + pointer state — SATU batch atomik, sync.
		await rocksState.batch(
			[
				{ type: 'put', key: `blockHeight:${blockHeight}`, value: blockHash },
				{
					type: 'put',
					key: `blockState`,
					value: stringToHex(JSON.stringify(blockState)),
				},
			],
			{ sync: true },
		)
		return true
	} catch (error) {
		// Tangani error jika proses penyimpanan gagal
		console.error('Error saving block:', error)
		return false
	}
}
