/**
 * Gerbang regresi "jalur wallet harus bisa dibundle untuk browser".
 *
 * File ini mengimpor SELURUH jalur kriptografi + validasi transaksi yang akan
 * dipakai wallet berbasis browser (Phase B/C/D). Dibundle dengan
 * `--platform=browser`, sehingga bila ada modul Node (fs, path, crypto, util,
 * os, ...) atau WebAssembly bergaya webpack yang bocor ke jalur itu,
 * esbuild AKAN GAGAL -> exit code non-nol.
 *
 * Jalankan:  bun run check:browser
 *
 * Saat ini yang sudah bebas Node API:
 *   - sha256 (js-sha256), keccak256 (js-sha3), proses pub key, address
 *   - sign/recover/verify (elliptic + EIP-155)
 *   - derive kunci mnemonic -> BIP32 via adapter `key/ecc.ts` (elliptic),
 *     menggantikan tiny-secp256k1 yang memakai .wasm gaya webpack
 *   - logging (fs/path/winston di-import lazy + specifier tak-literal)
 *   - client-side tx validator + RPC client (fetch)
 *   - Phase B: createUnsignedTransaction + signTransaction (murni, tanpa I/O,
 *     tanpa loadWallet) — inilah yang akan dipakai wallet browser untuk
 *     menyusun & menanda-tangani transaksi
 *   - decode hex-JSON + nex_getNextNonce (perbaikan validasi saldo & nonce)
 *   - Phase E : resolveTxRoles (peran kontrak diturunkan dari alamat, bukan
 *     dari flag client yang tidak ikut di-hash) + konfigurasi URL RPC
 */
import { generateKeysFromMnemonic } from 'key/genKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'key/genAddrFromPubKey'
import { genRandomMnemonic } from 'key/genRandomMnemonic'
import { validateMnemonic } from 'key/validateMnemonic'
import { ecc } from 'key/ecc'
import { createSignature } from 'sign/createSign'
import { signTransaction } from 'sign/signTransaction'
import { verifySignature, recoverSignerAddress } from 'sign/verifySIgnature'
import { hashMessage } from 'sign/hashMessage'
import { CHAIN_ID, encodeV, decodeV } from 'sign/chainId'
import { sha256, hexToBytes } from 'nexchain/block/sha256'
import { keccak256 } from 'nexchain/block/keccak256'
import { processPubKey } from 'account/utils/processPubKey'
import { createTxnHash } from 'nexchain/transaction/createTxHash'
import { createMerkleRoot } from 'nexchain/transaction/utils/createMerkleRoot'
import { encodeTx } from 'nexchain/hex/tx/encodeTx'
import { decodeTx } from 'nexchain/hex/tx/decodeTx'
import { stringToHex } from 'nexchain/hex/stringToHex'
import { hexToString } from 'nexchain/hex/hexToString'
import { isContract } from 'nexchain/lib/isContract'
import { isNexu } from 'nexchain/nexucoin/isNexu'
import { toNexu } from 'nexchain/nexucoin/toNexu'
import { toNxc } from 'nexchain/nexucoin/toNxc'
import { isValidAddress } from 'nexchain/transaction/utils/isValidAddress'
import { clientSideTxValidate } from 'client/lib/clientValidateTx'
import {
	createUnsignedTransaction,
	DEFAULT_EXTRA_MESSAGE,
	MIN_AMOUNT_NEXU,
} from 'client/lib/createUnsignedTransaction'
import { getNonce } from 'client/rpc-client/controller/rpcGetNonce'
import { setRpcUrl, getRpcUrl } from 'client/rpc-client/lib/rpcClient'
import { resolveTxRoles } from 'nexchain/transaction/resolveTxRoles'
import { rpcGetAccount } from 'client/rpc-client/controller/rpcGetAccount'
import { rpcGetPendingBalance } from 'client/rpc-client/controller/rpcGetPendingBalance'
import { rpcGetContractBalance } from 'client/rpc-client/controller/rpcGetContractBalance'
import { decodeHexJson } from 'client/rpc-client/lib/decodeHexJson'
import { validateTransactionSignature } from 'interface/module/isValidTxSign'
import { validateTransactionSenderReceiver } from 'interface/module/isValidTxSenderReciever'
import { validateTransactionAmount } from 'interface/module/isValidTxAmount'
import { validateTransactionFees } from 'interface/module/isValidTxFee'
import { validateAddresses } from 'interface/module/isValidAddress'
import { validateAddressLengths } from 'interface/module/isValidAddressLength'
import { client } from 'client/rpc-client/lib/rpcClient'

export const browserWalletSurface = {
	generateKeysFromMnemonic,
	generateAddressFromPublicKey,
	genRandomMnemonic,
	validateMnemonic,
	ecc,
	createSignature,
	signTransaction,
	createUnsignedTransaction,
	DEFAULT_EXTRA_MESSAGE,
	MIN_AMOUNT_NEXU,
	getNonce,
	setRpcUrl,
	getRpcUrl,
	resolveTxRoles,
	rpcGetAccount,
	rpcGetPendingBalance,
	rpcGetContractBalance,
	decodeHexJson,
	verifySignature,
	recoverSignerAddress,
	hashMessage,
	CHAIN_ID,
	encodeV,
	decodeV,
	sha256,
	hexToBytes,
	keccak256,
	processPubKey,
	createTxnHash,
	createMerkleRoot,
	encodeTx,
	decodeTx,
	stringToHex,
	hexToString,
	isContract,
	isNexu,
	toNexu,
	toNxc,
	isValidAddress,
	clientSideTxValidate,
	validateTransactionSignature,
	validateTransactionSenderReceiver,
	validateTransactionAmount,
	validateTransactionFees,
	validateAddresses,
	validateAddressLengths,
	client,
}
