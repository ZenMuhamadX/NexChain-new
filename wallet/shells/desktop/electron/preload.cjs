/**
 * Preload — satu-satunya jembatan antara renderer dan proses utama.
 *
 * Mengapa berkas ini ada: `contextIsolation: true` berarti renderer TIDAK
 * berbagi konteks JS dengan preload. Preload boleh memakai `require('electron')`,
 * renderer tidak. Yang menyeberang hanyalah yang kita ekspos eksplisit di sini.
 *
 * Prinsip: ekspos SESEMPIT mungkin. Renderer tidak butuh "baca/tulis berkas
 * apa pun" — ia butuh empat operasi vault. Setiap operasi tambahan yang
 * diekspos adalah celah yang ikut terbuka bila renderer disusupi.
 *
 * Perhatikan: kunci (`key`) TIDAK divalidasi di sini — validasi ada di proses
 * utama bersama resolusi path. Preload hanya saluran; jangan duplikasi aturan
 * keamanan di lapisan yang bisa ikut ter-bundle ke renderer.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nexVaultBridge', {
	/** Baca nilai vault. `undefined` bila berkas belum ada. */
	read: (key) => ipcRenderer.invoke('vault:read', key),
	/** Tulis nilai vault (JSON string) secara atomik. */
	write: (key, value) => ipcRenderer.invoke('vault:write', key, value),
	/** Hapus nilai vault. Berkas yang sudah tidak ada bukan error. */
	remove: (key) => ipcRenderer.invoke('vault:remove', key),
	/** Direktori data — dipakai layar Settings untuk menampilkan lokasi vault. */
	dataDir: () => ipcRenderer.invoke('vault:dataDir'),
})
