import type { blockStruct } from 'src/types/block'
import { rlpEncode } from 'src/core/encoding/rlp/rlpEncode'
import { blockToRlpList } from 'src/core/encoding/rlp/blockCodec'
import { uint8ToBase64 } from '../base64/uint8ToBase64'

/**
 * Encode badan blok menjadi string untuk pesan P2P `block`.
 *
 * Format: `base64(rlp(block))`. Skemanya ada di
 * `core/encoding/rlp/blockCodec.ts`.
 *
 * Dipakai node yang MELAYANI `getdata` (`syncManager.handleGetData`). Sama
 * seperti `encodeTx`, hanya field yang benar-benar ada di blok yang dikirim;
 * `header.hash` ikut karena ia identitas blok yang dipakai `inv`/`getdata`.
 */
export const encodeBlock = (block: blockStruct): string =>
	uint8ToBase64(rlpEncode(blockToRlpList(block)))
