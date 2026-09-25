/**
 * Normalisasi parameter JSON-RPC (STAGE 1 / P1).
 *
 * MASALAH:
 * Pustaka `json-rpc-2.0` meneruskan nilai `params` APA ADANYA sebagai satu
 * argumen pertama handler (lihat `node_modules/json-rpc-2.0/dist/server.js`:
 * `method(request.params, serverParams)`). Pustaka ini TIDAK melakukan:
 *   - spread array menjadi beberapa argumen posisional, dan
 *   - me-resolve named-object (`{address: "..."}`) menjadi argumen.
 *
 * Akibatnya HANYA format non-standar `params: <scalar>` yang bekerja:
 *   - `params: "NxC..."`   -> handler dapat string  -> OK
 *   - `params: ["NxC..."]`  -> handler dapat ARRAY   -> crash (`x.startsWith is not a function`)
 *   - `params: {address}`   -> handler dapat OBJECT  -> crash
 *
 * Client yang patuh spesifikasi JSON-RPC 2.0 (curl, Postman, tooling
 * Ethereum-style, dsb.) mengirim array/named-object sehingga tidak bisa
 * berkomunikasi dengan node.
 *
 * PENDEKATAN:
 * Normalisasi di sisi server agar SEMUA format diterima, tanpa merusak client
 * lama yang sudah mengirim scalar (explorer + wallet client repository ini).
 * Modul ini sengaja TIDAK mengimpor apa pun agar bisa diuji tanpa membuka
 * database atau server.
 */

/** Normalisasi satu nilai `params` tunggal. */
export const normalizeParams = (params: unknown): unknown => {
	// `null` diperlakukan sama dengan "tidak ada parameter".
	if (params === null) return undefined
	// Array kosong = tidak ada argumen posisional.
	if (Array.isArray(params)) {
		if (params.length === 0) return undefined
		// Satu argumen: layer ini hanya dipanggil dengan satu argumen,
		// jadi aman di-unwrap menjadi scalar.
		if (params.length === 1) return params[0]
		// Lebih dari satu argumen: tidak ada handler di repo ini yang
		// multi-argumen, jadi teruskan apa adanya (method berbasis Params
		// seperti `nex_getWork` mem-normalisasi sendiri lewat `firstParam`).
		return params
	}
	// Scalar (string/number/boolean) & named-object: teruskan apa adanya.
	return params
}

/**
 * Normalisasi `params` pada satu request JSON-RPC.
 * Batch request (array of requests) dinormalisasi secara rekursif.
 */
export const normalizeJsonRpcRequest = <T = any>(body: T): T => {
	// Batch request: array of request objects.
	if (Array.isArray(body)) {
		return body.map((entry) => normalizeJsonRpcRequest(entry)) as unknown as T
	}
	// Bukan object (atau null): biarkan, validasi dilakukan oleh server.
	if (!body || typeof body !== 'object') return body

	const record = body as Record<string, unknown>
	// Tanpa `params`: biarkan apa adanya.
	if (!('params' in record)) return body

	return { ...record, params: normalizeParams(record.params) } as unknown as T
}
