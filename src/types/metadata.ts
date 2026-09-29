import { HexString } from 'src/types/block'

export interface metadata {
	txCount: number
	gasPrice: number
	created_at: number
	extraData: HexString
}
