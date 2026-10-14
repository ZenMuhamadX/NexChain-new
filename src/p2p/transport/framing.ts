/**
 * Framing TCP NexChain: **length-prefix 4 byte big-endian** + payload JSON
 * UTF-8.
 *
 * Kenapa length-prefix, bukan newline-delimited: payload JSON boleh memuat
 * newline, dan pembacaan berbasis delimiter rapuh terhadap chunk TCP yang
 * terbelah di tengah byte multi-byte. Panjang eksplisit membuat batas pesan
 * tidak ambigu, dan sekaligus jadi pagar pertama terhadap pesan raksasa
 * (panjang di atas `maxMessageBytes` ditolak SEBELUM dialokasikan).
 *
 * Modul ini murni (tanpa I/O, tanpa Node API) supaya bisa diuji murni dan
 * tanpa LevelDB.
 */
import { parseMessage, type P2PMessage } from '../protocol/messages.js'

/** Panjang field length (byte, big-endian). */
export const LENGTH_PREFIX_BYTES = 4

/** Error protokol framing — socket harus diputus saat ini terjadi. */
export class FrameError extends Error {}

/** Susun frame: [uint32 BE length][payload UTF-8 JSON]. */
export const encodeFrame = (
	message: P2PMessage,
	maxMessageBytes: number,
): Uint8Array => {
	const payload = new TextEncoder().encode(JSON.stringify(message))
	if (payload.byteLength > maxMessageBytes) {
		throw new FrameError(
			`pesan ${payload.byteLength} byte melebihi batas ${maxMessageBytes}`,
		)
	}
	const frame = new Uint8Array(LENGTH_PREFIX_BYTES + payload.byteLength)
	new DataView(frame.buffer).setUint32(0, payload.byteLength, false)
	frame.set(payload, LENGTH_PREFIX_BYTES)
	return frame
}

/**
 * Decoder inkremental: telan potongan TCP mentah, hasilkan pesan utuh.
 *
 * State disimpan di dalam instance; satu instance per koneksi. Bila frame
 * cacat (panjang melebihi batas, JSON rusak, bentuk pesan tidak dikenali),
 * `push` melempar `FrameError` — pemanggil WAJIB memutus koneksi.
 */
export class FrameDecoder {
	private buffer = new Uint8Array(0)

	constructor(private readonly maxMessageBytes: number) {}

	/** Sisa byte yang belum membentuk pesan utuh (untuk diagnostik). */
	get buffered(): number {
		return this.buffer.byteLength
	}

	push(chunk: Uint8Array): P2PMessage[] {
		if (chunk.byteLength > 0) {
			const merged = new Uint8Array(this.buffer.byteLength + chunk.byteLength)
			merged.set(this.buffer, 0)
			merged.set(chunk, this.buffer.byteLength)
			this.buffer = merged
		}

		const messages: P2PMessage[] = []
		let offset = 0

		while (this.buffer.byteLength - offset >= LENGTH_PREFIX_BYTES) {
			const view = new DataView(
				this.buffer.buffer,
				this.buffer.byteOffset + offset,
				LENGTH_PREFIX_BYTES,
			)
			const length = view.getUint32(0, false)
			if (length > this.maxMessageBytes) {
				throw new FrameError(
					`frame ${length} byte melebihi batas ${this.maxMessageBytes}`,
				)
			}
			if (this.buffer.byteLength - offset - LENGTH_PREFIX_BYTES < length) {
				break // belum lengkap
			}

			const start = offset + LENGTH_PREFIX_BYTES
			const slice = this.buffer.subarray(start, start + length)
			let decoded: unknown
			try {
				decoded = JSON.parse(new TextDecoder().decode(slice))
			} catch {
				throw new FrameError('payload bukan JSON valid')
			}
			const message = parseMessage(decoded)
			if (!message) throw new FrameError('bentuk pesan tidak dikenali')
			messages.push(message)
			offset = start + length
		}

		if (offset > 0) {
			this.buffer = this.buffer.subarray(offset)
		}
		return messages
	}
}
