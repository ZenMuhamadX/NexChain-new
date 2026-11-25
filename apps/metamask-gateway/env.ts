import { config } from 'dotenv'

// Env gateway lebih dulu agar NEX_RPC_URL / NEX_CHAIN_ID lokal menang atas
// root .env. Harus diimpor SEBELUM bridge.ts: CHAIN_ID dihitung saat modul
// dimuat, bukan per request.
config({ path: `${import.meta.dir}/.env` })
config({ path: `${process.cwd()}/.env` })
