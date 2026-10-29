import { sha256 } from 'src/core/encoding/sha256'

/**
 * Root state KOSONG (belum ada akun). Nilai tetap karena `sha256('')` murni
 * deterministik — dipakai genesis dan sebagai titik awal setiap replay.
 */
export const EMPTY_STATE_ROOT = sha256('', 'hex') as string

/** Satu leaf akun: kunci (alamat) + nilai tersimpan (hex RLP). */
export interface StateLeaf {
	address: string
	value: string
}

/**
 * Akumulator state **chained-diff**: root hanya bergantung pada root
 * sebelumnya + leaf yang DISENTUH blok ini, diurut alamat:
 *
 *   root' = sha256(root ‖ sha256(alamat ‖ nilai))   (per leaf, urut alamat)
 *
 * Jadi biayanya O(jumlah akun yang berubah per blok), bukan O(semua akun),
 * dan tidak perlu menyimpan struktur pohon apa pun.
 *
 * Blok tanpa sentuhan state (mustahil di praktik: hadiah selalu mengkredit
 * penambang) mengembalikan root sebelumnya.
 *
 * shortcut: root = akumulator chained-diff, bukan trie; tak ada proof per
 * akun — upgrade ke SMT saat butuh light client.
 */
export const computeStateRoot = (
	prevRoot: string,
	leaves: StateLeaf[],
): string => {
	if (leaves.length === 0) return prevRoot
	const sorted = [...leaves].sort((a, b) =>
		a.address < b.address ? -1 : a.address > b.address ? 1 : 0,
	)
	let root = prevRoot
	for (const leaf of sorted) {
		const leafHash = sha256(`${leaf.address}${leaf.value}`, 'hex') as string
		root = sha256(`${root}${leafHash}`, 'hex') as string
	}
	return root
}
