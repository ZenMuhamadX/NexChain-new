import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Search bar global — klasifikasi input lalu navigate. Resolusi hash
 * (blok vs transaksi) dilakukan halaman /search/:query, supaya link
 * hasil pencarian bisa dibagikan dan tetap bekerja.
 */
export function SearchBar() {
	const [query, setQuery] = useState('')
	const navigate = useNavigate()

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const value = query.trim()
		if (!value) return
		setQuery('')
		navigate(`/search/${encodeURIComponent(value)}`)
	}

	return (
		<form className="search" onSubmit={submit} role="search">
			<input
				className="search-input"
				type="search"
				placeholder="Search by block height, block/tx hash, or address (NxC…)"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				aria-label="Search the blockchain"
				spellCheck={false}
			/>
			<button className="btn btn-primary" type="submit">
				Search
			</button>
		</form>
	)
}
