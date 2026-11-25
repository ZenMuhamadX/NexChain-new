export const isValidAddress = (address: string): boolean =>
	/^NxC[0-9a-f]{40}$/.test(address)
