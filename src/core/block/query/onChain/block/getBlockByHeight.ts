import { Block } from 'src/core/block/blockModel'
import { getBlockByHash } from './getBlockByHash'
import { rocksState } from 'src/core/state/db/state'

export const getBlockByHeight = async (
	height: number,
): Promise<Block | undefined> => {
	// `level` v10 mengembalikan `undefined` untuk key yang tidak ada (tidak
	// melempar), jadi `undefined` di sini berarti blok pada height itu
	// BENAR-BENAR tidak ada.
	//
	// Dulu seluruh fungsi dibungkus try/catch yang menelan setiap error lalu
	// mengembalikan `undefined` — sehingga "gagal membaca" tidak bisa
	// dibedakan dari "tidak ada". Akibatnya node yang gagal membaca genesis
	// menyimpulkan rantainya kosong dan menulis genesis baru DI ATAS data yang
	// sebenarnya ada. Error asli sekarang dibiarkan naik (fail-closed).
	const blockHash = await rocksState.get(`blockHeight:${height}`, {
		fillCache: true,
	})
	if (!blockHash) return undefined
	return await getBlockByHash(blockHash as string)
}
