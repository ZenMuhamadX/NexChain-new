import { TxInterface } from 'src/types/transaction'
import { MemPool } from 'src/core/transaction/memPool'
import { publishTx } from 'src/core/events/nodeEvents'

/**
 * Masukkan transaksi ke mempool.
 *
 * Efek samping P2P ditambahkan lewat bus netral (`publishTx`) — core TIDAK
 * mengimpor `src/p2p/`; `src/p2p/node.ts` yang berlangganan lalu menyiarkan
 * hash tx ke peer. Bila P2P mati, bus tanpa pendengar = no-op.
 */
export const addTxToMempool = async (data: TxInterface): Promise<boolean> => {
	const result = await new MemPool().addTransaction(data)
	if (result.isValid) publishTx(result.data ?? data)
	return result.isValid
}
