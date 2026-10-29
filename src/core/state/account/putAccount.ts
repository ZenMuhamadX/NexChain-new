import { structBalance } from 'src/types/balance'
import { assertNexuCapped } from 'src/core/token/isNexuCapped'
import { encodeAccount } from 'src/core/encoding/rlp/accountCodec'
import { bufferPut } from 'src/core/state/journal/writeBuffer'

/**
 * Tulis akun sebagai leaf RLP v1 (`encoding/rlp/accountCodec.ts`). Kunci =
 * alamat; `address` di objek hanya dipakai lapisan atas dan tidak ikut
 * disimpan.
 *
 * Selama commit, tulisan masuk write-buffer (jadi ikut undo journal); di luar
 * commit (genesis, rollback, gate) langsung ke DB. Kegagalan MELEMPAR, tidak
 * ditelan: tulisan state yang hilang diam-diam membuat blok tampak sukses
 * dengan saldo yang tidak pernah tersimpan.
 */
export const putAccount = async (
	address: string,
	balance: structBalance,
): Promise<void> => {
	// ---- GUARD FAIL-CLOSED — sengaja di LUAR try/catch -------------------
	// Ini choke point TUNGGAL penulisan saldo: seluruh jalur — transfer,
	// kredit coinbase, pembuatan akun — melewati fungsi ini.
	assertNexuCapped(balance?.balance, `putAccount(${address}).balance`)

	if (!address || !balance) {
		throw new Error(`putAccount: address atau balance kosong (${address})`)
	}

	await bufferPut('state', address, encodeAccount(balance))
}
