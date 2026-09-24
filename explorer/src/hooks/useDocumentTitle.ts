import { useEffect } from 'react'

/** Suffix judul tab — semua halaman berbagi ini. */
const SUFFIX = 'NexChain Explorer'

/**
 * Set `document.title` per halaman.
 *
 * Tanpa ini semua tab identik ("NexChain Explorer") sehingga back-history
 * dan task switcher tidak berguna saat user membuka beberapa blok sekaligus.
 * Panggil dari tiap halaman dengan judul spesifiknya, atau tanpa argumen
 * untuk kembali ke judul default.
 */
export function useDocumentTitle(title?: string): void {
	useEffect(() => {
		document.title = title ? `${title} · ${SUFFIX}` : SUFFIX
	}, [title])
}
