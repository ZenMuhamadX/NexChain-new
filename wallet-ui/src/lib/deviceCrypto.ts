/**
 * Device capability detection for crypto operations.
 * Shared between main thread and worker contexts.
 */

// Detect mobile/low-end device for PBKDF2 iteration adjustment
export const isMobileOrLowEnd = (): boolean => {
	if (typeof navigator === 'undefined') return false
	const cores = navigator.hardwareConcurrency || 4
	const isMobileUA =
		/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
			navigator.userAgent,
		)
	const isTouch =
		typeof window !== 'undefined' &&
		('ontouchstart' in window || navigator.maxTouchPoints > 0)
	return isMobileUA || isTouch || cores <= 4
}

// Get PBKDF2 iterations based on device capability
// Mobile: 100k (OWASP minimum), Desktop: 310k (OWASP recommended)
export const getPbkdf2Iterations = (): number => {
	return isMobileOrLowEnd() ? 100_000 : 310_000
}

// Timeout based on operation type and device
export const getCryptoTimeout = (
	type: 'ENCRYPT' | 'DECRYPT' | 'DERIVE' | 'SIGN',
): number => {
	const isMobile = isMobileOrLowEnd()
	const baseTimeout = isMobile ? 120_000 : 60_000 // Mobile: 2 min, Desktop: 1 min
	if (type === 'ENCRYPT' || type === 'DECRYPT') {
		return isMobile ? 180_000 : 90_000 // PBKDF2: Mobile 3 min, Desktop 1.5 min
	}
	return baseTimeout
}
