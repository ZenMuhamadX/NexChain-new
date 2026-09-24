import { useState } from 'react'
import { CopyButton } from './CopyButton'

/**
 * Inspector data mentah.
 *
 * Perbaikan bug interaksi: tombol copy dulu ditanam DI DALAM `<summary>`,
 * sehingga klik "Copy JSON" sekaligus membuka/menutup panel. `<summary>`
 * juga wajib anak langsung `<details>`, jadi membungkusnya dengan flex tidak
 * akan bekerja. Solusinya: kontrol penuh lewat React state, dengan
 * `aria-expanded` yang benar — tombol copy dan toggle kini independen.
 */
export function RawJson({
	data,
	summary = 'Raw JSON',
}: {
	data: unknown
	summary?: string
}) {
	const [open, setOpen] = useState(false)
	const json = JSON.stringify(data, null, 2)

	return (
		<div className="raw-json">
			<div className="raw-json-head">
				<button
					type="button"
					className="raw-json-toggle"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
				>
					<span className="raw-json-caret" aria-hidden="true">
						{open ? '▾' : '▸'}
					</span>
					{summary}
				</button>
				<span className="raw-json-action">
					<CopyButton value={json} label="Copy JSON" />
				</span>
			</div>
			{open ? <pre className="raw-json-body">{json}</pre> : null}
		</div>
	)
}
