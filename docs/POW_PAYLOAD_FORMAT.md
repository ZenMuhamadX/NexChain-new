# NexChain mining payload format (fork `pow-bytes`)

This file is the single source of truth for the opaque `nex_getWork.payload`
introduced by the `pow-bytes` fork. Both the TypeScript node and the Rust miner
must implement it exactly.

## Transport

`nex_getWork.payload` is a lowercase hex string of a canonical byte buffer.
It is opaque to the miner: the miner must not parse, re-encode, or reconstruct
it. JSON-RPC cannot carry raw bytes, hence hex on the wire.

The buffer contains **all** commitments that lived in the old canonical JSON
preimage (removed in this fork), plus a 4-byte nonce slot at the very end. There
are no JSON keys, no whitespace, and no decimal nonce text.

## Layout

All integers are little-endian. Hashes/addresses are raw bytes, not hex text.

| offset | size | field | encoding |
|---:|---:|---|---|
| 0 | 4 | magic | `u32le = 0x4e584d31` (ASCII `"NXM1"` big-endian; wire bytes `31 4d 58 4e`) |
| 4 | 2 | layoutVersion | `u16le = 2` |
| 6 | 32 | previousBlockHash | raw 32 bytes from 64-hex |
| 38 | 8 | timestampMs | `u64le`, full block timestamp |
| 46 | 1 | versionMajor | `u8` from block `version` |
| 47 | 1 | versionMinor | `u8` |
| 48 | 1 | versionPatch | `u8` |
| 49 | 1 | hashingAlgorithm | `u8` enum: `1 = SHA256D` |
| 50 | 4 | bits | `u32le` compact difficulty |
| 54 | 32 | stateRoot | raw 32 bytes from 64-hex |
| 86 | 4 | height | `u32le` |
| 90 | 32 | merkleRoot | raw 32 bytes; strip `TxC` prefix if present |
| 122 | 4 | chainId | `u32le` |
| 126 | 1 | status | `u8` enum: `1 = confirmed`, `2 = pending`, `0 = other` |
| 127 | 8 | blockReward | `u64le` nexu amount |
| 135 | 20 | minerId | raw 20 bytes of `NxC` address |
| 155 | 8 | totalReward | `u64le` nexu amount |
| 163 | 8 | coinbaseAmount | `u64le` nexu amount |
| 171 | 20 | coinbaseReceiver | raw 20 bytes of `NxC` address |
| 191 | 2 | extraDataLen | `u16le` byte length of `coinbaseTransaction.extraData` |
| 193 | N | extraData | raw bytes, optional `0x` prefix stripped |
| 193+N | 4 | nonce | `u32le` slot; template value is `0` |

Base length before `extraData` is 193 bytes. Total length is `197 + N`.

## Mining rule

The miner writes `nonce.to_le_bytes()` into the last four bytes, then computes:

```text
hash = SHA256(SHA256(payloadBytes))
```

The digest is compared big-endian against `compactToTarget(bits)`:
`hash <= target`. Do not reverse the digest for display/target comparison;
NexChain does not use Bitcoin's reversed display convention.

Nonce is `uint32` in the range `0..4294967295`. If exhausted, get a fresh job;
do not wrap to `0` and do not mutate any other field locally.

## Metadata

`nex_getWork` keeps flat metadata (`status`, `jobId`, `difficulty`, `height`,
`previousBlockHash`, `minerAddress`, `expiresAt`, `targetBlockTimeMs`) for UI
and logging. Metadata is derived from the same job but is **never** an input to
hashing. `difficulty` must equal the `bits` field in the payload.

## Fork identity

- block `hashingAlgorithm` becomes `SHA256D`
- block `version` becomes `0.2.0`
- P2P wire version becomes `3`
- genesis nonce/hash re-solved to `323402` /
  `00000fb55732e4b5d3149edc806d4be984ab316e11dbbb9fd9c699ba6a6f9aff`
- existing `data/` directories are incompatible and must be reset
