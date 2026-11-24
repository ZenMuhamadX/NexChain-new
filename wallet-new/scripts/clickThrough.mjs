/**
 * R-35 click evidence for the wallet-new popup. Run through the Playwright
 * browser tool against `vite preview` on http://localhost:5184, with every RPC
 * stubbed in the browser.
 *
 * The function is the default export so the tool can call it with a page.
 */
export default async (page) => {
	const evidence = []
	const record = (label, ok, detail = '') =>
		evidence.push(
			`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` -> ${detail}` : ''}`,
		)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})

	const RECEIVER = `NxC${'a'.repeat(40)}`
	const TX_HASH = `TxC${'b'.repeat(64)}`
	const PENDING_HASH = `TxC${'d'.repeat(64)}`
	const EXPLORER = 'https://explorer.zuns.my.id'
	const SEND_PATH = 'M4 12h16M14 6l6 6-6 6'
	const RECEIVE_PATH = 'M20 12H4M10 6l-6 6 6 6'
	// Four confirmed rows across two pages of two, so Load more has work to do.
	const HISTORY = ['1', '2', '3', '4'].map((char, index) => ({
		txHash: `TxC${char.repeat(64)}`,
		amount: index + 1,
		incoming: index === 1,
	}))
	let rpcCalls = 0
	const activityPages = []
	const ACCOUNT = {
		address: '',
		balance: 500000000,
		transactionCount: 0,
		lastTransactionDate: null,
		nonce: 0,
	}

	await page.route('**/rpc', async (route) => {
		const request = JSON.parse(route.request().postData() || '{}')
		const params = request.params
		rpcCalls++
		let result
		switch (request.method) {
			case 'nex_getAccount':
				result = { ...ACCOUNT, address: String(params) }
				break
			case 'nex_getTransactionsByAddress': {
				const page = Number(params.page) || 1
				activityPages.push(page)
				const start = (page - 1) * 2
				result = {
					count: HISTORY.length,
					history: HISTORY.slice(start, start + 2).map((tx) => ({
						txHash: tx.txHash,
						amount: tx.amount,
						from: tx.incoming ? RECEIVER : String(params.address),
						receiver: tx.incoming ? String(params.address) : RECEIVER,
					})),
					page,
					pageSize: 2,
					totalPages: 2,
				}
				break
			}
			case 'nex_getPendingByAddress':
				result = [
					{
						txHash: PENDING_HASH,
						amount: 5,
						from: String(params),
						receiver: RECEIVER,
					},
				]
				break
			case 'nex_getNextNonce':
				result = 0
				break
			case 'nex_getBalance':
				result = '5 NXC'
				break
			case 'nex_sendRawTransaction':
				result = { status: true, txHash: TX_HASH }
				break
			case 'nex_authCheck':
				result = { status: true }
				break
			default:
				result = undefined
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
		})
	})

	await page.goto('http://localhost:5184/')
	await page.getByRole('button', { name: 'Create new wallet' }).waitFor()
	record('Welcome renders both entry actions', true)
	const brandLoaded = await page
		.locator('.brand-mark')
		.evaluate((img) => img.decode().then(() => img.naturalWidth > 0))
	record('Welcome uses the official blockchain logo', brandLoaded)

	await page.getByRole('button', { name: 'Create new wallet' }).click()
	await page.locator('.mnemonic-word strong').first().waitFor()
	const words = await page.locator('.mnemonic-word strong').allTextContents()
	const mnemonic = words.join(' ')
	record(
		'Setup shows the mnemonic',
		words.length === 12,
		`${words.length} words`,
	)

	await page.getByRole('checkbox').check()
	await page.locator('input[type="password"]').fill('clickthrough-pass-123')
	await page.getByRole('button', { name: 'Finish creating wallet' }).click()
	await page.locator('.balance-label').waitFor({ timeout: 45000 })
	record('Wallet opens on Home', true)

	await page.locator('.balance-value').waitFor({ timeout: 30000 })
	const balanceText = await page.locator('.balance-value').innerText()
	record('Balance renders from RPC', balanceText.includes('NXC'), balanceText)
	const hasIdb = await page.evaluate(() => Boolean(window.indexedDB))
	record('IndexedDB is available in the popup', hasIdb === true)
	const tickerLoaded = await page
		.locator('.asset-icon')
		.evaluate((img) => img.decode().then(() => img.naturalWidth > 0))
	record('Home token row uses the official NXC ticker', tickerLoaded)
	record(
		'Home shows a recent activity section',
		(await page.getByRole('heading', { name: 'Recent activity' }).count()) ===
			1,
	)
	const homeRows = await page.locator('.activity-row').count()
	record(
		'Recent activity is capped at five rows',
		homeRows > 0 && homeRows <= 5,
		`${homeRows} rows`,
	)
	const homeLinks = await page
		.locator('.section-recent .activity-explorer')
		.evaluateAll((els) =>
			els.map((el) => ({
				href: el.getAttribute('href'),
				target: el.getAttribute('target'),
				rel: el.getAttribute('rel'),
			})),
		)
	record(
		'Confirmed rows deep-link the tx hash in Explorer',
		homeLinks.some(
			(link) =>
				link.href === `${EXPLORER}/tx/TxC${'1'.repeat(64)}` &&
				link.target === '_blank' &&
				link.rel === 'noopener noreferrer',
		),
		JSON.stringify(homeLinks),
	)
	record(
		'Pending rows deep-link their txHash too',
		homeLinks.some(
			(link) =>
				link.href === `${EXPLORER}/tx/TxC${'d'.repeat(64)}` &&
				link.target === '_blank' &&
				link.rel === 'noopener noreferrer',
		),
	)
	const activityGlyphs = await page
		.locator('.activity-row .activity-icon svg path')
		.evaluateAll((els) =>
			els.map((el) => ({
				incoming: el.closest('.activity-icon').classList.contains('is-in'),
				d: el.getAttribute('d'),
			})),
		)
	record(
		'Activity uses right and left arrows',
		activityGlyphs.some((glyph) => !glyph.incoming && glyph.d === SEND_PATH) &&
			activityGlyphs.some(
				(glyph) => glyph.incoming && glyph.d === RECEIVE_PATH,
			),
		JSON.stringify(activityGlyphs),
	)

	const tileSizes = await page
		.locator('.tile-icon svg')
		.evaluateAll((els) => els.map((el) => el.getAttribute('width')))
	record(
		'Action tile icons are 24px',
		tileSizes.length === 2 && tileSizes.every((size) => size === '24'),
		tileSizes.join(','),
	)
	const qrRects = await page
		.locator('.action-tile[aria-label="Receive NXC"] svg rect')
		.count()
	record('Receive tile uses a QR glyph', qrRects >= 4, `${qrRects} rects`)
	record(
		'Home has no top-right reload button',
		(await page.getByLabel('Reload balance').count()) === 0,
	)

	await page.getByRole('button', { name: 'Receive NXC' }).click()
	await page.locator('.receive-address').waitFor()
	const receiveAddress = await page.locator('.receive-address').innerText()
	record('Receive view shows an NxC address', receiveAddress.startsWith('NxC'))
	const qrLoaded = await page
		.locator('.qr-image')
		.evaluate((img) => img.decode().then(() => img.naturalWidth > 0))
	record('Receive QR renders for the wallet address', qrLoaded)
	const heading = await page.locator('.receive-header h2').innerText()
	record(
		'Receive header follows the reference',
		heading === 'Receiving Address',
		heading,
	)
	const qrBox = await page.locator('.qr-card').boundingBox()
	record(
		'QR card is 180px square',
		Math.abs((qrBox?.width ?? 0) - 180) < 0.1 &&
			Math.abs((qrBox?.height ?? 0) - 180) < 0.1,
		JSON.stringify(qrBox),
	)
	const addressSize = await page
		.locator('.receive-address')
		.evaluate((el) => getComputedStyle(el).fontSize)
	record('Receive address renders at 15px', addressSize === '15px', addressSize)
	const slide = await page
		.locator('.receive-screen')
		.evaluate((el) => getComputedStyle(el).animationName)
	record('Receive view slides up', slide === 'sheet-up', slide)
	await page.keyboard.press('Escape')
	await page.waitForFunction(
		() => {
			const el = document.querySelector('.receive-screen')
			return el !== null && getComputedStyle(el).animationName === 'sheet-down'
		},
		null,
		{ timeout: 2000 },
	)
	record(
		'Receive slides down before closing',
		(await page.locator('.receive-screen').count()) === 1,
	)
	await page.locator('.receive-address').waitFor({ state: 'detached' })
	record('Escape closes the receive view', true)

	await page.getByRole('button', { name: 'Send NXC' }).click()
	const frameTops = []
	for (let index = 0; index < 8; index++) {
		frameTops.push(
			await page.evaluate(() => document.querySelector('.frame').scrollTop),
		)
		await page.waitForTimeout(35)
	}
	record(
		'Opening Send does not scroll the frame',
		frameTops.every((top) => top === 0),
		frameTops.join(','),
	)
	await page.locator('input[placeholder="NxC..."]').fill(RECEIVER)
	await page.locator('input[inputmode="decimal"]').fill('0.01')
	const suffix = await page.locator('.amount-wrap .input-suffix').innerText()
	record('Amount field carries the NXC suffix', suffix === 'NXC', suffix)
	await page.getByRole('button', { name: 'Review transaction' }).click()
	await page.locator('.receipt').waitFor({ timeout: 30000 })
	const receiptAmount = await page.locator('.receipt-amount').innerText()
	record(
		'Receipt leads with the amount and unit',
		receiptAmount.includes('NXC'),
		receiptAmount,
	)
	const feeText = await page.locator('.receipt-fee .receipt-value').innerText()
	record('Receipt shows the automatic fee', feeText.includes('NXC'), feeText)
	await page.getByRole('button', { name: 'Sign and send' }).click()
	await page.getByText('Transaction sent.').waitFor({ timeout: 30000 })
	const sentHash = await page.locator('.done-view p').innerText()
	record('Success view shows the txHash', sentHash === TX_HASH, sentHash)
	const successLink = await page
		.locator('.done-view .text-button')
		.evaluate((el) => ({
			href: el.getAttribute('href'),
			target: el.getAttribute('target'),
			text: el.textContent,
		}))
	record(
		'Success view opens the submitted txHash in Explorer',
		successLink.href === `${EXPLORER}/tx/${TX_HASH}` &&
			successLink.target === '_blank' &&
			successLink.text.includes('View in Explorer'),
		JSON.stringify(successLink),
	)
	const strokes = await page.locator('.done-mark svg path').evaluateAll((els) =>
		els.map((el) => {
			const style = getComputedStyle(el)
			return {
				name: style.animationName,
				delay: parseFloat(style.animationDelay),
				duration: parseFloat(style.animationDuration),
				dash: parseFloat(style.strokeDasharray),
			}
		}),
	)
	record(
		'Success check draws two strokes one after the other',
		strokes.length === 2 &&
			strokes.every(
				(stroke) =>
					stroke.name === 'draw-check' &&
					stroke.dash === 1 &&
					stroke.duration > 0,
			) &&
			strokes[0].delay < strokes[1].delay,
		JSON.stringify(strokes),
	)
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll('.done-mark svg path')].length === 2 &&
			[...document.querySelectorAll('.done-mark svg path')].every(
				(el) => parseFloat(getComputedStyle(el).strokeDashoffset) === 0,
			),
		null,
		{ timeout: 3000 },
	)
	record('Both check strokes finish fully drawn', true)
	await page.getByRole('button', { name: 'Done' }).click()
	await page.waitForFunction(
		() => {
			const el = document.querySelector('.sheet')
			return el !== null && getComputedStyle(el).animationName === 'sheet-down'
		},
		null,
		{ timeout: 2000 },
	)
	record(
		'Done slides the send sheet down from the success view',
		(await page.locator('.done-view').count()) === 1,
	)
	await page.locator('.sheet').waitFor({ state: 'detached' })
	record('Done closes the send sheet after the slide', true)

	await page.getByRole('button', { name: 'History' }).click()
	const navBg = await page
		.locator('.nav-bar')
		.evaluate((el) => getComputedStyle(el).backgroundColor)
	record('Wallet canvas is pure black', navBg === 'rgb(0, 0, 0)', navBg)
	const activeBg = await page
		.locator('.nav-item.is-active')
		.evaluate((el) => getComputedStyle(el).backgroundColor)
	record(
		'Active tab has no purple pill',
		activeBg === 'rgba(0, 0, 0, 0)',
		activeBg,
	)
	const activeIcon = await page
		.locator('.nav-item.is-active .nav-glyph')
		.evaluate((el) => getComputedStyle(el).color)
	record(
		'Active tab icon is solid purple',
		activeIcon === 'rgb(143, 127, 245)',
		activeIcon,
	)
	const glyphBox = await page
		.locator('.nav-item.is-active .nav-glyph')
		.boundingBox()
	record(
		'Nav icon is 24px',
		Math.abs((glyphBox?.width ?? 0) - 24) < 0.1 &&
			Math.abs((glyphBox?.height ?? 0) - 24) < 0.1,
		JSON.stringify(glyphBox),
	)
	const clockSpin = await page
		.locator('.nav-item.is-active .clock-hands')
		.evaluate((el) => getComputedStyle(el).animationName)
	record(
		'History hands tick once on selection',
		clockSpin === 'clock-tick',
		clockSpin,
	)
	await page.getByRole('heading', { name: 'Activity' }).waitFor()
	const reload = page.getByRole('button', { name: 'Reload activity' })
	record(
		'Activity uses a refresh icon',
		(await reload.locator('.refresh-wheel').count()) === 1,
	)
	await reload.click()
	await page.waitForFunction(
		() => {
			const el = document.querySelector(
				'button[aria-label="Reload activity"] .refresh-spin',
			)
			return el !== null && getComputedStyle(el).animationName === 'gear-spin'
		},
		null,
		{ timeout: 2000 },
	)
	record('Refresh icon spins once on press', true)
	await page.locator('.activity-row').first().waitFor({ timeout: 30000 })
	const firstPageRows = await page.locator('.activity-row').count()
	record(
		'History shows the first page',
		firstPageRows === 3,
		`${firstPageRows} rows`,
	)
	await page.getByRole('button', { name: 'Load more activity' }).click()
	await page.locator('.activity-row').nth(3).waitFor({ timeout: 15000 })
	const allRows = await page.locator('.activity-row').count()
	record('Load more appends the next page', allRows === 5, `${allRows} rows`)
	record(
		'Load more disappears on the last page',
		(await page.getByRole('button', { name: 'Load more activity' }).count()) ===
			0,
	)
	const pageCaption = await page.locator('.activity-count').innerText()
	record(
		'Page caption tracks the loaded page',
		pageCaption.includes('Page 2 of 2'),
		pageCaption,
	)
	record('Load more requests the next page', activityPages.at(-1) === 2)

	await page.getByRole('button', { name: 'Settings' }).click()
	const gearSpin = await page
		.locator('.nav-item.is-active .gear-wheel')
		.evaluate((el) => getComputedStyle(el).animationName)
	record(
		'Settings gear spins once on selection',
		gearSpin === 'gear-spin',
		gearSpin,
	)
	await page.getByRole('button', { name: 'Save RPC settings' }).waitFor()
	const urlValue = await page.locator('input[type="url"]').inputValue()
	record(
		'Settings shows the RPC URL',
		urlValue.includes('localhost:8000'),
		urlValue,
	)
	await page.getByRole('button', { name: 'Save RPC settings' }).click()
	await page
		.getByText('Settings saved and the node responded.')
		.waitFor({ timeout: 30000 })
	record('Save settings calls the authCheck stub', true)
	await page
		.locator('input[placeholder="https://explorer.zuns.my.id"]')
		.fill('https://explorer.example.test')
	await page.getByRole('button', { name: 'Save explorer URL' }).click()
	await page.getByText('Explorer URL saved.').waitFor({ timeout: 30000 })
	record('Settings saves the explorer URL', true)

	const rpcBeforeReveal = rpcCalls
	await page.getByRole('button', { name: 'Show Seed phrase' }).click()
	await page
		.locator('.secret-confirm input[type="password"]')
		.fill('wrong-passphrase')
	await page.getByRole('button', { name: 'Reveal Seed phrase' }).click()
	await page.locator('.secret-confirm .field-error').waitFor({ timeout: 30000 })
	record('Wrong passphrase is rejected', true)
	await page
		.locator('.secret-confirm input[type="password"]')
		.fill('clickthrough-pass-123')
	await page.getByRole('button', { name: 'Reveal Seed phrase' }).click()
	await page.locator('.secret-value').waitFor({ timeout: 30000 })
	const seed = (await page.locator('.secret-value').innerText()).trim()
	record(
		'Seed phrase reveals the created 12 words',
		seed === mnemonic && seed.split(/\s+/).length === 12,
		`${seed.split(/\s+/).length} words`,
	)
	record('Reveal makes no RPC calls', rpcCalls === rpcBeforeReveal)
	await page.getByRole('button', { name: 'Hide Seed phrase' }).click()
	record(
		'Hide removes the seed phrase',
		(await page.locator('.secret-value').count()) === 0,
	)
	await page.getByRole('button', { name: 'Show Private key' }).click()
	await page
		.locator('.secret-confirm input[type="password"]')
		.fill('clickthrough-pass-123')
	await page.getByRole('button', { name: 'Reveal Private key' }).click()
	await page.locator('.secret-value').waitFor({ timeout: 30000 })
	const privateKey = (await page.locator('.secret-value').innerText()).trim()
	record(
		'Private key reveals 64 hex characters',
		/^[0-9a-f]{64}$/.test(privateKey),
		`${privateKey.length} chars`,
	)
	await page.getByRole('button', { name: 'Hide Private key' }).click()

	await page.getByRole('button', { name: 'Home' }).click()
	await page.waitForFunction(
		() => {
			const el = document.querySelector('.nav-item.is-active .home-filled')
			return el !== null && getComputedStyle(el).opacity === '1'
		},
		null,
		{ timeout: 3000 },
	)
	record('Home icon fills in on selection', true)
	const overriddenHref = await page
		.locator('.section-recent .activity-explorer')
		.first()
		.getAttribute('href')
	record(
		'Explorer links follow the Settings override',
		Boolean(overriddenHref?.startsWith('https://explorer.example.test/')),
		String(overriddenHref),
	)

	record('No console errors', errors.length === 0, errors.join(' | '))
	return { evidence }
}
