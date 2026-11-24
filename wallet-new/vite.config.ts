import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const clean = (path: string): string =>
	path.replace(/\\/g, '/').replace(/\/+$/, '')

const repoRoot = clean(fileURLToPath(new URL('..', import.meta.url)))
const walletRoot = clean(fileURLToPath(new URL('.', import.meta.url)))

export default defineConfig({
	root: walletRoot,
	envDir: walletRoot,
	base: './',
	build: {
		outDir: `${walletRoot}/dist`,
		emptyOutDir: true,
		sourcemap: false,
	},
	resolve: {
		alias: [
			{
				find: /^buffer$/,
				replacement: `${repoRoot}/node_modules/buffer/index.js`,
			},
			{ find: /^src\//, replacement: `${repoRoot}/src/` },
		],
	},
	esbuild: { jsx: 'automatic' },
	server: {
		port: 5184,
		fs: { allow: [repoRoot] },
	},
	preview: { port: 5184 },
})
