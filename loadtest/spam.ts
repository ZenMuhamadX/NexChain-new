import {
	AMOUNT_NEXU,
	FEE_NEXU,
	PENDING_PER_SENDER,
	checkNode,
	deriveWallet,
	errMsg,
	getAccount,
	getNextNonce,
	loadSeed,
	numEnv,
	readState,
	sleep,
	submit,
} from './fund'

const spam = async (): Promise<void> => {
	await checkNode()
	const state = readState()
	if (!state.funded) {
		throw new Error('Funding belum selesai — jalankan loadtest/fund.ts dulu.')
	}

	const targetTx = numEnv('NEX_LOAD_TX_COUNT', state.targetTx)
	const rounds = Math.ceil(targetTx / (state.senders.length * PENDING_PER_SENDER))
	const neededPerChild =
		rounds * PENDING_PER_SENDER * (AMOUNT_NEXU + FEE_NEXU) * 2
	if (neededPerChild > state.childFundNexu) {
		throw new Error(
			`Target ${targetTx} tx butuh ${neededPerChild} nexu/pengirim, ` +
				`tetapi funding baru ${state.childFundNexu}. Ulangi fund.ts ` +
				`dengan NEX_LOAD_TX_COUNT=${targetTx}.`,
		)
	}

	const wallet = deriveWallet(loadSeed())
	const senders = state.senders.map((address, i) => ({
		address,
		privateKey: wallet(i + 1).privateKey,
	}))
	const receivers = state.receivers
	const startNonce = new Map<string, number>()
	for (const sender of senders) {
		startNonce.set(sender.address, (await getAccount(sender.address)).nonce)
	}

	const pollMs = numEnv('NEX_LOAD_POLL_MS', 10000)
	const accepted: string[] = []
	let txIndex = 0
	let round = 0

	while (accepted.length < targetTx) {
		round++
		let roundSent = 0
		for (const sender of senders) {
			if (accepted.length >= targetTx) break
			const next = await getNextNonce(sender.address)
			const account = await getAccount(sender.address)
			const pending = next - account.nonce
			const take = Math.min(
				PENDING_PER_SENDER - pending,
				targetTx - accepted.length,
			)
			if (take <= 0) continue

			for (let i = 0; i < take; i++) {
				const hash = await submit(
					sender,
					next + i,
					receivers[txIndex % receivers.length],
					AMOUNT_NEXU,
					FEE_NEXU,
				)
				accepted.push(hash)
				txIndex++
				roundSent++
			}
		}

		console.log(
			`round ${round}: +${roundSent} tx → total ${accepted.length}/${targetTx}`,
		)
		if (accepted.length >= targetTx) break

		const before = await Promise.all(
			senders.map(async (sender) => (await getAccount(sender.address)).nonce),
		)
		for (;;) {
			await sleep(pollMs)
			const after = await Promise.all(
				senders.map(async (sender) => (await getAccount(sender.address)).nonce),
			)
			if (after.some((nonce, i) => nonce > before[i])) break
			console.log(
				'Menunggu blok berikutnya — jalankan miner di terminal Anda bila belum.',
			)
		}
	}

	for (;;) {
		const perSender = await Promise.all(
			senders.map(async (sender) => {
				const account = await getAccount(sender.address)
				return account.nonce - (startNonce.get(sender.address) ?? 0)
			}),
		)
		const confirmed = perSender.reduce((sum, value) => sum + value, 0)
		if (confirmed >= targetTx) {
			console.log(
				`Selesai: ${accepted.length} tx diterima, ${confirmed} tx ` +
					`terkonfirmasi dalam ${round} round.`,
			)
			console.log('Contoh txHash:', accepted.slice(0, 3).join(', '))
			return
		}
		console.log(
			`Menunggu konfirmasi: ${confirmed}/${targetTx} — ` +
				'jalankan miner di terminal Anda bila belum.',
		)
		await sleep(pollMs)
	}
}

spam().catch((error: unknown) => {
	console.error(errMsg(error))
	process.exitCode = 1
})
