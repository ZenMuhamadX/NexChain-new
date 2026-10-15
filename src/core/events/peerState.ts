/**
 * Status peer jaringan yang NETRAL (tanpa dependensi P2P).
 *
 * Modul ini murni: core membaca snapshot yang ditulis oleh `src/p2p/`.
 * Sama pola dengan `syncState.ts` untuk menegakkan arah dependensi
 * (core tidak pernah impor `src/p2p/**`).
 */
export interface BanEntry {
	address: string
	reason: string
	until: number
}

export interface PeerChainStatus {
	chainId: number
	genesisHash: string
	bestHeight: number
	bestHash: string
	listenPort?: number | undefined
}

export interface PeerInfo {
	id: string
	remoteAddress: string
	remotePort: number
	inbound: boolean
	handshaked: boolean
	connectedAt: number
	lastSeenAt: number
	status?: PeerChainStatus | undefined
}

export interface PeerStateSnapshot {
	peers: PeerInfo[]
	count: number
	maxPeers: number
	banned: BanEntry[]
	updatedAt: number
}

let peers: PeerInfo[] = []
let maxPeers = 0
let banned: BanEntry[] = []
let updatedAt = 0

export const getPeerStateSnapshot = (): PeerStateSnapshot => ({
	peers: [...peers],
	count: peers.length,
	maxPeers,
	banned: [...banned],
	updatedAt,
})

export const updatePeers = (peerList: PeerInfo[], maxPeersCount = 0): void => {
	peers = [...peerList]
	maxPeers = maxPeersCount
	updatedAt = Date.now()
}

export const updateBans = (banList: BanEntry[]): void => {
	banned = [...banList]
	updatedAt = Date.now()
}

export const resetPeerState = (): void => {
	peers = []
	maxPeers = 0
	banned = []
	updatedAt = Date.now()
}
