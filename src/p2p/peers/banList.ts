/**
 * Daftar alamat yang di-ban (ban list).
 *
 * Modul ini murni: tanpa I/O, tanpa timer. Semua keputusan waktu memakai
 * `Date.now()` sebagai default tetapi bisa disuntik lewat parameter
 * `now`/`at`, sehingga pengujian bisa deterministik dan offline.
 *
 * Pembuangan entri kedaluwarsa dilakukan malas (lazily) di `isBanned`,
 * `size`, dan `entries` — tidak ada timer yang harus dibersihkan saat
 * lifecycle, sehingga tidak ada risiko kebocoran entri mati.
 */

/** Satu entri ban yang masih berlaku (dipakai untuk inspeksi/logging). */
export interface BanEntry {
	address: string
	reason: string
	/** Sampai kapan ban berlaku (epoch ms). */
	until: number
}

/** Bentuk internal entri: alamat disimpan sebagai kunci map. */
interface InternalEntry {
	reason: string
	until: number
}

export class BanList {
	private readonly map = new Map<string, InternalEntry>()
	private readonly defaultDurationMs: number

	constructor(defaultDurationMs: number) {
		this.defaultDurationMs = defaultDurationMs
	}

	/**
	 * Ban `address` selama `defaultDurationMs` sejak `now`.
	 *
	 * Pemanggilan ulang MENIMPA entri lama (durasi dihitung ulang dari
	 * `now`), bukan menambah — perpanjangan sengaja dimulai dari saat
	 * pelanggaran terakhir.
	 */
	ban(address: string, reason: string, now: number = Date.now()): void {
		this.map.set(address, {
			reason,
			until: now + this.defaultDurationMs,
		})
	}

	/**
	 * Apakah `address` sedang dibanned pada waktu `at`.
	 *
	 * Sekalian membuang entri kedaluwarsa lebih dulu, sehingga balikan
	 * `true` berarti benar-benar masih berlaku.
	 */
	isBanned(address: string, at: number = Date.now()): boolean {
		this.prune(at)
		return this.map.has(address)
	}

	/** Angkat larangan lebih awal (bila ada). Tidak error bila tidak ada. */
	lift(address: string): void {
		this.map.delete(address)
	}

	/** Jumlah entri yang masih berlaku (sekalian membuang yang kedaluwarsa). */
	size(now: number = Date.now()): number {
		this.prune(now)
		return this.map.size
	}

	/** Salinan entri yang masih berlaku (urutan ikut iterasi map). */
	entries(now: number = Date.now()): BanEntry[] {
		this.prune(now)
		const out: BanEntry[] = []
		for (const [address, entry] of this.map) {
			out.push({ address, reason: entry.reason, until: entry.until })
		}
		return out
	}

	/** Buang entri yang sudah kedaluwarsa pada `now` (lewat = tidak berlaku). */
	private prune(now: number): void {
		for (const [address, entry] of this.map) {
			if (entry.until <= now) this.map.delete(address)
		}
	}
}
