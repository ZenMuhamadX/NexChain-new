/**
 * Manajer sinkronisasi rantai P2P (getblocks / inv / getdata / block / tx).
 *
 * Empat tugas utama:
 *   1. MENGEJAR rantai peer: membangun block locator dari tip lokal lalu
 *      meminta blok yang belum kita punya (`getblocks` → `inv` → `getdata`).
 *   2. MELAYANI peer yang mengejar kita: menjawab `getblocks` dengan `inv`,
 *      dan `getdata` dengan badan blok / payload transaksi dari penyimpanan.
 *   3. MENYEBARLUKAN blok & transaksi yang baru diterima ke peer lain —
 *      dengan pengecualian pengirim dan tunduk pada broadcast gate, supaya
 *      tidak terjadi badai gossip memantul.
 *   4. MENANDAI status sinkronisasi ke modul netral
 *      `src/core/events/syncState.ts` supaya `nex_getWork` menahan mining
 *      selama rantai masih tertinggal (IBD). Latch `synced` hanya dipasang
 *      bila TERBUKTI dari data lokal (`hasBlock` atas tip yang diklaim peer)
 *      DAN tak ada peer siap lain yang lebih maju. Klaim peer hanya boleh
 *      MENAHAN gerbang, tak pernah membukanya. Katup pengaman waktu membuka
 *      mining dengan fase `assumed` yang masih boleh ditutup lagi.
 *
 * Semua akses rantai lewat adaptor `src/p2p/chain.ts` yang TIDAK melempar
 * untuk kasus "belum ada"; semua penulisan tetap lewat `connectBlock` /
 * `addTxToMempool`. Modul ini tidak pernah membiarkan janji async ditolak
 * tanpa tertangkap: tiap callback dibungkus `.catch` yang mencatat ke log.
 */
import { isBroadcastSuppressed, runSuppressed } from '../broadcastGate.js'
import { getBlockHashByHeight, hasBlock, tryGetBlockByHash } from '../chain.js'
import { forEachChunked } from '../scheduling.js'
import {
	type GetDataItem,
	type InvMessage,
	MAX_INV_BATCH,
	type P2PMessage,
} from '../protocol/messages.js'
import type { PeerState, SyncManager, SyncManagerOptions } from '../types.js'
import { getHistoryByTxHash } from 'src/core/block/query/onChain/Transaction/getHistoryByTxHash'
import { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { loadMempool } from 'src/core/state/storage/mempool/loadMempool'
import { addTxToMempool } from 'src/core/transaction/addTransactionToMempool'
import {
	getSyncStatus,
	markAssumed,
	markSynced,
	markSyncing,
	resetSyncState,
} from 'src/core/events/syncState'
import type { TxInterface } from 'src/types/transaction'
import { logToConsole } from 'src/logging/logging'

/** Pola hash 64 digit hex huruf kecil (konvensi wire SHA-256). */
const HEX64 = /^[0-9a-f]{64}$/

/** `stopHash` baku: 64 "0" — minta blok sampai awal rantai. */
const STOP_HASH = '0'.repeat(64)

/** Penjelasan error singkat untuk log. */
const formatError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Ambil hash dari objek blok mentah (`{ block: { header: { hash } } }`).
 *
 * Hanya mengembalikan nilai bila benar-benar 64 hex — bentuk lain diabaikan
 * daripada dipercaya, karena objek ini datang dari jaringan.
 */
const extractBlockHash = (raw: unknown): string | undefined => {
	if (!isRecord(raw)) return undefined
	if (!isRecord(raw.block)) return undefined
	const header = raw.block.header
	if (!isRecord(header)) return undefined
	const hash = header.hash
	return typeof hash === 'string' && HEX64.test(hash) ? hash : undefined
}

/**
 * Apakah transaksi sudah dieksekusi (ada di riwayat rantai).
 *
 * `getHistoryByTxHash` melempar bila key tidak ada — di sini "tidak ada"
 * sengaja dipetakan ke `false`, bukan dibiarkan menerobos.
 */
const isExecuted = async (txHash: string): Promise<boolean> => {
	try {
		await getHistoryByTxHash(txHash, 'json')
		return true
	} catch {
		return false
	}
}

/**
 * Bangun sinkronisasi P2P.
 *
 * Hasilnya adalah objek murni tanpa timer yang hidup sampai `start()` dipanggil
 * dan tanpa janji yang bocor — aman dipasang lewat jembatan bus di `node.ts`.
 */
export const createSyncManager = (options: SyncManagerOptions): SyncManager => {
	const { config, gateway, getLocalStatus, connectBlock } = options

	/** Timer interval sinkronisasi berkala (`undefined` bila belum start). */
	let timer: ReturnType<typeof setInterval> | undefined
	let reannounceTimer: ReturnType<typeof setInterval> | undefined

	/**
	 * Peer yang sedang kita tunggu balasan `inv`-nya atas `getblocks` kita,
	 * beserta waktu kirim (epoch-ms). Dipakai untuk dua hal:
	 *   1. Menghindari menumpuk `getblocks` ke peer yang sama.
	 *   2. Mengizinkan probe kedaluwarsa sehingga peer yang diam (socket tetap
	 *      hidup karena `ping`, tapi tak pernah menjawab `getblocks`) tidak
	 *      menyumbat pengejaran selamanya — lihat `isProbeBusy`.
	 */
	const awaitingInv = new Map<string, number>()

	/**
	 * Batas usia probe. Peer yang belum menjawab dalam rentang ini dianggap
	 * tidak lagi sibuk dan boleh diprobe ulang (atau dilewati ke peer lain).
	 * Sengaja lebih longgar dari interval sync.
	 */
	const PROBE_TTL_MS = Math.max(config.syncIntervalMs * 3, 15_000)

	/**
	 * Apakah peer ini masih menunggu balasan `getblocks` yang belum kedaluwarsa.
	 * `true` = jangan kirim probe baru ke peer ini dulu. Probe basi dibuang di
	 * sini juga (pembersihan malas).
	 */
	const isProbeBusy = (peerId: string, now: number): boolean => {
		const sentAt = awaitingInv.get(peerId)
		if (sentAt === undefined) return false
		if (now - sentAt >= PROBE_TTL_MS) {
			awaitingInv.delete(peerId)
			return false
		}
		return true
	}

	/** Timer katup pengaman fase syncing (`config.syncTimeoutMs`). */
	let syncTimer: ReturnType<typeof setTimeout> | undefined

	/**
	 * Kapan kemajuan nyata terakhir terjadi (blok berhasil di-commit). Katup
	 * pengaman mengukur sisa anggaran dari sini — BUKAN disegarkan oleh
	 * peristiwa non-kemajuan (peer menyambung, `inv` gossip). Kalau disegarkan
	 * oleh itu, peer yang berulang menyambung-lalu-putus atau mengirim `inv`
	 * sampah bisa menahan katup selamanya.
	 */
	let lastProgressAt = Date.now()

	const clearSyncTimer = (): void => {
		if (syncTimer === undefined) return
		clearTimeout(syncTimer)
		syncTimer = undefined
	}

	/**
	 * Pasang katup pengaman dengan SISA anggaran `syncTimeoutMs` sejak kemajuan
	 * terakhir. Bila habis sementara masih "syncing", buka mining lewat fase
	 * `assumed` (belum tervalidasi, masih bisa ditutup lagi bila muncul bukti
	 * rantai tertinggal).
	 */
	const armSyncTimer = (): void => {
		clearSyncTimer()
		const remaining = Math.max(
			0,
			config.syncTimeoutMs - (Date.now() - lastProgressAt),
		)
		syncTimer = setTimeout(() => {
			syncTimer = undefined
			if (!getSyncStatus().syncing) return
			void openByValve()
		}, remaining)
		// Jangan tahan proses Node/Bun hanya karena katup pengaman hidup.
		const handle: unknown = syncTimer
		if (
			typeof handle === 'object' &&
			handle !== null &&
			'unref' in handle &&
			typeof handle.unref === 'function'
		) {
			handle.unref()
		}
	}

	/**
	 * Katup pengaman terbuka: tak ada kemajuan selama batas waktu. Buka mining
	 * lewat fase `assumed` (BUKAN `synced`) supaya bila nanti terbukti kita
	 * memang tertinggal, gerbang bisa ditutup kembali (lihat `markAssumed`).
	 */
	const openByValve = async (): Promise<void> => {
		let localHeight: number | undefined
		try {
			localHeight = (await getLocalStatus()).bestHeight
		} catch {
			localHeight = undefined
		}
		logToConsole(
			`P2P: tak ada kemajuan sinkronisasi dalam ~${config.syncTimeoutMs} ms ` +
				`(tinggi lokal ${localHeight ?? '?'}) — mining dibuka sementara ` +
				`(fase "assumed"); akan ditahan lagi bila terbukti tertinggal`,
		)
		markAssumed({ localHeight })
	}

	/**
	 * Tandai "masih mengejar rantai", atau tinggalkan bila memang sudah aman.
	 *
	 * Aturan latch: dari fase `synced`, panggilan ini TIDAK menyalakan ulang
	 * gerbang — KECUALI `targetHeight` (klaim peer, biasanya dari handshake
	 * baru saat reconnect) benar-benar lebih tinggi dari tinggi lokal kita.
	 * Memakai klaim untuk MENAHAN gerbang selalu aman (kebalikannya yang
	 * berbahaya), jadi reconnect ke node yang jauh lebih maju menutup gerbang
	 * lagi alih-alih menambang di atas tip basi (kerja sia-sia + memicu reorg).
	 */
	const beginOrContinueSync = async (targetHeight?: number): Promise<void> => {
		const previous = getSyncStatus().phase
		let localHeight: number | undefined
		try {
			localHeight = (await getLocalStatus()).bestHeight
		} catch {
			// DB belum siap — biarkan meta apa adanya.
		}
		const peerClaimsAhead =
			targetHeight !== undefined && targetHeight > (localHeight ?? 0)
		if (previous === 'synced' && !peerClaimsAhead) return

		markSyncing({ localHeight, targetHeight })
		// Anggaran katup HANYA dimulai di `start()` dan disegarkan oleh kemajuan
		// nyata (`noteProgress`) — BUKAN di sini. Dengan begitu peer yang
		// berulang menyambung, atau mengirim `inv` sampah terus-menerus, tidak
		// bisa menunda katup selamanya (memakai sisa anggaran yang ada).
		if (syncTimer === undefined) armSyncTimer()
	}

	/**
	 * Catat kemajuan nyata (blok berhasil di-commit): perbarui tinggi lokal di
	 * meta dan segarkan anggaran katup pengaman. HANYA peristiwa inilah yang
	 * boleh memperpanjang anggaran — bukan peer menyambung atau `inv` gossip.
	 */
	const noteProgress = async (): Promise<void> => {
		lastProgressAt = Date.now()
		if (!getSyncStatus().syncing) return
		let localHeight: number | undefined
		try {
			localHeight = (await getLocalStatus()).bestHeight
		} catch {
			localHeight = undefined
		}
		markSyncing({ localHeight })
		armSyncTimer()
	}

	/**
	 * Kandidat "rantai sudah menyusul peer" — latch `synced` HANYA bila
	 * benar-benar terbukti dari data lokal:
	 *
	 *   a. Kita sungguh memiliki tip yang diklaim peer itu (`status.bestHash`
	 *      ada di penyimpanan kita). Klaim tinggi peer atau `inv` kosong saja
	 *      TIDAK cukup: peer bisa berbohong, dan `inv` kosong bisa datang dari
	 *      gossip blok lama.
	 *   b. Tidak ada peer siap lain yang mengklaim lebih tinggi dari kita.
	 *      Klaim peer hanya boleh MENAHAN gerbang; ini mencegah skenario
	 *      multi-seed (satu peer setara, satu jauh di depan) latch terlalu awal.
	 *
	 * Bila syarat tidak terpenuhi, fase tetap hidup dan katup pengaman menjadi
	 * jalan keluar terakhir.
	 */
	const notifyCaughtUp = async (peer: PeerState): Promise<void> => {
		let localHeight: number | undefined
		try {
			localHeight = (await getLocalStatus()).bestHeight
		} catch {
			localHeight = undefined
		}

		// (a) Validasi terhadap data lokal: kita harus benar-benar punya tip
		// yang diklaim peer ini.
		const claimedTip = peer.status?.bestHash
		if (typeof claimedTip !== 'string' || !HEX64.test(claimedTip)) return
		if (!(await hasBlock(claimedTip))) return

		// (b) Veto: ada peer siap lain yang mengklaim lebih tinggi dari kita.
		for (const candidate of gateway.readyPeers()) {
			if ((candidate.status?.bestHeight ?? 0) > (localHeight ?? 0)) return
		}

		clearSyncTimer()
		logToConsole(
			'P2P: rantai sudah menyusul peer (tervalidasi) — mining dibuka',
		)
		markSynced({ localHeight })
	}

	/**
	 * Block locator: tip lokal di indeks 0, lalu mundur sampai 10 height,
	 * ditambah hash genesis bila rentang mundur belum mencakup height 0.
	 * Hash yang `undefined` (belum ada / gagal dibaca) dilewati.
	 */
	const buildLocator = async (): Promise<string[]> => {
		const status = await getLocalStatus()
		const locator: string[] = [status.bestHash]
		for (
			let height = status.bestHeight - 1;
			height >= status.bestHeight - 10 && height >= 0;
			height--
		) {
			const hash = await getBlockHashByHeight(height)
			if (hash !== undefined) locator.push(hash)
		}
		if (status.bestHeight - 10 > 0) {
			const genesis = await getBlockHashByHeight(0)
			if (genesis !== undefined && !locator.includes(genesis)) {
				locator.push(genesis)
			}
		}
		return locator
	}

	/**
	 * Inti `requestSync`: pilih target lalu kirim `getblocks`.
	 * Melempar bila gagal — pemanggil WAJIB menangkap (lihat `requestSync`).
	 *
	 * Tinggi klaim peer (`status.bestHeight`) dipakai HANYA untuk memilih target
	 * terbaik — kita tidak mempercayainya. Kita tetap mengirim `getblocks` walau
	 * peer tampak setara/tertinggal, supaya balasannya (`inv` kosong vs berisi)
	 * bisa dipakai `handleInv` untuk memutuskan "sudah menyusul" berdasarkan
	 * data yang benar-benar kita miliki (`hasBlock`).
	 */
	const runRequestSync = async (peer?: PeerState): Promise<void> => {
		const ready = gateway.readyPeers()
		const now = Date.now()
		let target: PeerState | undefined

		// Peer yang diminta dipakai bila masih siap DAN tidak sedang menunggu
		// balasan probe yang belum kedaluwarsa.
		if (peer !== undefined) {
			const candidate = ready.find(
				(c) => c.connection.id === peer.connection.id,
			)
			if (
				candidate !== undefined &&
				!isProbeBusy(candidate.connection.id, now)
			) {
				target = candidate
			}
		}
		// Kalau tidak, ambil peer siap dengan tinggi klaim tertinggi yang tidak
		// sedang menunggu balasan probe. Melewati (bukan berhenti pada) peer
		// yang sibuk membuat peer lain tetap dicoba — satu peer diam tidak
		// menyumbat seluruh pengejaran.
		if (target === undefined) {
			for (const candidate of ready) {
				if (isProbeBusy(candidate.connection.id, now)) continue
				const height = candidate.status?.bestHeight ?? -1
				if (
					target === undefined ||
					height > (target.status?.bestHeight ?? -1)
				) {
					target = candidate
				}
			}
		}
		// Tidak ada peer siap & bebas — tidak ada yang perlu diminta sekarang.
		if (target === undefined) return

		const locator = await buildLocator()
		awaitingInv.set(target.connection.id, now)
		gateway.send(target.connection.id, {
			type: 'getblocks',
			locator,
			stopHash: STOP_HASH,
		})
	}

	/** Minta blok dari peer terbaik; tidak pernah melempar ke pemanggil. */
	const requestSync = (peer?: PeerState): void => {
		runRequestSync(peer).catch((error: unknown) => {
			logToConsole(`P2P: requestSync gagal — ${formatError(error)}`)
		})
	}

	/** Kirim inv untuk semua tx yang ada di mempool (re-announce). */
	const reannounceMempool = async (): Promise<void> => {
		const mempool = await loadMempool()
		if (mempool.length === 0) return
		const hashes: string[] = []
		for (const tx of mempool) {
			if (tx.txHash !== undefined) {
				hashes.push(tx.txHash)
				if (hashes.length >= MAX_INV_BATCH) break
			}
		}
		if (hashes.length === 0) return
		gateway.broadcast({ type: 'inv', kind: 'tx', hashes })
	}

	/**
	 * Peer selesai handshake: tandai "masih mengejar" (kecuali sudah synced)
	 * lalu probe peer ini dengan `getblocks`. Balasan `inv` kosong = kita sudah
	 * setara dengan peer ini (divalidasi `hasBlock`), sehingga `handleInv` bisa
	 * menutup fase syncing tanpa menunggu interval.
	 */
	const onPeerReady = (peer: PeerState): void => {
		beginOrContinueSync(peer.status?.bestHeight).catch((error: unknown) => {
			logToConsole(
				`P2P: onPeerReady gagal untuk ${peer.connection.id} — ` +
					`${formatError(error)}`,
			)
		})
		requestSync(peer)
		// Re-announce mempool yang masih ada untuk memberi tx ke peer baru
		reannounceMempool().catch((error: unknown) => {
			logToConsole(
				`P2P: reannounceMempool gagal untuk ${peer.connection.id} — ` +
					`${formatError(error)}`,
			)
		})
	}

	/**
	 * Jawab `getblocks`: titik temu = hash locator pertama yang kita punya,
	 * lalu kirim inv berisi blok SETELAHnya (maksimal `MAX_INV_BATCH`).
	 * Balasan kosong tetap valid — artinya peer sudah setara dengan kita.
	 */
	const handleGetBlocks = async (
		peer: PeerState,
		locator: string[],
	): Promise<void> => {
		let forkHeight = 0
		for (const hash of locator) {
			const block = await tryGetBlockByHash(hash)
			if (block !== undefined) {
				forkHeight = block.block.height
				break
			}
		}
		const status = await getLocalStatus()
		const last = Math.min(status.bestHeight, forkHeight + MAX_INV_BATCH)
		const heights: number[] = []
		for (let height = forkHeight + 1; height <= last; height++) {
			heights.push(height)
		}
		const hashes: string[] = []
		await forEachChunked(heights, config.serveChunkSize, async (height) => {
			const hash = await getBlockHashByHeight(height)
			if (hash === undefined) return false
			hashes.push(hash)
			return true
		})
		gateway.send(peer.connection.id, { type: 'inv', kind: 'block', hashes })
	}

	/** Tanggapi `inv`: minta badan item yang BELUM kita punya. */
	const handleInv = async (
		peer: PeerState,
		message: InvMessage,
	): Promise<void> => {
		if (message.kind === 'block') {
			// `inv` masuk dari peer ini: probe yang tertunda (bila ada) dianggap
			// terjawab — bersihkan agar tidak menyumbat probe berikutnya.
			awaitingInv.delete(peer.connection.id)
			const missingBlocks: string[] = []
			await forEachChunked(
				message.hashes,
				config.serveChunkSize,
				async (hash) => {
					if (missingBlocks.length >= MAX_INV_BATCH) return false
					if (!(await hasBlock(hash))) missingBlocks.push(hash)
					return true
				},
			)
			if (missingBlocks.length === 0) {
				// Tidak ada satu pun hash yang belum kita punya. `notifyCaughtUp`
				// sendiri yang memutuskan apakah ini bukti cukup (harus punya tip
				// peer + tak ada peer lain yang lebih maju) — bukan `inv` kosong
				// mentah, yang bisa datang dari gossip atau peer yang berbohong.
				await notifyCaughtUp(peer)
				return
			}
			// Masih ada yang tertinggal → pastikan fase syncing tetap hidup.
			// Klaim peer (bila ada) ikut dipakai agar reconnect ke node yang
			// jauh lebih maju menutup gerbang lagi.
			await beginOrContinueSync(peer.status?.bestHeight)
			gateway.send(peer.connection.id, {
				type: 'getdata',
				items: missingBlocks.map((hash): GetDataItem => ({
					kind: 'block',
					hash,
				})),
			})
			return
		}

		// inv transaksi: lewati yang sudah mengendap di mempool atau sudah
		// dieksekusi di rantai — cukup sekali minta, jangan diulang.
		const pending = new Set<string>()
		for (const tx of await loadMempool()) {
			if (tx.txHash !== undefined) pending.add(tx.txHash)
		}
		const missingTxs: string[] = []
		await forEachChunked(
			message.hashes,
			config.serveChunkSize,
			async (hash) => {
				if (missingTxs.length >= MAX_INV_BATCH) return false
				if (pending.has(hash)) return true
				if (await isExecuted(hash)) return true
				missingTxs.push(hash)
				return true
			},
		)
		if (missingTxs.length === 0) return
		gateway.send(peer.connection.id, {
			type: 'getdata',
			items: missingTxs.map((hash): GetDataItem => ({ kind: 'tx', hash })),
		})
	}

	/** Layani `getdata`: kirim badan blok / payload transaksi yang diminta. */
	const handleGetData = async (
		peer: PeerState,
		items: GetDataItem[],
	): Promise<void> => {
		let mempool: TxInterface[] | undefined
		await forEachChunked(
			items.slice(0, MAX_INV_BATCH),
			config.serveChunkSize,
			async (item) => {
				if (item.kind === 'block') {
					const block = await tryGetBlockByHash(item.hash)
					if (block !== undefined) {
						gateway.send(peer.connection.id, { type: 'block', block })
					}
					return true
				}
				if (mempool === undefined) mempool = await loadMempool()
				const entry = mempool.find((tx) => tx.txHash === item.hash)
				if (entry !== undefined) {
					gateway.send(peer.connection.id, {
						type: 'tx',
						payload: encodeTx(entry),
					})
				}
				return true
			},
		)
	}

	/**
	 * Terima blok: commit lewat `connectBlock`, lalu kejar rantai dan relai
	 * hashnya ke peer LAIN. Pelanggaran fatal mem-ban pengirim.
	 */
	const handleBlock = async (peer: PeerState, raw: unknown): Promise<void> => {
		const result = await connectBlock(raw)
		if (!result.ok) {
			if (result.fatal) {
				gateway.ban(
					peer.connection.remoteAddress,
					result.reason ?? 'pelanggaran protokol',
				)
			}
			// Penolakan non-fatal (mis. tembakan lintas karena race) diabaikan.
			return
		}
		logToConsole(`P2P: blok baru diterima dari peer ${peer.connection.id}`)
		// Kemajuan nyata: perbarui tinggi lokal + segarkan anggaran katup.
		await noteProgress()
		// Lanjut mengejar bila peer masih lebih maju dari kita.
		requestSync(peer)
		const hash = extractBlockHash(raw)
		if (hash !== undefined) {
			gateway.broadcast(
				{ type: 'inv', kind: 'block', hashes: [hash] },
				peer.connection.id,
			)
		}
	}

	/**
	 * Terima transaksi: decode (payload rusak diabaikan, non-fatal), masukkan
	 * mempool di bawah broadcast gate, lalu siarkan hashnya ke peer lain.
	 */
	const handleTx = async (peer: PeerState, payload: string): Promise<void> => {
		let tx: TxInterface
		try {
			tx = decodeTx(payload)
		} catch {
			// payload rusak: abaikan, non-fatal
			return
		}
		try {
			let accepted = false
			await runSuppressed(async () => {
				accepted = await addTxToMempool(tx)
			})
			if (accepted && tx.txHash !== undefined) {
				gateway.broadcast(
					{ type: 'inv', kind: 'tx', hashes: [tx.txHash] },
					peer.connection.id,
				)
			}
		} catch (error) {
			logToConsole(
				`P2P: gagal memproses tx dari ${peer.connection.id} — ` +
					`${formatError(error)}`,
			)
		}
	}

	/** Buang pesan ke penanganan yang sesuai (diskriminan `message.type`). */
	const handleMessage = async (
		peer: PeerState,
		message: P2PMessage,
	): Promise<void> => {
		switch (message.type) {
			case 'getblocks':
				await handleGetBlocks(peer, message.locator)
				break
			case 'inv':
				await handleInv(peer, message)
				break
			case 'getdata':
				await handleGetData(peer, message.items)
				break
			case 'block':
				await handleBlock(peer, message.block)
				break
			case 'tx':
				await handleTx(peer, message.payload)
				break
			default:
				// version / verack / ping / pong: urusan peer manager.
				break
		}
	}

	const onPeerMessage = (peer: PeerState, message: P2PMessage): void => {
		handleMessage(peer, message).catch((error: unknown) => {
			logToConsole(
				`P2P: gagal memproses '${message.type}' dari ${peer.connection.id} — ` +
					`${formatError(error)}`,
			)
		})
	}

	// Sync dijalankan ulang oleh `onPeerReady` dan interval — tidak ada
	// state sync yang harus dibersihkan di sini selain korelasi probe peer ini.
	const onPeerClosed = (peer: PeerState): void => {
		awaitingInv.delete(peer.connection.id)
	}

	const announceBlock = (blockHash: string): void => {
		// Item dari peer sudah disiarkan sendiri oleh penangan pesan masuk.
		if (isBroadcastSuppressed()) return
		gateway.broadcast({ type: 'inv', kind: 'block', hashes: [blockHash] })
	}

	const announceTx = (txHash: string): void => {
		if (isBroadcastSuppressed()) return
		gateway.broadcast({ type: 'inv', kind: 'tx', hashes: [txHash] })
	}

	const start = (): void => {
		if (timer !== undefined) return
		// Fase awal berdasarkan seed:
		//   - TANPA seed → tak ada siapa pun untuk dikejar; langsung "synced"
		//     supaya mining terbuka (kasus node bootstrap/penambang devnet).
		//   - ADA seed → mulai "syncing": jangan menambang sebelum benar-benar
		//     menyusul. Katup pengaman membukanya bila tak ada kemajuan.
		if (config.peers.length === 0) {
			markSynced()
		} else {
			// Ada seed: mulai "syncing" dengan anggaran katup penuh.
			lastProgressAt = Date.now()
			markSyncing()
			armSyncTimer()
			// Isi meta (tinggi lokal) supaya `nex_getSyncStatus` tidak
			// melaporkan 0 sejak awal; gerbang tetap lewat state, bukan meta.
			beginOrContinueSync().catch((error: unknown) => {
				logToConsole(
					`P2P: inisialisasi status sync gagal — ${formatError(error)}`,
				)
			})
		}
		timer = setInterval(() => requestSync(), config.syncIntervalMs)
		// Jangan tahan proses Node/Bun hanya karena timer sync masih hidup.
		const handle: unknown = timer
		if (
			typeof handle === 'object' &&
			handle !== null &&
			'unref' in handle &&
			typeof handle.unref === 'function'
		) {
			handle.unref()
		}
		// Re-announce mempool berkala (setiap 60s)
		reannounceTimer = setInterval(() => {
			reannounceMempool().catch((error: unknown) => {
				logToConsole(
					`P2P: reannounceMempool berkala gagal — ${formatError(error)}`,
				)
			})
		}, 60_000)
		if (typeof reannounceTimer.unref === 'function') reannounceTimer.unref()
	}

	const stop = (): void => {
		clearSyncTimer()
		// P2P mati → jangan tinggalkan gerbang IBD menyala selamanya (mis. bila
		// suatu saat fitur "matikan P2P saat runtime" ditambahkan).
		resetSyncState()
		if (timer !== undefined) {
			clearInterval(timer)
			timer = undefined
		}
		if (reannounceTimer !== undefined) {
			clearInterval(reannounceTimer)
			reannounceTimer = undefined
		}
	}

	return {
		start,
		stop,
		onPeerReady,
		onPeerMessage,
		onPeerClosed,
		announceBlock,
		announceTx,
		requestSync,
	}
}
