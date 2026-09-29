/**
 * CryptoProgress — pill progres kecil di pojok kanan-bawah.
 *
 * Muncul OTOMATIS selama operasi PBKDF2 (enkripsi/dekripsi vault) berjalan,
 * menampilkan persentase dari dalam iterasi (lihat `deriveAesKey` →
 * `cryptoProgress.ts`), lalu sembunyi sendiri saat selesai.
 *
 * Kenapa ini ada: PBKDF2 ratusan ribu iterasi bisa makan detik di HP —
 * tanpa umpan balik layar terasa "freeze". Crypto tetap berjalan di Web
 * Worker (UI thread tidak block); pill ini menerjemahkan waktu tunggu
 * jadi angka yang bergerak.
 *
 * Posisi fixed + pointer-events none: tidak pernah menutupi tombol.
 */
import { useEffect, useRef, useState } from 'react'
import { subscribeCryptoProgress } from '@/lib/cryptoProgress'

/** Label per operasi worker; fallback untuk tipe tak dikenal. */
const LABELS: Record<string, string> = {
	DECRYPT_SECRET: 'Membuka kunci…',
	ENCRYPT_SECRET: 'Mengunci vault…',
}

/** Tidak ada event baru sekian lama → anggap operasi bermasalah, sembunyi. */
const STALE_HIDE_MS = 6_000
/** Tampil sejenak di 100% sebelum hilang (penutup visual). */
const DONE_FLASH_MS = 450

export const CryptoProgress = (): React.JSX.Element | null => {
	const [view, setView] = useState<{ phase: string; pct: number } | null>(null)
	const lastEventRef = useRef(0)
	const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		const unsubscribe = subscribeCryptoProgress((event) => {
			lastEventRef.current = Date.now()
			if (doneTimerRef.current) {
				clearTimeout(doneTimerRef.current)
				doneTimerRef.current = null
			}

			if (event.fraction >= 1) {
				// Selesai: hanya flash bila pill memang sedang tampil
				// (menahan pill agar tidak kedip sesaat untuk op yang sangat cepat).
				setView((v) => (v ? { phase: event.phase, pct: 100 } : null))
				doneTimerRef.current = setTimeout(() => setView(null), DONE_FLASH_MS)
				return
			}

			setView({
				phase: event.phase,
				pct: Math.min(99, Math.max(0, Math.round(event.fraction * 100))),
			})
		})

		// Jaring pengaman: worker crash / request hilang → jangan biarkan
		// pill nyangkut selamanya. setView(null) saat sudah null = no-op.
		const watchdog = setInterval(() => {
			if (Date.now() - lastEventRef.current > STALE_HIDE_MS) setView(null)
		}, 1_000)

		return () => {
			unsubscribe()
			clearInterval(watchdog)
			if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
		}
	}, [])

	if (!view) return null

	const label = LABELS[view.phase] ?? 'Memproses…'

	return (
		<div className="crypto-progress" role="status" aria-live="polite">
			<div className="crypto-progress__row">
				<span className="spinner spinner--sm" aria-hidden="true" />
				<span className="crypto-progress__label">{label}</span>
				<span className="crypto-progress__pct">{view.pct}%</span>
			</div>
			<div className="crypto-progress__track">
				<div
					className="crypto-progress__bar"
					style={{ width: `${view.pct}%` }}
				/>
			</div>
		</div>
	)
}
