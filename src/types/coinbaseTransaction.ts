import { HexString } from 'src/types/block'

export interface coinBaseTx {
	receiver: string
	amount: number
	extraData?: HexString
}
