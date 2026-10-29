import type { Preset } from '@vite-pwa/assets-generator/config'

/**
 * Preset ikon PWA — maskable + apple-touch.
 *
 * Keduanya disarikan dari `public/maskable.svg`, yang sengaja digambar
 * full-bleed (gradient sampai tepi kanvas) dengan mark diperkecil ke 72%
 * supaya masuk safe-zone 80% milik Android.
 *
 * `padding: 0` mencegah generator menambahkan bingkai transparan; bingkai
 * itu akan terlihat sebagai sudut kosong setelah iOS/Android menerapkan
 * mask squircle/bulat pada ikon.
 */
const preset: Preset = {
	transparent: {
		sizes: [],
		padding: 0,
	},
	maskable: {
		sizes: [512],
		padding: 0,
	},
	apple: {
		sizes: [180],
		padding: 0,
	},
}

export default {
	preset,
	images: ['shells/web/public/maskable.svg'],
}
