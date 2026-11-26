// Jalankan dari root repo: bun rpc-tester/serve.js
// Halaman dilayani di http://localhost:5186 dan request /rpc diteruskan ke
// URL yang diketik di form, jadi CORS node tidak perlu diubah.
Bun.serve({
	hostname: '127.0.0.1',
	port: 5186,
	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname !== '/rpc') {
			return new Response(Bun.file(import.meta.dir + '/index.html'), {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			})
		}
		const target = url.searchParams.get('target') || 'http://localhost:8000/rpc'
		const headers = { 'content-type': 'application/json' }
		const auth = req.headers.get('authorization')
		if (auth) headers.authorization = auth
		return fetch(target, {
			method: 'POST',
			headers,
			body: await req.text(),
		})
	},
})
console.log('RPC tester: http://localhost:5186')
