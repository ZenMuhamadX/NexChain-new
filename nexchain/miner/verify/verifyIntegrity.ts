import { verifyStruct } from './module/verifyStruct'
import { verifyPow } from './module/verifyPow'
import { verifyHashLength } from './module/verifyHashLength'
import { verifyBlockHash } from './module/verifyBlockHash'
import { getBlockByHeight } from 'nexchain/block/query/onChain/block/getBlockByHeight'
import { Block } from 'nexchain/model/block/block'
import { verifyMerkleRoot } from './module/verifyMerkleRoot'
import { logToConsole } from 'logging/logging'
import { loggingErr } from 'logging/errorLog'
import { recoverSignerAddress } from 'sign/verifySIgnature'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { loadWallet } from 'account/utils/loadWallet'
import { generateKeysFromMnemonic } from 'key/genKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'key/genAddrFromPubKey'
import { ec as EC } from 'elliptic'
import { formatStr } from 'nexchain/lib/formatStr'

const ec = new EC('secp256k1')

/**
 * Daftar address yang sah menandatangani blok node ini, atau `undefined`
 * bila wallet tidak bisa dibaca (verifikasi signature jatuh ke "recovery
 * berhasil saja" — tetap menolak r/s kosong/rusak).
 *
 * Dua kandidat, keduanya membutuhkan materi kunci wallet sehingga celah
 * pemalsuan tetap tertutup:
 *   1. address wallet        — blok BARU, sesudah fix prefix "Nx" di
 *                              `createSignature` (address turunan dari key
 *                              ternormalisasi == address wallet);
 *   2. address key LEGACY    — semua blok LAMA ditandatangani oleh bug lama:
 *                              `createSignature` menerima private key berprefix
 *                              "Nx" dan elliptic mem-parse string itu menjadi
 *                              key BERBEDA (tanpa error). Karena parse-nya
 *                              deterministik, key cacat itu bisa diturunkan
 *                              ulang dari mnemonic yang sama — signature blok
 *                              lama tetap terverifikasi tanpa menerima key
 *                              sembarang pihak.
 */
const getExpectedBlockSigners = (): string[] | undefined => {
	const wallet = loadWallet()
	if (!wallet) return undefined

	const signers = new Set<string>()
	if (wallet.address) signers.add(wallet.address)

	try {
		const { privateKey } = generateKeysFromMnemonic(wallet.phrase) // "Nx..." + 64 hex
		// Sengaja TANPA normalisasi prefix — mereproduksi parse lama persis.
		const legacyKey = ec.keyFromPrivate(privateKey, 'hex')
		signers.add(
			generateAddressFromPublicKey(legacyKey.getPublic().encode('hex', true)),
		)
	} catch {
		// Derivasi legacy gagal → cukup address utama.
	}
	return signers.size > 0 ? Array.from(signers) : undefined
}

/**
 * Verifikasi integritas seluruh rantai, blok per blok, dari height 0.
 *
 * BUG (diperbaiki): seluruh hasil verifikasi dulu DIBUANG — tidak ada `await`
 * untuk `verifyStruct` (selalu lolos), boolean `verifyMerkleRoot`/`verifyPow`/
 * `verifyHashLength` tidak pernah dicek, `verifyBlockHash` yang melempar tidak
 * ditangkap (malah menghentikan proses tanpa pesan), dan `verifySignature`
 * dipanggil tanpa address yang diharapkan (verifikasi siklus tertutup yang
 * selalu true). Sekarang SEMUA hasil dievaluasi; kegagalan mencatat height,
 * hash, dan check apa yang gagal, lalu mengembalikan false (rantai dianggap
 * rusak → `nex_getWork` menolak membangun blok baru di atasnya).
 *
 * Pengecualian sadar:
 *   - height 0 (genesis): merkle root memakai sentinel 64 "0" dan tanpa
 *     transaksi (bootstrap, bukan hasil `createMerkleRoot`) — dicek lewat
 *     PoW + signature, bukan merkle;
 *   - difficulty memakai nilai TERSIMPAN di header (verifyPow) — data lama
 *     ber-skema lama tetap valid bila hashnya memenuhi syaratnya, dan
 *     konsistensi retarget dijamin saat penyusunan template, bukan di sini.
 */
export const verifyChainIntegrity = async (): Promise<boolean> => {
	logToConsole('Checking chain integrity...')
	const expectedSigners = getExpectedBlockSigners()
	let currentHeight = 0

	while (true) {
		const block = (await getBlockByHeight(currentHeight, 'json')) as
			Block | undefined
		if (!block) {
			logToConsole('Chain integrity verified.')
			return true
		}

		const hash = block.block.header.hash
		const failures: string[] = []

		if (!(await verifyStruct(block))) failures.push('structure')
		if (!verifyHashLength(hash)) failures.push('hash length')
		if (!verifyPow(block)) {
			failures.push(`pow (needs ${block.block.header.difficulty} bits)`)
		}
		try {
			verifyBlockHash(block)
		} catch {
			failures.push('block hash mismatch')
		}
		// Genesis: lihat catatan fungsi — merkle di-skip, sisanya tetap dicek.
		if (
			currentHeight > 0 &&
			!verifyMerkleRoot(block.block.transactions, block.block.merkleRoot)
		) {
			failures.push('merkle root')
		}

		const signer = recoverSignerAddress(hash, block.block.sign)
		if (signer === undefined) {
			failures.push('signature malformed')
		} else if (
			expectedSigners !== undefined &&
			!expectedSigners.includes(signer)
		) {
			failures.push(`signature from unexpected signer ${formatStr(signer)}`)
		}

		if (failures.length > 0) {
			loggingErr({
				message: `Block ${currentHeight} (${formatStr(hash)}) invalid: ${failures.join(', ')}`,
				stack: new Error().stack!,
				timestamp: generateTimestampz(),
				level: 'error',
				priority: 'high',
				context: 'verifyChainIntegrity',
				hint: 'Rantai rusak — perbaiki data atau re-genesis (hentikan node, hapus base/, jalankan ulang RPC untuk genesis baru). Mining ditolak sampai rantai valid.',
			})
			return false
		}

		currentHeight++
	}
}
