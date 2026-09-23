import { defineConfig } from 'vite'

// Catatan: type backend (interface/*) di-import sebagai type-only,
// jadi tidak perlu resolve alias — file backend tidak pernah ikut bundle.
export default defineConfig({
	server: {
		port: 5173,
	},
	build: {
		outDir: 'dist',
		sourcemap: false,
	},
})
