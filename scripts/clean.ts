import { rmSync } from 'node:fs'

// Hapus folder build `dist` dengan cara yang aman lintas-OS (pengganti `rm -r`,
// yang tidak tersedia di Windows cmd).
rmSync('dist', { recursive: true, force: true })
