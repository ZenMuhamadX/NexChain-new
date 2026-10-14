import { HexString } from 'src/types/block'

export interface metadata {
	txCount: number
	created_at: number
	extraData: HexString
}
