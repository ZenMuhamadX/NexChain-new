// Muat .env dari working directory (no-op bila variabel sudah diset di shell /
// systemd). Bun juga auto-memuat .env secara native — import ini membuatnya
// tetap jalan bila suatu saat dipakai lewat Node biasa.
import 'dotenv/config'
// import { openDb } from 'src/core/state/db/openDb'
import { app } from 'src/rpc/app/app'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { getGenesisBlock, GENESIS_HASH } from 'src/core/block/genesis'
import { CHAIN_ID } from 'src/crypto/chainId'
import { Block } from 'src/core/block/blockModel'
import { putAccount } from 'src/wallet/balance/putAccount'
import { saveBlock } from 'src/core/state/storage/block/saveBlock'
import { logToConsole } from 'src/logging/logging'
import { assertUnitConstants } from 'src/core/token/constants'
import { DATA_DIR } from 'src/core/state/db/dataDir'

// Verifikasi konstanta satuan SEBELUM menyentuh apa pun.
//
// Gagal = `NEXU_PER_NXC` / `MAX_SUPPLY_NXC` sudah diubah jadi nilai yang
// tidak aman untuk `number` (plafon di atas 90.071.992 NXC, atau desimal
// tidak konsisten). Kondisi itu akan membuat aritmetika saldo membulatkan
// nilai SECARA DIAM-DIAM — tidak ada error di titik lain yang menangkapnya.
// Lebih baik node menolak boot daripada menambang di atas state yang salah.
assertUnitConstants()

// Port bisa dioverride lewat env (NEX_RPC_PORT / PORT) — dulu hardcode 8000.
const PORT = Number(process.env.NEX_RPC_PORT ?? process.env.PORT ?? 8000)

// Host bind bisa dioverride lewat env (RPC_BIND_HOST) — lihat .env.example.
// Default 127.0.0.1 (secure by default): RPC hanya terjangkau dari mesin ini;
// di VPS cukup di-proxy Nginx Proxy Manager (port 80/443) tanpa membuka 8000.
// Set RPC_BIND_HOST=0.0.0.0 bila miner/explorer ada di mesin lain (LAN dev).
const HOST = process.env.RPC_BIND_HOST as string || '0.0.0.0'

// Jalankan server
app.listen(PORT, HOST, async () => {
	// await openDb()
	// Tampilkan lokasi data saat boot: operator harus bisa tahu di mana rantai
	// disimpan tanpa harus membaca kode (lihat src/core/state/db/dataDir.ts).
	logToConsole(`Data dir: ${DATA_DIR}`)

	// Auto-genesis (standar Bitcoin — hardcoded di kode):
	//   - rantai kosong → tulis blok genesis KONSTANTA (coinbase ke burned
	//     address; TANPA wallet node, TANPA langkah manual);
	//   - rantai ada → verifikasi hash genesis == konstanta kode. Beda
	//     berarti data bukan milik jaringan ini (anti-fork / tamper) →
	//     node menolak start supaya mining tidak di atas rantai yang salah.
	//
	// FAIL-CLOSED: error BACA harus menghentikan node, bukan diperlakukan
	// sebagai "rantai kosong". Kalau error dianggap kosong, cabang di bawah
	// akan menulis genesis baru ke direktori yang sama dan MENIMPA rantai yang
	// sebenarnya ada. Itu pernah terjadi: DB yang gagal dibaca (mis. setelah
	// proses berhenti di tengah) membuat rantai lama tertimpa tanpa peringatan.
	let genesis: Block | undefined
	try {
		genesis = (await getBlockByHeight(0, 'json')) as Block | undefined
	} catch (error) {
		console.error(
			`Gagal membaca genesis dari "${DATA_DIR}" — node berhenti supaya tidak ` +
				`menimpa data yang ada. Penyebab: ${error instanceof Error ? error.message : error}`,
		)
		process.exit(1)
	}

	if (!genesis) {
		try {
			const block = getGenesisBlock()
			const receiver = block.block.coinbaseTransaction.receiver
			await putAccount(receiver, {
				address: receiver,
				balance: block.block.coinbaseTransaction.amount,
				transactionCount: 1,
				isContract: false,
				lastTransactionDate: block.block.metadata!.created_at,
				nonce: 0,
			})
			// saveBlock MENANGKAP error lalu membalikkan `false` — tanpa cek
			// ini, gagal menulis genesis (termasuk penolakan plafon suplai di
			// `setBlockState`) tetap dianggap sukses dan node mulai di atas
			// rantai yang tidak ada.
			if (!(await saveBlock(block))) {
				throw new Error('saveBlock gagal menulis blok genesis')
			}
			logToConsole('Genesis block created on startup (hardcoded).')
		} catch (error) {
			console.error(
				'Genesis creation failed:',
				error instanceof Error ? error.message : error,
			)
			process.exit(1)
		}
	} else if (
		genesis.block.header.hash !== GENESIS_HASH ||
		genesis.block.chainId !== CHAIN_ID
	) {
		console.error(
			`Genesis mismatch: data hash ${genesis.block.header.hash} chainId ${genesis.block.chainId} != ` +
				`konstanta ${GENESIS_HASH} / ${CHAIN_ID} — data bukan milik jaringan ini. ` +
				`Reset direktori data "${DATA_DIR}" atau periksa NEX_CHAIN_ID.`,
		)
		process.exit(1)
	} else {
		logToConsole(
			`Genesis verified (hash cocok konstanta ${GENESIS_HASH.slice(0, 16)}…).`,
		)
	}

	console.log(`RPC server running on http://${HOST}:${PORT}/rpc`)
})