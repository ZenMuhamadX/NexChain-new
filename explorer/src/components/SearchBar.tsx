import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { classifyQuery } from '../lib/classify'

const RECENT_KEY = 'nex:recent-search'
const RECENT_LIMIT = 5

/** Label singkat untuk chip deteksi tipe query. */
const KIND_LABEL: Record<string, string> = {
	height: 'Block height',
	address: 'Address',
	hash: 'Hash',
	unknown: '',
}

function readRecent(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_KEY)
		const list = raw ? (JSON.parse(raw) as unknown) : null
		return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []
	} catch {
		return []
	}
}

function writeRecent(list: string[]) {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(list))
	} catch {
		// localStorage diblokir — fitur non-kritis
	}
}

/**
 * Search bar global — klasifikasi input lalu navigate. Resolusi hash
 * (blok vs transaksi) dilakukan halaman /search/:query, supaya link
 * hasil pencarian bisa dibagikan dan tetap bekerja.
 *
 * Perbaikan dari audit:
 * - query TIDAK dihapus saat submit, dan di-echo kembali saat rute
 *   /search/:query aktif → user selalu tahu apa yang dicari.
 * - chip deteksi tipe tampil SEBELUM submit, jadi user tahu input-nya
 *   dikenali sebagai height / address / hash.
 * - 5 pencarian terakhir disimpan dan muncul saat input difokuskan.
 * - shortcut "/" memfokuskan search dari mana saja.
 */
export function SearchBar() {
	const [query, setQuery] = useState('')
	const [recent, setRecent] = useState<string[]>(() => readRecent())
	const [focused, setFocused] = useState(false)
	const navigate = useNavigate()
	const location = useLocation()
	const inputRef = useRef<HTMLInputElement>(null)

	// echo nilai dari rute /search/:query supaya input tidak pernah kosong
	// padahal halaman hasil menampilkan query tersebut.
	useEffect(() => {
		const prefix = '/search/'
		if (!location.pathname.startsWith(prefix)) return
		const fromRoute = decodeURIComponent(location.pathname.slice(prefix.length))
		setQuery(fromRoute)
	}, [location.pathname])

	// shortcut "/" — lewati kalau user sedang mengetik di kontrol lain.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
			const target = event.target as HTMLElement | null
			const tag = target?.tagName.toLowerCase()
			if (
				target?.isContentEditable ||
				tag === 'input' ||
				tag === 'textarea' ||
				tag === 'select'
			) {
				return
			}
			event.preventDefault()
			inputRef.current?.focus()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [])

	const trimmed = query.trim()
	const kind = useMemo(() => classifyQuery(trimmed), [trimmed])
	const kindLabel = trimmed ? KIND_LABEL[kind] : ''

	const go = (value: string) => {
		const target = value.trim()
		if (!target) return
		const next = [target, ...recent.filter((item) => item !== target)].slice(
			0,
			RECENT_LIMIT,
		)
		setRecent(next)
		writeRecent(next)
		setFocused(false)
		inputRef.current?.blur()
		navigate(`/search/${encodeURIComponent(target)}`)
	}

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		go(trimmed)
	}

	const showRecent = focused && trimmed === '' && recent.length > 0

	return (
		<form className="search" onSubmit={submit} role="search">
			<input
				ref={inputRef}
				className="search-input"
				type="search"
				placeholder="Block height, block/tx hash, or address — press / to focus"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				aria-label="Search the blockchain"
				aria-describedby={kindLabel ? 'search-kind' : undefined}
				spellCheck={false}
			/>
			{kindLabel ? (
				<span className="chip chip-accent" id="search-kind">
					{kindLabel}
				</span>
			) : null}
			<button
				className="btn btn-primary search-btn"
				type="submit"
				aria-label="Search the blockchain"
			>
				<svg
					aria-hidden="true"
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
				>
					<circle cx="11" cy="11" r="7" />
					<path d="m21 21-4.3-4.3" />
				</svg>
				<span className="sr-only">Search</span>
			</button>

			{showRecent ? (
				<div className="search-suggest">
					<p className="search-suggest-title">Recent searches</p>
					{recent.map((item) => (
						<button
							type="button"
							key={item}
							className="suggest-item"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => go(item)}
						>
							<span className="mono">{item}</span>
							<span className="chip">{KIND_LABEL[classifyQuery(item)] || 'query'}</span>
						</button>
					))}
					<button
						type="button"
						className="suggest-item"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							setRecent([])
							writeRecent([])
						}}
					>
						<span className="muted">Clear recent searches</span>
					</button>
				</div>
			) : null}
		</form>
	)
}
