/**
 * Public surface of the wallet core. Every rule comes from the canonical root
 * modules through the `src/*` alias. No crypto, codec, or unit copies live here.
 */
export {
	createWalletVault,
	PRIMARY_WALLET_ID,
	type WalletVault,
	type WalletInfo,
	type VaultRecord,
	type UnlockedWallet,
	type VaultOptions,
	type VaultCrypto,
} from 'src/client/wallet/walletVault'
export {
	encryptSecret,
	decryptSecret,
	KDF_ITERATIONS,
	type EncryptedBlob,
} from 'src/client/wallet/vaultCrypto'
export { createJsCrypto } from 'src/client/wallet/jsCrypto'
export { createMemoryKV, type WalletKV } from 'src/client/wallet/kv'
export { createIdbKV } from 'src/client/wallet/idbKv'
export { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
export { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'
export {
	encodeTxPayload,
	decodeTxPayload,
	txSighash,
	txHashOf,
	UNSIGNED_ITEM_COUNT,
	SIGNED_ITEM_COUNT,
	TX_TYPE,
} from 'src/core/encoding/rlp/txCodec'
export { isTxHash } from 'src/core/encoding/rlp/txHash'
export { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
export { toNexu } from 'src/core/token/toNexu'
export { formatNxc } from 'src/core/token/formatNxc'
export { isNexu } from 'src/core/token/isNexu'
export { signTransaction } from 'src/crypto/signTransaction'
export { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
export { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
export { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
export { validateMnemonic } from 'src/crypto/validateMnemonic'
export { CHAIN_ID } from 'src/crypto/chainId'
export type { TxInterface } from 'src/types/transaction'
export type { comTxInterface } from 'src/types/compositeTransaction'
export {
	validateSendForm,
	buildSignedTransaction,
	bumpFee,
	MIN_WIRE_FEE_NEXU,
	type SendForm,
	type BuildResult,
	type TxSigner,
} from './sendFlow'
export {
	fetchAccount,
	fetchBalanceString,
	fetchNextNonce,
	fetchPendingReserve,
	fetchActivityPage,
	sendRawTransaction,
	authCheck,
	setRpcCredentials,
	ACTIVITY_PAGE_SIZE,
	type ActivityPage,
	type SendRawResult,
} from './rpc'
