/**
 * MnemonicSkeleton — keadaan "frasa sedang disiapkan".
 *
 * KENAPA ada: sebelumnya frasa 12 kata lahir di dalam render `SetupWallet`,
 * jadi menekan "Buat wallet baru" langsung menampilkan kata-kata pada frame
 * yang sama dengan pergantian layar. Tidak ada jeda bagi mata, dan momen
 * paling penting di wallet terasa seperti template statis.
 *
 * KENAPA kerangka, bukan spinner: 12 kotak kosong memberi tahu BENTUK hasil
 * yang akan datang (frasa 12 kata, satu kata per kotak), dan karena memakai
 * kelas kotak yang sama dengan `MnemonicGrid`, tata letaknya tidak melompat
 * saat kata-kata masuk.
 *
 * KENAPA centang, bukan persentase: tiap langkah di sini benar-benar
 * dikerjakan worker (entropi → 12 kata → checksum + alamat). Angka persen
 * yang bergerak tanpa dasar akan menjadi klaim palsu tentang keamanan.
 */
interface MnemonicSkeletonProps {
	/** Jumlah langkah yang sudah selesai (0..steps.length). */
	done: number
	/** Label langkah, urut sesuai pengerjaannya. */
	steps: readonly string[]
}

/** Jumlah kotak yang ditampilkan; sama dengan frasa 12 kata. */
const CELLS = 12

export const MnemonicSkeleton = ({
	done,
	steps,
}: MnemonicSkeletonProps): React.JSX.Element => {
	const active = steps[Math.min(done, steps.length - 1)]
	const announcement =
		done < steps.length
			? `Menyiapkan frasa pemulihan. Langkah ${done + 1} dari ${steps.length}: ${active}.`
			: 'Frasa pemulihan siap.'

	return (
		<div className="mnemonic-skeleton" aria-busy="true">
			<div className="mnemonic-grid" aria-hidden="true">
				{Array.from({ length: CELLS }, (_, index) => (
					<div
						key={index}
						className="mnemonic-grid__cell mnemonic-skeleton__cell"
					>
						<span className="mnemonic-grid__index">{index + 1}</span>
						<input
							className="input mnemonic-grid__input mnemonic-skeleton__ghost"
							type="text"
							tabIndex={-1}
							disabled
							readOnly
							value=""
							aria-hidden="true"
						/>
						<span
							className="mnemonic-skeleton__bar"
							style={{ animationDelay: `${index * 60}ms` }}
						/>
					</div>
				))}
			</div>

			{/*
			 * Satu-satunya wilayah yang diumumkan pembaca layar. Daftar di
			 * bawahnya dekoratif (duplikat), jadi aria-hidden — kalau tidak,
			 * pembaca layar mengumumkan tiga baris sekaligus lalu diam
			 * sepanjang sisa proses.
			 */}
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<ul className="mnemonic-steps" aria-hidden="true">
				{steps.map((label, index) => {
					const state =
						index < done ? 'done' : index === done ? 'active' : 'idle'
					return (
						<li
							key={label}
							className={`mnemonic-steps__item mnemonic-steps__item--${state}`}
						>
							<span className="mnemonic-steps__dot" />
							<span>{label}</span>
						</li>
					)
				})}
			</ul>
		</div>
	)
}
