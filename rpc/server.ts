// Muat .env dari working directory (no-op bila variabel sudah diset di shell /
// systemd). Bun juga auto-memuat .env secara native — import ini membuatnya
// tetap jalan bila suatu saat dipakai lewat Node biasa.
import 'dotenv/config'
// import { openDb } from 'nexchain/db/openDb'
import { app } from './app/app'
import { getBlockByHeight } from 'nexchain/block/query/onChain/block/getBlockByHeight'
import { createGenesisBlock } from 'nexchain/block/createGenesisBlock'
import { logToConsole } from 'logging/logging'

// Port bisa dioverride lewat env (NEX_RPC_PORT / PORT) — dulu hardcode 8000.
const PORT = Number(
	process.env.NEX_RPC_PORT ?? process.env.PORT ?? 8000,
)

// Host bind bisa dioverride lewat env (RPC_BIND_HOST) — lihat .env.example.
// Default 127.0.0.1 (secure by default): RPC hanya terjangkau dari mesin ini;
// di VPS cukup di-proxy Nginx Proxy Manager (port 80/443) tanpa membuka 8000.
// Set RPC_BIND_HOST=0.0.0.0 bila miner/explorer ada di mesin lain (LAN dev).
const HOST = process.env.RPC_BIND_HOST ?? '127.0.0.1'

// Jalankan server
app.listen(PORT, HOST, async () => {
	// await openDb()
	// Auto-genesis: rantai kosong → buat genesis sekali saat boot, supaya node
	// langsung siap membagi job mining (nex_getWork) tanpa langkah manual
	// terpisah. Rantai ada → no-op.
	const genesis = await getBlockByHeight(0, 'json').catch(() => undefined)
	if (!genesis) {
		const created = await createGenesisBlock().catch((error: unknown) => {
			console.error(
				'Genesis creation failed:',
				error instanceof Error ? error.message : error,
			)
			return undefined
		})
		if (created) logToConsole('Genesis block created on startup.')
	}
	console.log(`RPC server running on http://${HOST}:${PORT}/rpc`)
})
