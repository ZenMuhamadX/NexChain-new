export const isValidAddress = (address: string): boolean =>
	address.startsWith('NxC') && address.length === 43
