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
 *   - Phase B: createUnsignedTransaction + signTransaction (murni, tanpa I/O
 *     filesystem) — inilah yang dipakai wallet browser untuk menyusun &
 *     menanda-tangani transaksi
 *   - decode hex-JSON + nex_getNextNonce (perbaikan validasi saldo & nonce)
 *   - Phase E : konfigurasi URL RPC
 *   - Phase C : vault wallet browser — IndexedDB (`idb`) + Web Crypto
 *     (PBKDF2-SHA256 -> AES-GCM). Satu-satunya tempat mnemonic disimpan di
 *     sisi klien; node sendiri tidak punya wallet.
 *
 * (resolveTxRoles & rpcGetContractBalance dihapus dari permukaan ini
 *  bersama fitur smart contract.)
 */
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { validateMnemonic } from 'src/crypto/validateMnemonic'
import { ecc } from 'src/crypto/ecc'
import { createSignature } from 'src/crypto/createSignature'
import { signTransaction } from 'src/crypto/signTransaction'
import {
	verifySignature,
	recoverSignerAddress,
} from 'src/crypto/verifySignature'
import { CHAIN_ID, encodeV, decodeV } from 'src/crypto/chainId'
import { sha256, hexToBytes } from 'src/core/encoding/sha256'
import { keccak256 } from 'src/core/encoding/keccak256'
import { processPubKey } from 'src/crypto/processPubKey'
import { createMerkleRoot } from 'src/core/transaction/utils/createMerkleRoot'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { hexToString } from 'src/core/encoding/hex/hexToString'
import { isNexu } from 'src/core/token/isNexu'
import { toNexu } from 'src/core/token/toNexu'
import { toNxc } from 'src/core/token/toNxc'
import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { clientSideTxValidate } from 'src/client/lib/clientValidateTx'
import {
	createUnsignedTransaction,
	MIN_AMOUNT_NEXU,
} from 'src/client/lib/createUnsignedTransaction'
import { getNonce } from 'src/client/rpc-client/controller/rpcGetNonce'
import { setRpcUrl, getRpcUrl } from 'src/client/rpc-client/lib/rpcClient'
import {
	createWalletVault,
	PRIMARY_WALLET_ID,
} from 'src/client/wallet/walletVault'
import { createMemoryKV } from 'src/client/wallet/kv'
import { createIdbKV } from 'src/client/wallet/idbKv'
import {
	encryptSecret,
	decryptSecret,
	KDF_ITERATIONS,
} from 'src/client/wallet/vaultCrypto'
import { rpcGetAccount } from 'src/client/rpc-client/controller/rpcGetAccount'
import { rpcGetPendingReserve } from 'src/client/rpc-client/controller/rpcGetPendingReserve'
import { decodeHexJson } from 'src/client/rpc-client/lib/decodeHexJson'
import { validateTransactionSignature } from 'src/core/validation/module/isValidTxSign'
import { validateTransactionSenderReceiver } from 'src/core/validation/module/isValidTxSenderReciever'
import { validateTransactionAmount } from 'src/core/validation/module/isValidTxAmount'
import { validateTransactionFees } from 'src/core/validation/module/isValidTxFee'
import { validateAddresses } from 'src/core/validation/module/isValidAddress'
import { validateAddressLengths } from 'src/core/validation/module/isValidAddressLength'
import { client } from 'src/client/rpc-client/lib/rpcClient'

export const browserWalletSurface = {
	generateKeysFromMnemonic,
	generateAddressFromPublicKey,
	genRandomMnemonic,
	validateMnemonic,
	ecc,
	createSignature,
	signTransaction,
	createUnsignedTransaction,
	MIN_AMOUNT_NEXU,
	getNonce,
	setRpcUrl,
	getRpcUrl,
	createWalletVault,
	PRIMARY_WALLET_ID,
	createMemoryKV,
	createIdbKV,
	encryptSecret,
	decryptSecret,
	KDF_ITERATIONS,
	rpcGetAccount,
	rpcGetPendingReserve,
	decodeHexJson,
	verifySignature,
	recoverSignerAddress,
	CHAIN_ID,
	encodeV,
	decodeV,
	sha256,
	hexToBytes,
	keccak256,
	processPubKey,
	createMerkleRoot,
	encodeTx,
	decodeTx,
	stringToHex,
	hexToString,
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
