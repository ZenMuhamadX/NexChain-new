import { Block } from 'src/core/block/blockModel'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { processTransact } from 'src/core/transaction/processTransaction'
import {
	beginWriteBuffer,
	bufferStateLeaves,
	bufferStateMap,
	discardWriteBuffer,
	flushWriteBuffer,
	isAccountStateKey,
} from 'src/core/state/journal/writeBuffer'
import { rocksState } from 'src/core/state/db/state'
import { currentHeight } from 'src/core/state/journal/store'
import { computeStateRoot, EMPTY_STATE_ROOT } from 'src/core/state/root'

export interface StateReplayResult {
	ok: boolean
	/** Tinggi blok yang gagal, atau tip bila ok. */
	height: number
	/** Root hasil replay pada tinggi terakhir yang diproses. */
	root: string
	reason?: string
}

/**
 * Bangun ulang state dari genesis di write-buffer (mode `replay`: state mulai
 * KOSONG, nol tulis ke DB, mempool tidak disentuh) dan bandingkan `stateRoot`
 * setiap blok dengan header.
 *
 * Inilah satu-satunya cara mendeteksi state yang diubah di luar eksekusi:
 * akumulator tidak menyimpan pohon, jadi buktinya adalah mengeksekusi ulang
 * rantai dan mencocokkan hasilnya dengan yang dikomit.
 *
 * `rebuild = true` menulis state hasil replay ke DB (`--rebuild-state`):
 * akun yang tidak dihasilkan replay dihapus, sisanya ditulis ulang. Dipakai
 * hanya setelah operator memastikan blok-nya memang benar.
 */
export const replayState = async (
	rebuild = false,
): Promise<StateReplayResult> => {
	const tip = await currentHeight()
	if (tip < 0) return { ok: true, height: -1, root: EMPTY_STATE_ROOT }

	let height = 0
	let root = EMPTY_STATE_ROOT
	beginWriteBuffer('replay')
	try {
		for (; height <= tip; height++) {
			const block = (await getBlockByHeight(height)) as Block | undefined
			if (!block) throw new Error(`blok height ${height} tidak ditemukan`)

			// Genesis tidak punya transisi state (hadiah 0, tanpa tx): root-nya
			// wajib root-kosong dan TIDAK dieksekusi — mengeksekusinya akan
			// membuat leaf yang tidak pernah ada di rantai.
			if (height === 0) {
				if (block.block.header.stateRoot !== EMPTY_STATE_ROOT) {
					throw new Error(
						`stateRoot genesis ${block.block.header.stateRoot} bukan root kosong ` +
							`${EMPTY_STATE_ROOT}`,
					)
				}
				continue
			}

			await processTransact(block.block.transactions, block.block)
			root = computeStateRoot(root, bufferStateLeaves())
			if (block.block.header.stateRoot !== root) {
				throw new Error(
					`stateRoot blok ${height} tidak cocok dengan header: ` +
						`header ${block.block.header.stateRoot}, replay ${root}`,
				)
			}
		}

		if (rebuild) {
			await writeReplayedState()
		} else {
			// Header hanya membuktikan RANTAI-nya konsisten, bukan bahwa DB
			// berisi state yang sama. Tanpa diff ini, saldo yang diedit tangan
			// lolos verifikasi (root dihitung dari eksekusi, bukan dari DB).
			const drift = await stateDrift()
			if (drift.length > 0) {
				throw new Error(
					`State DB tidak cocok dengan replay (header.stateRoot rantai valid): ` +
						drift.slice(0, 5).join('; ') +
						(drift.length > 5 ? ` (+${drift.length - 5} akun lagi)` : ''),
				)
			}
		}
		return { ok: true, height: tip, root }
	} catch (error) {
		return {
			ok: false,
			height,
			root,
			reason: error instanceof Error ? error.message : String(error),
		}
	} finally {
		discardWriteBuffer()
	}
}

/**
 * Selisih antara state TERSEIMPAN dan hasil replay: akun yang hilang, berlebih,
 * atau bernilai beda. Inilah yang menangkap state yang diubah di luar eksekusi.
 */
const stateDrift = async (): Promise<string[]> => {
	const replayed = bufferStateMap()
	const drift: string[] = []
	for await (const [rawKey, value] of rocksState.iterator()) {
		const key = String(rawKey)
		if (!isAccountStateKey(key)) continue
		const want = replayed.get(key)
		if (want === undefined) {
			drift.push(`akun ${key} ada di DB tetapi tidak dihasilkan rantai`)
		} else if (want !== String(value)) {
			drift.push(`akun ${key} nilainya berbeda dari replay`)
		}
		replayed.delete(key)
	}
	for (const key of replayed.keys()) drift.push(`akun ${key} hilang dari DB`)
	return drift
}

/**
 * Tulis state hasil replay ke DB. Akun yang ada di DB tetapi tidak dihasilkan
 * replay (sisa edit tangan / rantai lain) DIHAPUS, lalu seluruh leaf hasil
 * replay ditulis. Metadata `blockState`/`blockHeight:` tidak disentuh: tip
 * tidak berubah, hanya isi state yang diperbaiki.
 */
const writeReplayedState = async (): Promise<void> => {
	const keep = new Set(bufferStateMap().keys())
	const stale: Array<{ type: 'del'; key: string }> = []
	for await (const [key] of rocksState.iterator()) {
		const name = String(key)
		if (isAccountStateKey(name) && !keep.has(name)) {
			stale.push({ type: 'del', key: name })
		}
	}
	if (stale.length > 0) await rocksState.batch(stale as never, { sync: true })
	await flushWriteBuffer()
}
