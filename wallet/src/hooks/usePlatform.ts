import { useSyncExternalStore } from 'react'
import { getPlatform } from '../lib/platform'
import type { PlatformBridge, PlatformState } from '../lib/platform'

/**
 * Status PWA + aksinya, dalam satu hook.
 *
 * Status (mode, penyimpanan, versi, update) datang dari store; aksinya
 * diteruskan dari jembatan yang sama supaya layar tidak perlu mengimpor
 * `register.ts` (modul yang hanya boleh ada di bundle web).
 */
export interface PlatformApi extends PlatformState {
	requestInstall: PlatformBridge['requestInstall']
	requestPersistence: PlatformBridge['requestPersistence']
	applyUpdate: PlatformBridge['applyUpdate']
}

/**
 * Berlangganan status aplikasi terpasang (PWA).
 *
 * `getPlatform()` mengembalikan objek yang SAMA sampai `installPlatform()`
 * dipanggil ulang, sehingga `subscribe`/`state` stabil dan React tidak
 * berputar. Di shell dev/desktop hasilnya snapshot tetap dengan
 * `supported: false` — layar tidak perlu tahu bedanya.
 */
export const usePlatform = (): PlatformApi => {
	const store = getPlatform()
	const state = useSyncExternalStore(store.subscribe, store.state, store.state)
	return {
		...state,
		requestInstall: store.requestInstall,
		requestPersistence: store.requestPersistence,
		applyUpdate: store.applyUpdate,
	}
}
