# src/crypto — Kriptografi

Semua primitif kriptografi. Dulu berada di `key/` + `sign/`.

## File utama

- `ecc.ts` — kurva eliptik secp256k1.
- `createSignature.ts` / `verifySignature.ts` — tanda tangan & verifikasi.
- `generateAddressFromPublicKey.ts` — turunkan alamat `NxC…`.
- `generateKeyFromMnemonic.ts` / `generateRandomMnemonic.ts` / `validateMnemonic.ts` — seed BIP39.
- `recoverPublicKey.ts` — pulihkan public key dari signature.
- `hashMessage.ts` — hashing pesan.
- `chainId.ts` — chain ID.

## Hubungan

Dipakai oleh `src/wallet`, `src/core/transaction` (sign tx), dan
`src/core/validation` (verifikasi signature).
