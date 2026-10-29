import type { Preset } from '@vite-pwa/assets-generator/config'

/**
 * Preset ikon PWA — badge ("any").
 *
 * `padding: 0` itu sengaja: `public/favicon.svg` sudah menggambar badge
 * rounded-square yang mengisi penuh kanvas 64×64. Padding bawaan generator
 * (0.05) akan membuat badge mengambang dengan tepi transparan, sehingga
 * ikon terlihat lebih kecil dari ikon aplikasi lain di launcher.
 *
 * Ikon maskable dan apple TIDAK dibuat dari berkas ini — keduanya butuh
 * latar penuh (full-bleed) supaya tidak ada sudut transparan yang ikut
 * ter-mask. Lihat `pwa-assets.maskable.config.ts`.
 */
const preset: Preset = {
	transparent: {
		sizes: [192, 512],
		favicons: [[48, 'favicon.ico']],
		padding: 0,
	},
	maskable: {
		sizes: [],
		padding: 0,
	},
	apple: {
		sizes: [],
		padding: 0,
	},
}

export default {
	preset,
	images: ['shells/web/public/favicon.svg'],
}
