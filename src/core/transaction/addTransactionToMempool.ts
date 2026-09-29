import { TxInterface } from 'src/types/transaction'
import { MemPool } from 'src/core/transaction/memPool'

export const addTxToMempool = async (data: TxInterface): Promise<boolean> => {
	return (await new MemPool().addTransaction(data)).isValid
}
