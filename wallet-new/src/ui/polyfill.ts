/**
 * MUST be the first import in the entry. `bip39` calls `Buffer.from`, which
 * does not exist in the browser. The `buffer` package is aliased to its pure
 * JS implementation in vite.config.ts, so this polyfill pulls no Node module.
 */
import { Buffer } from 'buffer'

const scope = globalThis as { Buffer?: typeof Buffer }
if (typeof scope.Buffer === 'undefined') scope.Buffer = Buffer
