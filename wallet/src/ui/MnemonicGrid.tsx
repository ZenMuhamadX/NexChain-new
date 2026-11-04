import { useId, useRef, useState } from 'react'
import {
	isKnownWord,
	mergeMnemonic,
	normalizeWord,
	suggestWords,
	splitMnemonic,
} from '../lib/mnemonicWords'

interface MnemonicGridProps {
	/** Frasa utuh, satu kata per kotak dipisah spasi. */
	value: string
	onChange: (next: string) => void
	/** Kata tidak bisa diubah (mode buat: frasa sudah dibuat). */
	readOnly?: boolean
	/** Samarkan isi kotak (mode buat sebelum "tampilkan"). */
	masked?: boolean
	/** Label grup untuk pembaca layar. */
	label?: string
}

/** Kotak minimal; 24 kotak muncul sendiri saat frasa 24 kata ditempel. */
const MIN_WORDS = 12

/**
 * Frasa pemulihan satu kata per kotak (gaya Phantom), dengan saran kata BIP39.
 *
 * KENAPA per kotak: satu textarea membuat salah urutan/kelebihan spasi tidak
 * terlihat, dan pengguna tidak tahu kata mana yang salah eja. Per kotak juga
 * memberi posisi yang jelas saat menempel frasa dari password manager.
 *
 * Tempel frasa utuh di kotak mana pun: dipecah otomatis (12 atau 24 kata).
 * Ketik beberapa huruf: muncul maksimal 6 saran; Enter/Tab menerima saran dan
 * pindah ke kotak berikutnya, Backspace di kotak kosong kembali ke sebelumnya.
 */
export const MnemonicGrid = ({
	value,
	onChange,
	readOnly = false,
	masked = false,
	label = 'Frasa pemulihan',
}: MnemonicGridProps): React.JSX.Element => {
	const words = value.split(' ')
	const cells = Array.from(
		{ length: Math.max(MIN_WORDS, words.length) },
		(_, index) => words[index] ?? '',
	)

	const inputs = useRef<Array<HTMLInputElement | null>>([])
	const [focused, setFocused] = useState(-1)
	const [active, setActive] = useState(0)
	const listId = useId()

	const suggestions =
		!readOnly && focused >= 0 ? suggestWords(cells[focused] ?? '') : []

	/** Spasi di ujung dibuang supaya nilai tidak menyimpan kotak kosong ekor. */
	const commit = (next: string[]): void => {
		onChange(next.join(' ').replace(/\s+$/, ''))
	}

	const focusCell = (index: number): void => {
		const target =
			inputs.current[Math.max(0, Math.min(index, cells.length - 1))]
		target?.focus()
		target?.select()
	}

	/**
	 * Satu kotak menerima ketikan atau tempelan. Tempelan frasa utuh (12/24
	 * kata) mengisi seluruh grid, berapa pun kotak yang sedang aktif.
	 */
	const write = (index: number, raw: string): void => {
		const pasted = splitMnemonic(raw)
		commit(
			mergeMnemonic(
				cells,
				index,
				pasted.length > 1 ? pasted : [normalizeWord(raw)],
			),
		)
	}

	const pick = (index: number, word: string): void => {
		const next = [...cells]
		next[index] = word
		commit(next)
		setFocused(-1)
		setActive(0)
		focusCell(index + 1)
	}

	return (
		<div className="mnemonic-grid" role="group" aria-label={label}>
			{cells.map((word, index) => {
				const showSuggestions = focused === index && suggestions.length > 0
				// Prefiks yang sedang diketik BUKAN salah eja selama saran terbuka.
				const invalid = word !== '' && !isKnownWord(word) && !showSuggestions
				const choice = suggestions[active] ?? suggestions[0]
				return (
					<div
						key={index}
						className={`mnemonic-grid__cell${invalid ? ' mnemonic-grid__cell--invalid' : ''}`}
					>
						<span className="mnemonic-grid__index" aria-hidden="true">
							{index + 1}
						</span>
						<input
							ref={(element) => {
								inputs.current[index] = element
							}}
							className="input mnemonic-grid__input"
							aria-label={`Kata ${index + 1}`}
							aria-invalid={invalid || undefined}
							aria-autocomplete={readOnly ? undefined : 'list'}
							aria-controls={showSuggestions ? listId : undefined}
							aria-activedescendant={
								showSuggestions ? `${listId}-${active}` : undefined
							}
							aria-expanded={readOnly ? undefined : showSuggestions}
							autoComplete="off"
							autoCapitalize="none"
							spellCheck={false}
							type={masked ? 'password' : 'text'}
							readOnly={readOnly}
							value={word}
							onChange={(event) => write(index, event.target.value)}
							onPaste={(event) => {
								const text = event.clipboardData.getData('text')
								if (!/\s/.test(text.trim())) return
								event.preventDefault()
								write(index, text)
							}}
							onFocus={() => {
								setFocused(index)
								setActive(0)
							}}
							onBlur={() => setFocused(-1)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault()
									if (choice) {
										pick(index, choice)
										return
									}
									focusCell(index + 1)
									return
								}
								if (event.key === 'Tab' && !event.shiftKey && choice) {
									event.preventDefault()
									pick(index, choice)
									return
								}
								if (event.key === 'ArrowDown' && suggestions.length > 0) {
									event.preventDefault()
									setActive((current) => (current + 1) % suggestions.length)
									return
								}
								if (event.key === 'ArrowUp' && suggestions.length > 0) {
									event.preventDefault()
									setActive(
										(current) =>
											(current - 1 + suggestions.length) % suggestions.length,
									)
									return
								}
								if (event.key === 'Escape') {
									setFocused(-1)
									return
								}
								if (event.key === 'Backspace' && word === '' && index > 0) {
									event.preventDefault()
									focusCell(index - 1)
								}
							}}
						/>
						{showSuggestions ? (
							<ul
								className="mnemonic-grid__suggestions"
								id={listId}
								role="listbox"
								aria-label={`Saran kata ${index + 1}`}
							>
								{suggestions.map((candidate, position) => (
									<li
										key={candidate}
										id={`${listId}-${position}`}
										role="option"
										aria-selected={position === active}
										className={`mnemonic-grid__option${position === active ? ' mnemonic-grid__option--active' : ''}`}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => pick(index, candidate)}
									>
										{candidate}
									</li>
								))}
							</ul>
						) : null}
					</div>
				)
			})}
		</div>
	)
}
