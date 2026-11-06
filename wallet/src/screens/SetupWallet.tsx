import { useEffect, useMemo, useState } from 'react'
import { validateMnemonic } from 'src/crypto/validateMnemonic'
import { errorMessage } from '../lib/format'
import { cryptoWorker } from '../hooks/useCryptoWorker'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { MnemonicGrid } from '../ui/MnemonicGrid'
import { MnemonicSkeleton } from '../ui/MnemonicSkeleton'
import { Notice } from '../ui/Notice'
import type { Screen } from '../types'

interface SetupProps {
	mode: 'create' | 'import'
	onDone: (mnemonic: string, passphrase: string) => Promise<void>
	go: (screen: Screen) => void
}

/** Fase layar. Mode `import` tidak pernah menyentuh `preparing`. */
type PreparePhase = 'preparing' | 'ready' | 'error'

/**
 * Jeda baca per langkah status.
 *
 * Kerja sebenarnya (entropi → 12 kata → checksum + alamat) selesai jauh lebih
 * cepat dari ini di perangkat modern, jadi angka ini murni supaya tiga baris
 * status sempat terbaca — bukan simulasi proses. Kalau perangkatnya lambat,
 * langkah terakhir menunggu kerja nyata (lihat `await work`), bukan timer.
 */
const STEP_DWELL_MS = 220

/**
 * Lantai waktu tampil sebelum frasa muncul.
 *
 * Fungsinya mencegah KEDIPAN: tanpa ini skeleton hanya sempat tampil satu
 * frame lalu hilang, hasilnya lebih buruk daripada tidak ada animasi sama
 * sekali. Bukan untuk membuat proses terasa berat.
 */
const MIN_DWELL_MS = 800

const PREPARE_STEPS = [
	'Mengambil entropi acak',
	'Menyusun 12 kata',
	'Memeriksa checksum & alamat',
] as const

const passphraseScore = (value: string): number => {
	let score = 0
	if (value.length >= 8) score += 1
	if (value.length >= 12) score += 1
	if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1
	if (/\d/.test(value) || /[^\w\s]/.test(value)) score += 1
	return score
}

const passphraseLabel = (score: number): string => {
	if (score <= 0) return 'Terlalu pendek'
	if (score === 1) return 'Perlu diperkuat'
	if (score === 2) return 'Cukup'
	if (score === 3) return 'Kuat'
	return 'Sangat kuat'
}

export const SetupWallet = ({
	mode,
	onDone,
	go,
}: SetupProps): React.JSX.Element => {
	const [phase, setPhase] = useState<PreparePhase>(
		mode === 'create' ? 'preparing' : 'ready',
	)
	const [doneSteps, setDoneSteps] = useState(0)
	const [address, setAddress] = useState('')
	const [prepError, setPrepError] = useState('')
	/** Naik = minta penyiapan ulang setelah gagal. */
	const [attempt, setAttempt] = useState(0)

	const [mnemonic, setMnemonic] = useState('')
	const [passphrase, setPassphrase] = useState('')
	const [confirm, setConfirm] = useState('')
	// Frasa dibuat terlihat supaya bisa dicatat; tombol sembunyikan hanya
	// menyamarkan tampilan saat ada orang lain melihat layar.
	const [reveal, setReveal] = useState(true)
	const [backedUp, setBackedUp] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const score = useMemo(() => passphraseScore(passphrase), [passphrase])

	/**
	 * Satu-satunya sumber pembuatan frasa.
	 *
	 * Dulu frasa dibuat di dalam render (`useState(() => genRandomMnemonic())`)
	 * DAN di `useEffect([mode])`, sehingga satu kunjungan bisa membuat sampai
	 * empat frasa di StrictMode — tak terlihat, tapi memboroskan entropi dan
	 * mematikan setiap kemungkinan animasi. Sekarang: satu effect, satu
	 * permintaan, dengan penanda `cancelled` supaya hasil yang datang
	 * terlambat tidak menimpa layar yang sudah ditinggalkan.
	 */
	useEffect(() => {
		setBackedUp(false)
		setReveal(true)
		setMnemonic('')
		setAddress('')
		setError('')
		setPrepError('')

		if (mode !== 'create') {
			setPhase('ready')
			setDoneSteps(0)
			return
		}

		let cancelled = false
		const startedAt = Date.now()
		const sleep = (ms: number): Promise<void> =>
			new Promise((resolve) => {
				setTimeout(resolve, ms)
			})

		setPhase('preparing')
		setDoneSteps(0)

		// Dijalankan SEKARANG, bukan setelah centang pertama: kalau worker
		// lambat, kerja nyatanya sudah berjalan sementara mata membaca
		// langkah satu per satu.
		const work = cryptoWorker.prepareWallet()
		// Penolakan bisa tiba sebelum `await` di bawah; tanpa ini ia menjadi
		// unhandled rejection di konsol.
		work.catch(() => {})

		void (async () => {
			try {
				await sleep(STEP_DWELL_MS)
				if (cancelled) return
				setDoneSteps(1)
				await sleep(STEP_DWELL_MS)
				if (cancelled) return
				setDoneSteps(2)

				// Langkah 3 hanya dicentang setelah alamatnya benar-benar ada.
				const prepared = await work
				if (cancelled) return
				setDoneSteps(3)

				const remaining = MIN_DWELL_MS - (Date.now() - startedAt)
				if (remaining > 0) await sleep(remaining)
				if (cancelled) return

				setMnemonic(prepared.mnemonic)
				setAddress(prepared.address)
				setPhase('ready')
			} catch (error_) {
				if (cancelled) return
				setPrepError(errorMessage(error_))
				setPhase('error')
			}
		})()

		return () => {
			cancelled = true
		}
	}, [mode, attempt])

	const submit = async (event?: React.FormEvent): Promise<void> => {
		event?.preventDefault()
		if (phase !== 'ready') return
		setError('')
		const phrase = mnemonic.trim().replace(/\s+/g, ' ')

		try {
			validateMnemonic(phrase)
		} catch {
			setError('Mnemonic tidak valid — periksa urutan dan ejaan kata.')
			return
		}
		if (mode === 'create' && !backedUp) {
			setError('Konfirmasi bahwa mnemonic sudah dicatat sebelum melanjutkan.')
			return
		}
		if (passphrase.length < 8) {
			setError('Passphrase minimal 8 karakter.')
			return
		}
		if (passphrase !== confirm) {
			setError('Konfirmasi passphrase tidak cocok.')
			return
		}

		setBusy(true)
		try {
			await onDone(phrase, passphrase)
		} catch (error_) {
			setError(errorMessage(error_))
		} finally {
			setBusy(false)
		}
	}

	const ready = phase === 'ready'

	return (
		<form
			className="auth-card auth-card--wide"
			onSubmit={(event) => void submit(event)}
		>
			<input
				className="sr-only"
				aria-hidden="true"
				tabIndex={-1}
				autoComplete="username"
				name="username"
				value="nexchain-wallet"
				readOnly
			/>
			<div className="stepper" aria-label="Wallet setup progress">
				<div className="stepper__step stepper__step--active">
					<span>1</span> Frasa pemulihan
				</div>
				<div className="stepper__line" />
				<div
					className={`stepper__step ${passphrase.length >= 8 ? 'stepper__step--active' : ''}`}
				>
					<span>2</span> Lindungi wallet
				</div>
			</div>

			<div className="page-heading page-heading--compact">
				<p className="eyebrow">
					{mode === 'create' ? 'WALLET BARU' : 'PULIHKAN WALLET'}
				</p>
				<h1>
					{mode === 'create' ? 'Buat wallet Anda' : 'Pulihkan wallet Anda'}
				</h1>
				<p>
					{mode === 'create'
						? 'Mulai dengan frasa pemulihan yang dibuat secara lokal di browser ini.'
						: 'Masukkan frasa pemulihan 12 kata yang pernah Anda simpan.'}
				</p>
			</div>

			{phase === 'preparing' ? (
				<div className="field">
					<div className="field-heading">
						<span className="label">Frasa pemulihan Anda</span>
						<span className="field-badge">menyiapkan</span>
					</div>
					<MnemonicSkeleton done={doneSteps} steps={PREPARE_STEPS} />
				</div>
			) : phase === 'error' ? (
				<Notice variant="error">
					{`Gagal menyiapkan frasa pemulihan: ${prepError}`}
				</Notice>
			) : mode === 'create' ? (
				<div className="field mnemonic-enter">
					<div className="field-heading">
						<span className="label">Frasa pemulihan Anda</span>
						<span className="field-badge">12 kata</span>
					</div>
					<MnemonicGrid
						value={mnemonic}
						onChange={setMnemonic}
						readOnly
						masked={!reveal}
						label="Frasa pemulihan Anda"
					/>
					{address ? (
						<p className="mnemonic-address">
							<span>Alamat wallet</span>
							<code>{address}</code>
						</p>
					) : null}
					<div className="field-actions">
						<button
							type="button"
							className="button button--ghost button--sm"
							onClick={() => setReveal((value) => !value)}
						>
							<Icon
								name={reveal ? 'eyeOff' : 'eye'}
								size={15}
								aria-hidden="true"
							/>
							{reveal ? 'Sembunyikan frasa' : 'Tampilkan frasa'}
						</button>
						{/*
						 * Tombol salin SELALU ada, hanya mati sampai frasa dicadangkan.
						 * Dulu ia baru di-mount saat checkbox dicentang: baris aksi
						 * bertambah tinggi dan paragraf peringatan di bawahnya hilang
						 * pada frame yang sama, jadi seluruh blok melompat tepat saat
						 * pengguna menekan checkbox.
						 */}
						<CopyButton
							text={mnemonic}
							ariaLabel="Salin frasa pemulihan"
							variant="secondary"
							disabled={!backedUp}
						/>
					</div>
					<p className="input-hint">
						Clipboard bisa dibaca aplikasi lain. Salin hanya setelah Anda punya
						salinan offline.
					</p>
					<p id="mnemonic-help" className="input-hint">
						Catatan kata-kata ini secara berurutan. Ini satu-satunya cara
						memulihkan wallet ini.
					</p>
					<label
						className={`check-card ${backedUp ? 'check-card--checked' : ''}`}
					>
						<input
							type="checkbox"
							checked={backedUp}
							onChange={(event) => setBackedUp(event.target.checked)}
						/>
						<span>
							<strong>Saya sudah menyimpan frasa pemulihan</strong>
							<small>
								Simpan secara offline dan jangan pernah bagikan kepada siapa
								pun.
							</small>
						</span>
					</label>
				</div>
			) : (
				<div className="field">
					<span className="label">Frasa pemulihan</span>
					<MnemonicGrid value={mnemonic} onChange={setMnemonic} />
					<p className="input-hint">
						Ketik satu kata per kotak — saran kata muncul saat Anda mengetik.
						Tempel frasa utuh di kotak mana pun untuk mengisi semuanya
						sekaligus.
					</p>
				</div>
			)}

			{ready ? (
				<>
					<div className="form-divider" />
					<div className="form-grid form-grid--two">
						<div className="field">
							<label className="label" htmlFor="passphrase">
								Passphrase
							</label>
							<input
								id="passphrase"
								className="input"
								type="password"
								value={passphrase}
								autoComplete="new-password"
								placeholder="Minimal 8 karakter"
								onChange={(event) => setPassphrase(event.target.value)}
							/>
						</div>
						<div className="field">
							<label className="label" htmlFor="confirm">
								Ulangi passphrase
							</label>
							<input
								id="confirm"
								className="input"
								type="password"
								value={confirm}
								autoComplete="new-password"
								placeholder="Ulangi passphrase"
								onChange={(event) => setConfirm(event.target.value)}
							/>
						</div>
					</div>
					<div
						className="strength-meter"
						aria-label={`Kekuatan passphrase: ${passphraseLabel(score)}`}
					>
						<div className="strength-meter__track">
							<span
								className={`strength-meter__fill strength-meter__fill--${score}`}
							/>
						</div>
						<span>{passphraseLabel(score)}</span>
					</div>

					{error ? <Notice variant="error">{error}</Notice> : null}

					<div className="form-actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() => go('welcome')}
							disabled={busy}
						>
							Kembali
						</button>
						<button
							type="submit"
							className="button button--primary"
							disabled={busy}
						>
							{busy
								? 'Menyimpan wallet…'
								: mode === 'create'
									? 'Buat wallet'
									: 'Pulihkan wallet'}
							<Icon name="arrowUpRight" size={15} aria-hidden="true" />
						</button>
					</div>
				</>
			) : (
				/*
				 * Selama menyiapkan, form bawah sengaja disembunyikan: tidak ada
				 * yang bisa diisi sebelum frasanya ada, dan menampilkannya membuat
				 * tata letak melompat saat fase berganti. "Kembali" tetap hidup —
				 * membatalkan penyiapan tidak menghilangkan apa pun.
				 */
				<div className="form-actions">
					<button
						type="button"
						className="button button--ghost"
						onClick={() => go('welcome')}
					>
						Kembali
					</button>
					{phase === 'error' ? (
						<button
							type="button"
							className="button button--primary"
							onClick={() => setAttempt((value) => value + 1)}
						>
							Coba lagi
							<Icon name="arrowUpRight" size={15} aria-hidden="true" />
						</button>
					) : null}
				</div>
			)}
		</form>
	)
}
