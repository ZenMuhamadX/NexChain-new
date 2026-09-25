import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from 'react'

export type TimeDisplayMode = 'age' | 'datetime'

const STORAGE_KEY = 'nex:time-display'

interface TimeDisplayContextValue {
	mode: TimeDisplayMode
	toggle: () => void
}

const TimeDisplayContext = createContext<TimeDisplayContextValue | null>(null)

function readMode(): TimeDisplayMode {
	try {
		return localStorage.getItem(STORAGE_KEY) === 'datetime' ? 'datetime' : 'age'
	} catch {
		return 'age'
	}
}

export function TimeDisplayProvider({ children }: { children: ReactNode }) {
	const [mode, setMode] = useState<TimeDisplayMode>(readMode)

	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, mode)
		} catch {
			// Penyimpanan browser diblokir; pilihan hanya bertahan selama sesi.
		}
	}, [mode])

	const toggle = () =>
		setMode((current) => (current === 'age' ? 'datetime' : 'age'))

	return (
		<TimeDisplayContext.Provider value={{ mode, toggle }}>
			{children}
		</TimeDisplayContext.Provider>
	)
}

export function useTimeDisplay(): TimeDisplayContextValue {
	const context = useContext(TimeDisplayContext)
	if (!context) {
		throw new Error('useTimeDisplay must be used within TimeDisplayProvider')
	}
	return context
}
