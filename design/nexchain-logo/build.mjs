#!/usr/bin/env node
/**
 * NexChain — set produksi logo resmi (arah "Nex Flow", nx-05).
 *
 *   node design/nexchain-logo/build.mjs
 *
 * Menghasilkan seluruh berkas di mark/, lockup/, dan icon/ — termasuk raster
 * (PNG + ICO) lewat Chrome/Edge headless. Kalau tidak ada browser yang bisa
 * dipanggil, SVG tetap dibuat dan raster dilewati dengan peringatan.
 *
 * Geometri di berkas ini adalah salinan dari design/brand/build.mjs (konsep nx-05).
 * Supaya tidak diam-diam menyimpang, skrip ini membandingkan hasilnya dengan berkas
 * di design/brand/svg/ dan berhenti kalau ada beda. Jadi kalau bentuk di
 * design/brand/build.mjs diubah, di sini akan langsung ketahuan.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAND = join(HERE, '..', 'brand');
const BRAND_SVG = join(BRAND, 'svg');
const TMP = join(HERE, '.tmp-raster');

/* ------------------------------------------------------------------ *
 * 1. Token warna
 * ------------------------------------------------------------------ */

const C = {
  blue: '#0784c3',
  mint: '#00c9a7',
  deep: '#05628f',
  ink: '#0b1620',
  white: '#ffffff',
};

const PAL = {
  light: { a: C.blue, b: C.mint, c: C.deep },
  inverse: { a: C.white, b: C.mint, c: C.blue },
  mono: { a: C.ink, b: C.ink, c: C.ink },
  monoW: { a: C.white, b: C.white, c: C.white },
};

const r = (n, d = 2) => {
  const f = Math.pow(10, d);
  return String(Math.round(n * f) / f);
};

const indent = (str, n) => {
  const pad = '  '.repeat(n);
  return str
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
};

const embed = (str) => str.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="100%"');

/* ------------------------------------------------------------------ *
 * 2. Marka "Nex Flow"
 * ------------------------------------------------------------------ */

const CHEVRON = 'M -34,-64 L 0,0 L -34,64';
const BOX = { x: 30, y: 48, w: 196.1, h: 160 };

function draw(pal) {
  return `<path d="${CHEVRON}" transform="translate(80,128)" fill="none" stroke="${pal.a}" stroke-width="32" stroke-linejoin="miter" stroke-linecap="butt"/>
<path d="${CHEVRON}" transform="translate(192,128)" fill="none" stroke="${pal.b}" stroke-width="32" stroke-linejoin="miter" stroke-linecap="butt"/>`;
}

/* ------------------------------------------------------------------ *
 * 3. Wordmark NEXCHAIN (outline, grid 5x7, stroke 1)
 * ------------------------------------------------------------------ */

const GLYPHS = {
  N: { w: 5, s: [[[0, 7], [0, 0], [5, 7], [5, 0]]] },
  E: { w: 5, s: [[[5, 0], [0, 0], [0, 7], [5, 7]], [[0, 3.5], [3.6, 3.5]]] },
  X: { w: 5, s: [[[0, 0], [5, 7]], [[5, 0], [0, 7]]] },
  C: { w: 5, s: [[[5, 0], [0, 0], [0, 7], [5, 7]]] },
  H: { w: 5, s: [[[0, 0], [0, 7]], [[5, 0], [5, 7]], [[0, 3.5], [5, 3.5]]] },
  A: { w: 5, s: [[[0, 7], [2.5, 0], [5, 7]], [[1, 4.55], [4, 4.55]]] },
  I: { w: 2.5, s: [[[1.25, 0], [1.25, 7]]] },
};

const WORD_GAP = 2.3;
const WORD_TEXT = 'NEXCHAIN';
const WORD_BOX = { x: -0.5, y: -0.5, w: 54.6, h: 8 };

function wordmarkD() {
  let x = 0;
  const out = [];
  for (const ch of WORD_TEXT) {
    const g = GLYPHS[ch];
    for (const seg of g.s) {
      out.push(seg.map(([px, py], i) => `${i ? 'L' : 'M'} ${r(px + x)},${r(py)}`).join(' '));
    }
    x += g.w + WORD_GAP;
  }
  return out.join(' ');
}

/* ------------------------------------------------------------------ *
 * 4. Builder SVG
 * ------------------------------------------------------------------ */

function placedMark(pal, targetMax, cx, cy) {
  const s = targetMax / Math.max(BOX.w, BOX.h);
  const tx = cx - (BOX.x + BOX.w / 2) * s;
  const ty = cy - (BOX.y + BOX.h / 2) * s;
  return `<g transform="translate(${r(tx)},${r(ty)}) scale(${r(s, 5)})">\n${indent(draw(pal), 1)}\n</g>`;
}

function placedWordmark(pal, scale, cx, cy) {
  const tx = cx - (WORD_BOX.x + WORD_BOX.w / 2) * scale;
  const ty = cy - (WORD_BOX.y + WORD_BOX.h / 2) * scale;
  return `<g transform="translate(${r(tx)},${r(ty)}) scale(${r(scale, 5)})">
  <path d="${wordmarkD()}" fill="none" stroke="${pal.a}" stroke-width="1" stroke-linejoin="miter" stroke-linecap="butt"/>
</g>`;
}

function svg(vb, body, label, w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-label="${label}">
${indent(body, 1)}
</svg>
`;
}

const markSvg = (pal, label) => svg('0 0 256 256', draw(pal), label, 256, 256);

const LOCK_H = { w: 380, h: 100 };
function lockupH(pal, label) {
  const body = [
    placedMark(pal, 100, 50, 50),
    placedWordmark(pal, 4.5, 134 + (54.6 * 4.5) / 2, 50),
  ].join('\n');
  return svg(`0 0 ${LOCK_H.w} ${LOCK_H.h}`, body, label, LOCK_H.w, LOCK_H.h);
}

const LOCK_V = { w: 246, h: 160 };
function lockupV(pal, label) {
  const body = [
    placedMark(pal, 100, LOCK_V.w / 2, 50),
    placedWordmark(pal, 4.5, LOCK_V.w / 2, 142),
  ].join('\n');
  return svg(`0 0 ${LOCK_V.w} ${LOCK_V.h}`, body, label, LOCK_V.w, LOCK_V.h);
}

function appIcon(pal, label, radius) {
  const body = `<rect width="256" height="256"${radius ? ` rx="${radius}"` : ''} fill="${C.ink}"/>\n${placedMark(pal, 140, 128, 128)}`;
  return svg('0 0 256 256', body, label, 256, 256);
}

function faviconSvg(pal, label) {
  const body = `<rect width="32" height="32" rx="7" fill="${C.ink}"/>\n${placedMark(pal, 21, 16, 16)}`;
  return svg('0 0 32 32', body, label, 32, 32);
}

function clearSpaceSvg() {
  const p = 0.25 * BOX.h;
  const x0 = BOX.x - p;
  const y0 = BOX.y - p;
  const x1 = BOX.x + BOX.w + p;
  const y1 = BOX.y + BOX.h + p;
  const m = 26;
  const tick = Math.min(BOX.w, BOX.h) * 0.16;
  const body = `${draw(PAL.mono)}
<g fill="none" stroke="${C.blue}" stroke-width="1.6" stroke-dasharray="7 6">
  <rect x="${r(x0)}" y="${r(y0)}" width="${r(x1 - x0)}" height="${r(y1 - y0)}"/>
</g>
<g fill="none" stroke="${C.mint}" stroke-width="2">
  <path d="M ${r(BOX.x)} ${r(y0)} v ${r(tick)} M ${r(BOX.x)} ${r(y0)} h ${r(tick)}"/>
  <path d="M ${r(BOX.x + BOX.w)} ${r(y0)} v ${r(tick)} M ${r(BOX.x + BOX.w)} ${r(y0)} h -${r(tick)}"/>
  <path d="M ${r(BOX.x)} ${r(y1)} v -${r(tick)} M ${r(BOX.x)} ${r(y1)} h ${r(tick)}"/>
  <path d="M ${r(BOX.x + BOX.w)} ${r(y1)} v -${r(tick)} M ${r(BOX.x + BOX.w)} ${r(y1)} h -${r(tick)}"/>
</g>`;
  return svg(`${r(x0 - m)} ${r(y0 - m)} ${r(x1 - x0 + m * 2)} ${r(y1 - y0 + m * 2)}`, body, 'NexChain — ruang bebas', x1 - x0 + m * 2, y1 - y0 + m * 2);
}

/* ------------------------------------------------------------------ *
 * 5. Tulis SVG
 * ------------------------------------------------------------------ */

for (const dir of ['mark', 'lockup', 'icon']) {
  rmSync(join(HERE, dir), { recursive: true, force: true });
  mkdirSync(join(HERE, dir), { recursive: true });
}

const w = (rel, content) => writeFileSync(join(HERE, rel), content, 'utf8');

w('mark/nexchain-mark.svg', markSvg(PAL.light, 'NexChain — marka, latar terang'));
w('mark/nexchain-mark-inverse.svg', markSvg(PAL.inverse, 'NexChain — marka, latar gelap'));
w('mark/nexchain-mark-mono.svg', markSvg(PAL.mono, 'NexChain — marka satu warna (tinta)'));
w('mark/nexchain-mark-mono-white.svg', markSvg(PAL.monoW, 'NexChain — marka satu warna (putih)'));

w('lockup/nexchain-lockup-h.svg', lockupH(PAL.light, 'NexChain — lockup horizontal, latar terang'));
w('lockup/nexchain-lockup-h-inverse.svg', lockupH(PAL.inverse, 'NexChain — lockup horizontal, latar gelap'));
w('lockup/nexchain-lockup-v.svg', lockupV(PAL.light, 'NexChain — lockup vertikal, latar terang'));
w('lockup/nexchain-lockup-v-inverse.svg', lockupV(PAL.inverse, 'NexChain — lockup vertikal, latar gelap'));
w('lockup/nexchain-lockup-h-mono.svg', lockupH(PAL.mono, 'NexChain — lockup horizontal satu warna'));

w('icon/nexchain-appicon.svg', appIcon(PAL.inverse, 'NexChain — app icon', 56));
w('icon/nexchain-appicon-flat.svg', appIcon(PAL.inverse, 'NexChain — app icon tanpa sudut (maskable / apple-touch)', 0));
w('icon/favicon.svg', faviconSvg(PAL.monoW, 'NexChain — favicon'));

/* ------------------------------------------------------------------ *
 * 6. Cek penyimpangan terhadap design/brand/svg/nx-05-*
 * ------------------------------------------------------------------ */

const PAIRS = [
  ['mark/nexchain-mark.svg', 'nx-05-mark.svg'],
  ['mark/nexchain-mark-inverse.svg', 'nx-05-mark-inverse.svg'],
  ['mark/nexchain-mark-mono.svg', 'nx-05-mark-mono.svg'],
  ['lockup/nexchain-lockup-h.svg', 'nx-05-lockup-h.svg'],
  ['lockup/nexchain-lockup-h-inverse.svg', 'nx-05-lockup-h-inverse.svg'],
  ['lockup/nexchain-lockup-v.svg', 'nx-05-lockup-v.svg'],
  ['lockup/nexchain-lockup-v-inverse.svg', 'nx-05-lockup-v-inverse.svg'],
  ['icon/nexchain-appicon.svg', 'nx-05-appicon.svg'],
  ['icon/favicon.svg', 'nx-05-favicon.svg'],
];

const norm = (s) => s.replace(/aria-label="[^"]*"/g, '').replace(/\s+/g, ' ').trim();

let drift = 0;
for (const [mine, theirs] of PAIRS) {
  const other = join(BRAND_SVG, theirs);
  if (!existsSync(other)) continue;
  if (norm(readFileSync(join(HERE, mine), 'utf8')) !== norm(readFileSync(other, 'utf8'))) {
    console.error(`[nexchain-logo] BEDA: ${mine}  !=  design/brand/svg/${theirs}`);
    drift++;
  }
}
if (drift) {
  console.error(`\n[nexchain-logo] ${drift} berkas menyimpang dari design/brand/.`);
  console.error('[nexchain-logo] Samakan geometri di kedua build.mjs sebelum lanjut.\n');
  process.exit(1);
}
console.log('[nexchain-logo] geometri identik dengan design/brand/svg/nx-05-*  ✓');

/* ------------------------------------------------------------------ *
 * 7. Raster: PNG + ICO lewat browser headless
 * ------------------------------------------------------------------ */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));

/**
 * Bikin HTML sekali pakai. SVG dikunci ke px persis di pojok kiri atas — bukan
 * 100vw/100vh — karena Chrome/Edge memaksa lebar jendela minimum (~500 px), sehingga
 * pada ukuran output kecil viewport jadi lebih lebar dari yang diminta dan isinya
 * bergeser keluar dari hasil screenshot.
 */
function stage(name, svgText, size) {
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `${name}-${size}.html`);
  writeFileSync(
    file,
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;overflow:hidden;background:transparent}
svg{display:block;position:absolute;top:0;left:0;width:${size}px;height:${size}px}
</style></head><body>${embed(svgText)}</body></html>`,
    'utf8'
  );
  return file;
}

function raster(stageFile, size, outRel, transparent) {
  const out = join(HERE, outRel);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    '--virtual-time-budget=2500',
    `--screenshot=${out}`,
  ];
  if (transparent) args.push('--default-background-color=00000000');
  args.push('file:///' + stageFile.replace(/\\/g, '/'));
  execFileSync(CHROME, args, { stdio: 'ignore' });
  return out;
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(images.length * 16);
  let offset = 6 + images.length * 16;
  images.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(img.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.buf.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.buf)]);
}

/**
 * Baca PNG seperlunya: dimensi, color type, dan warna di titik sampel.
 * Dipakai untuk memastikan hasil raster tidak kosong / tidak bergeser.
 */
function probePng(file) {
  const b = readFileSync(file);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const ct = b[25];

  let off = 8;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(b.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3;
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let p = 0;

  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    for (let x = 0; x < stride; x++) {
      const rv = raw[p + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const ul = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (ft === 0) v = rv;
      else if (ft === 1) v = rv + a;
      else if (ft === 2) v = rv + up;
      else if (ft === 3) v = rv + ((a + up) >> 1);
      else {
        const q = a + up - ul;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - up);
        const pc = Math.abs(q - ul);
        v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
      }
      px[y * stride + x] = v & 0xff;
    }
    p += stride;
  }

  const at = (x, y) => {
    const i = y * stride + x * bpp;
    return [px[i], px[i + 1], px[i + 2], bpp === 4 ? px[i + 3] : 255];
  };

  const colors = new Set();
  let opaque = 0;
  let clear = 0;
  for (let gy = 1; gy < 8; gy++) {
    for (let gx = 1; gx < 8; gx++) {
      const c = at(Math.round((w * gx) / 8), Math.round((h * gy) / 8));
      colors.add(c.slice(0, 3).join(','));
      if (c[3] === 255) opaque++;
      if (c[3] === 0) clear++;
    }
  }

  return { w, h, ct, colors: colors.size, opaque, clear };
}

/** Gagal keras kalau raster ternyata kosong, polos, atau ukurannya salah. */
function assertRaster(file, expectSize, expectAlpha) {
  const name = file.slice(HERE.length + 1).replace(/\\/g, '/');
  const d = probePng(file);
  const problems = [];
  if (d.w !== expectSize || d.h !== expectSize) problems.push(`ukuran ${d.w}x${d.h}, harusnya ${expectSize}`);
  if (d.colors < 2) problems.push('hanya satu warna — gambar kemungkinan kosong');
  if (expectAlpha && d.clear === 0) problems.push('tidak ada piksel transparan');
  if (!expectAlpha && d.opaque < 40) problems.push('banyak piksel tidak opaque');
  if (problems.length) {
    console.error(`[nexchain-logo] GAGAL ${name}: ${problems.join('; ')}`);
    process.exitCode = 1;
  }
  return !problems.length;
}

let rasterNote = '';
if (!CHROME) {
  rasterNote = 'Browser headless tidak ditemukan — PNG dan ICO dilewati.';
  console.warn(`[nexchain-logo] ${rasterNote}`);
  console.warn('[nexchain-logo] Set CHROME_PATH ke chrome/edge, lalu jalankan ulang.');
} else {
  // Ikon PNG diekspor dari varian flat (persegi penuh) — itu yang diminta manifest
  // PWA dan app store; OS yang memotong sudutnya sendiri. Varian bersudut tetap
  // tersedia sebagai SVG untuk dipasang manual di UI.
  const APP = appIcon(PAL.inverse, 'app icon', 0);
  const MARK = markSvg(PAL.light, 'marka');
  const MARK_INV = markSvg(PAL.inverse, 'marka inverse');

  const sizes = [1024, 512, 192];
  const icoSizes = [16, 32, 48];
  const failed = [];

  for (const s of sizes) {
    const out = raster(stage('appicon', APP, s), s, `icon/nexchain-appicon-${s}.png`, false);
    if (!assertRaster(out, s, false)) failed.push(out);
  }

  const touch = raster(stage('appicon', APP, 180), 180, 'icon/nexchain-apple-touch-icon.png', false);
  if (!assertRaster(touch, 180, false)) failed.push(touch);

  for (const [name, svgText] of [['mark-1024', MARK], ['mark-inverse-1024', MARK_INV]]) {
    const out = raster(stage(name, svgText, 1024), 1024, `icon/nexchain-${name}.png`, true);
    if (!assertRaster(out, 1024, true)) failed.push(out);
  }

  const ico = icoSizes.map((s) => {
    const out = raster(stage('appicon', APP, s), s, `.tmp-raster/ico-${s}.png`, false);
    assertRaster(out, s, false);
    return { size: s, buf: readFileSync(out) };
  });
  writeFileSync(join(HERE, 'icon', 'favicon.ico'), buildIco(ico));

  rasterNote = `Raster dibuat dengan ${CHROME.split(/[\\/]/).pop()} — app icon ${sizes.join('/')} + apple-touch 180 (persegi penuh), marka 1024 transparan (terang & gelap), favicon.ico ${icoSizes.join('/')}.`;
  console.log(`[nexchain-logo] ${rasterNote}`);
  if (failed.length) {
    console.error(`[nexchain-logo] ${failed.length} raster gagal pemeriksaan — jangan dipakai.`);
  } else {
    console.log('[nexchain-logo] semua raster lolos pemeriksaan piksel  ✓');
  }
}

rmSync(TMP, { recursive: true, force: true });

/* ------------------------------------------------------------------ *
 * 8. Halaman pratinjau
 * ------------------------------------------------------------------ */

const PREVIEW = `<!DOCTYPE html>
<html lang="id" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NexChain — Logo Resmi (Nex Flow)</title>
<style>
  :root {
    --bg:#0a0e13; --panel:#111821; --line:#1e2732; --fg:#e8eef6; --fg-dim:#8ea0b3; --fg-faint:#5d6d7e;
    --mint:#00c9a7; --ink:#0b1620;
    --sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1060px;margin:0 auto;padding:56px 28px 110px}
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--fg-dim);display:flex;align-items:center;gap:10px}
  .kicker .dot{width:7px;height:7px;border-radius:2px;background:var(--mint)}
  h1{font-size:clamp(28px,4.4vw,44px);line-height:1.1;margin:18px 0 12px;letter-spacing:-.02em;font-weight:600}
  .lede{max-width:64ch;color:var(--fg-dim);margin:0}
  h2{font-family:var(--mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--fg-dim);font-weight:500;margin:0 0 6px}
  h4{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--fg-faint);margin:0 0 8px;font-weight:500}
  section{margin-top:60px}
  .sub{color:var(--fg-dim);margin:6px 0 20px;max-width:66ch;font-size:14px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:760px){.two{grid-template-columns:1fr}}
  .panel{border:1px solid var(--line);border-radius:14px;padding:16px;position:relative}
  .panel.dark{background:var(--ink);border-color:#1b2733}
  .panel.light{background:#fff;border-color:#e4e9ee}
  .panel .lbl{position:absolute;top:12px;left:16px;font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase}
  .panel.dark .lbl{color:#5f7385}
  .panel.light .lbl{color:#93a2b1}
  .stage{display:flex;align-items:center;justify-content:center;padding:46px 16px 22px}
  .stage svg{display:block}
  .stage.hero{height:290px}.stage.hero svg{width:190px;height:190px}
  .stage.lk{height:150px}.stage.lk svg{width:100%;max-width:430px;height:auto}
  .stage.lkv{height:210px}.stage.lkv svg{width:100%;max-width:215px;height:auto}
  .variants{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media(max-width:760px){.variants{grid-template-columns:1fr}}
  .vcard{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}
  .vcard .box{height:120px;display:flex;align-items:center;justify-content:center;padding:16px}
  .vcard .box.dk{background:var(--ink)}
  .vcard .box.lt{background:#fff}
  .vcard .meta{padding:10px 12px;border-top:1px solid var(--line)}
  .vcard .meta b{display:block;font-family:var(--mono);font-size:11px;font-weight:500}
  .vcard .meta span{font-size:11.5px;color:var(--fg-dim)}
  .sizes{display:flex;align-items:flex-end;gap:26px;flex-wrap:wrap;padding:52px 22px 26px}
  .size{text-align:center}
  .size .cap{font-family:var(--mono);font-size:10px;letter-spacing:.1em;margin-top:9px}
  .panel.dark .size .cap{color:#5f7385}
  .panel.light .size .cap{color:#93a2b1}
  .ico{display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap}
  .ico .it{text-align:center}
  .ico img{display:block;box-shadow:0 0 0 1px rgba(255,255,255,.10)}
  .ico .cap{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--fg-faint);margin-top:9px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:760px){.cols{grid-template-columns:1fr}}
  .rule{border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel)}
  .rule .badge{font-family:var(--mono);font-size:10px;letter-spacing:.1em;padding:3px 8px;border-radius:5px;display:inline-block;margin-bottom:12px}
  .rule.ok .badge{background:rgba(0,201,167,.14);color:var(--mint)}
  .rule.no .badge{background:rgba(255,86,86,.14);color:#ff6b6b}
  .rule .demo{height:78px;display:flex;align-items:center;justify-content:center;background:var(--ink);border-radius:9px;margin-bottom:12px;overflow:hidden}
  .rule .demo svg{width:58px;height:58px;display:block}
  .rule p{margin:0;font-size:12.5px;color:var(--fg-dim)}
  .demo.stretch svg{width:84px;height:42px}
  .demo.rotate svg{transform:rotate(28deg)}
  .demo.glow svg{filter:drop-shadow(0 0 12px #00c9a7) drop-shadow(0 0 22px #0784c3)}
  .demo.recolor svg{filter:hue-rotate(230deg) saturate(1.6)}
  .demo.fade svg{opacity:.28}
  .demo.cram svg{width:58px;height:58px;padding:0;outline:1px solid #ff6b6b;outline-offset:-1px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line)}
  th{font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--fg-faint);font-weight:500}
  td.mono{font-family:var(--mono);font-size:12px}
  tbody tr:last-child td{border-bottom:none}
  .tbl{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--panel)}
  .swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  @media(max-width:760px){.swatches{grid-template-columns:repeat(2,1fr)}}
  .sw{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}
  .sw .chip{height:76px}
  .sw .meta{padding:11px 13px}
  .sw .meta b{display:block;font-size:12.5px;font-weight:600}
  .sw .meta span{font-family:var(--mono);font-size:11px;color:var(--fg-dim)}
  .files{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  @media(max-width:860px){.files{grid-template-columns:1fr 1fr}}
  .files a{font-family:var(--mono);font-size:11.5px;color:var(--fg-dim);text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--panel);display:flex;justify-content:space-between;gap:10px;transition:.15s}
  .files a:hover{color:var(--mint);border-color:var(--mint)}
  code{font-family:var(--mono);font-size:12.5px;background:#0d1319;border:1px solid var(--line);border-radius:5px;padding:2px 6px}
  .foot{margin-top:76px;padding-top:22px;border-top:1px solid var(--line);color:var(--fg-faint);font-size:12.5px;font-family:var(--mono)}
  .hint{font-size:12.5px;color:var(--fg-faint);margin-top:12px}
  .locked{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:6px 13px;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mint)}
</style>
</head>
<body>
<div class="wrap">
  <div class="kicker"><span class="dot"></span> NexChain · Logo Resmi</div>
  <h1>Nex Flow</h1>
  <p class="lede">Dua chevron mengarah maju — blok berikutnya. Ini marka resmi NexChain: terkunci, tidak ada varian lain yang dipakai untuk produksi.</p>
  <p style="margin-top:18px"><span class="locked">● Terkunci · v1</span></p>

  <section>
    <h2>01 — Lockup utama</h2>
    <div class="two">
      <div class="panel dark"><span class="lbl">Horizontal · gelap</span><div class="stage lk">${embed(lockupH(PAL.inverse, ''))}</div></div>
      <div class="panel light"><span class="lbl">Horizontal · terang</span><div class="stage lk">${embed(lockupH(PAL.light, ''))}</div></div>
    </div>
  </section>

  <section>
    <h2>02 — Semua varian</h2>
    <p class="sub">Sembilan bentuk jadi. Pakai yang sesuai latar; jangan membuat kombinasi baru di luar daftar ini.</p>
    <div class="variants">
      <div class="vcard"><div class="box dk">${embed(markSvg(PAL.inverse, ''))}</div><div class="meta"><b>nexchain-mark-inverse.svg</b><span>Marka · latar gelap</span></div></div>
      <div class="vcard"><div class="box lt">${embed(markSvg(PAL.light, ''))}</div><div class="meta"><b>nexchain-mark.svg</b><span>Marka · latar terang</span></div></div>
      <div class="vcard"><div class="box lt">${embed(markSvg(PAL.mono, ''))}</div><div class="meta"><b>nexchain-mark-mono.svg</b><span>Satu warna tinta</span></div></div>
      <div class="vcard"><div class="box dk">${embed(lockupH(PAL.inverse, ''))}</div><div class="meta"><b>nexchain-lockup-h-inverse.svg</b><span>Lockup H · latar gelap</span></div></div>
      <div class="vcard"><div class="box lt">${embed(lockupH(PAL.light, ''))}</div><div class="meta"><b>nexchain-lockup-h.svg</b><span>Lockup H · latar terang</span></div></div>
      <div class="vcard"><div class="box lt">${embed(lockupV(PAL.light, ''))}</div><div class="meta"><b>nexchain-lockup-v.svg</b><span>Lockup V · latar terang</span></div></div>
      <div class="vcard"><div class="box dk">${embed(lockupV(PAL.inverse, ''))}</div><div class="meta"><b>nexchain-lockup-v-inverse.svg</b><span>Lockup V · latar gelap</span></div></div>
      <div class="vcard"><div class="box lt">${embed(appIcon(PAL.inverse, '', 56))}</div><div class="meta"><b>nexchain-appicon.svg</b><span>App icon · radius 22%</span></div></div>
      <div class="vcard"><div class="box dk">${embed(faviconSvg(PAL.monoW, ''))}</div><div class="meta"><b>favicon.svg</b><span>Favicon 32 px</span></div></div>
    </div>
  </section>

  <section>
    <h2>03 — Uji ukuran</h2>
    <p class="sub">Minimum 16 px untuk marka, 96 px untuk lockup horizontal. Marka ini lulus 16 px karena hanya terdiri dari dua bentuk gemuk dengan jarak 28 px.</p>
    <div class="two">
      <div class="panel dark"><span class="lbl">Latar gelap</span><div class="sizes">
        ${[256, 128, 64, 32, 24, 16].map((s) => `<div class="size"><div style="width:${s}px;height:${s}px">${embed(markSvg(PAL.inverse, ''))}</div><div class="cap">${s} px</div></div>`).join('\n        ')}
      </div></div>
      <div class="panel light"><span class="lbl">Latar terang</span><div class="sizes">
        ${[256, 128, 64, 32, 24, 16].map((s) => `<div class="size"><div style="width:${s}px;height:${s}px">${embed(markSvg(PAL.light, ''))}</div><div class="cap">${s} px</div></div>`).join('\n        ')}
      </div></div>
    </div>
  </section>

  <section>
    <h2>04 — Ruang bebas</h2>
    <p class="sub">Ruang bebas minimum di keempat sisi = <b>x = 0,25 × tinggi marka</b>. Tidak ada teks, garis, tepi kontainer, atau marka lain yang boleh masuk ke kotak putus-putus.</p>
    <div class="two">
      <div class="panel light"><span class="lbl">Aturan x</span><div class="stage" style="padding:30px 16px 20px">${embed(clearSpaceSvg())}</div></div>
      <div class="panel dark"><span class="lbl">Ukuran minimum</span>
        <div style="padding:52px 18px 24px">
          <div class="tbl" style="border-color:#1e2732;background:transparent">
            <table>
              <thead><tr><th>Pemakaian</th><th class="mono">Digital</th><th class="mono">Cetak</th></tr></thead>
              <tbody>
                <tr><td>Marka saja</td><td class="mono">16 px</td><td class="mono">8 mm</td></tr>
                <tr><td>Lockup horizontal</td><td class="mono">96 px</td><td class="mono">24 mm</td></tr>
                <tr><td>Lockup vertikal</td><td class="mono">64 px</td><td class="mono">16 mm</td></tr>
                <tr><td>Favicon / ikon tab</td><td class="mono">16 px</td><td class="mono">—</td></tr>
                <tr><td>App icon</td><td class="mono">48 px</td><td class="mono">—</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>05 — Ikon terpasang</h2>
    <p class="sub">Raster di folder <code>icon/</code> sudah jadi — tinggal pakai. <code>apple-touch-icon.png</code> sengaja tanpa sudut karena iOS memotongnya sendiri; <code>favicon.ico</code> berisi 16, 32, dan 48 px.</p>
    <div class="panel dark">
      <span class="lbl">Set ikon</span>
      <div style="padding:54px 20px 26px" class="ico">
        <div class="it"><img src="icon/nexchain-appicon-512.png" width="96" height="96" style="border-radius:21.9%" alt="app icon 512"><div class="cap">512 PNG</div></div>
        <div class="it"><img src="icon/nexchain-appicon-192.png" width="64" height="64" style="border-radius:21.9%" alt="app icon 192"><div class="cap">192 PNG</div></div>
        <div class="it"><img src="icon/nexchain-apple-touch-icon.png" width="48" height="48" alt="apple touch"><div class="cap">apple-touch 180</div></div>
        <div class="it"><img src="icon/nexchain-appicon-1024.png" width="32" height="32" style="border-radius:21.9%" alt="app icon 32"><div class="cap">32</div></div>
        <div class="it" style="margin-left:auto">
          <div style="display:inline-flex;align-items:center;gap:9px;background:#2a2f36;border-radius:9px 9px 0 0;padding:9px 14px 9px 10px;font-size:12px;color:#cfd8e2">
            <img src="icon/favicon.svg" width="16" height="16" alt=""> NexChain Explorer
          </div>
          <div class="cap">tab browser</div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>06 — Boleh &amp; tidak</h2>
    <div class="cols">
      <div class="rule ok"><span class="badge">BOLEH</span><div class="demo">${embed(markSvg(PAL.inverse, ''))}</div><p>Skala proporsional, dua warna asli, ruang bebas utuh.</p></div>
      <div class="rule no"><span class="badge">JANGAN</span><div class="demo stretch">${embed(markSvg(PAL.inverse, ''))}</div><p>Jangan regangkan atau gepengkan. Selalu ubah ukuran secara proporsional.</p></div>
      <div class="rule no"><span class="badge">JANGAN</span><div class="demo rotate">${embed(markSvg(PAL.inverse, ''))}</div><p>Jangan memutar marka. Chevron selalu mengarah ke kanan.</p></div>
      <div class="rule no"><span class="badge">JANGAN</span><div class="demo glow">${embed(markSvg(PAL.inverse, ''))}</div><p>Jangan menambah glow, bayangan, atau gradien.</p></div>
      <div class="rule no"><span class="badge">JANGAN</span><div class="demo recolor">${embed(markSvg(PAL.inverse, ''))}</div><p>Jangan mengganti warna di luar token palet.</p></div>
      <div class="rule no"><span class="badge">JANGAN</span><div class="demo fade">${embed(markSvg(PAL.inverse, ''))}</div><p>Jangan menurunkan opasitas atau mengubahnya jadi outline tipis.</p></div>
    </div>
  </section>

  <section>
    <h2>07 — Warna</h2>
    <div class="swatches">
      <div class="sw"><div class="chip" style="background:#0784c3"></div><div class="meta"><b>Biru utama</b><span>#0784c3</span></div></div>
      <div class="sw"><div class="chip" style="background:#00c9a7"></div><div class="meta"><b>Mint aksen</b><span>#00c9a7</span></div></div>
      <div class="sw"><div class="chip" style="background:#05628f"></div><div class="meta"><b>Biru gelap</b><span>#05628f</span></div></div>
      <div class="sw"><div class="chip" style="background:#0b1620"></div><div class="meta"><b>Tinta / latar gelap</b><span>#0b1620</span></div></div>
    </div>
    <p class="hint">Di latar gelap biru utama diganti <code>#ffffff</code>; mint tetap. Alasannya kontras: <code>#0784c3</code> di atas <code>#0b1620</code> hanya ≈2,3:1 — di bawah ambang 3:1.</p>
  </section>

  <section>
    <h2>08 — Berkas</h2>
    <div class="files">
      ${[
        'mark/nexchain-mark.svg',
        'mark/nexchain-mark-inverse.svg',
        'mark/nexchain-mark-mono.svg',
        'mark/nexchain-mark-mono-white.svg',
        'lockup/nexchain-lockup-h.svg',
        'lockup/nexchain-lockup-h-inverse.svg',
        'lockup/nexchain-lockup-v.svg',
        'lockup/nexchain-lockup-v-inverse.svg',
        'lockup/nexchain-lockup-h-mono.svg',
        'icon/nexchain-appicon.svg',
        'icon/nexchain-appicon-flat.svg',
        'icon/favicon.svg',
        'icon/favicon.ico',
        'icon/nexchain-appicon-1024.png',
        'icon/nexchain-appicon-512.png',
        'icon/nexchain-appicon-192.png',
        'icon/nexchain-apple-touch-icon.png',
        'icon/nexchain-mark-1024.png',
        'icon/nexchain-mark-inverse-1024.png',
      ].map((f) => `<a href="${f}" download>${f}<span style="color:#5d6d7e">${f.endsWith('.svg') ? 'SVG' : f.endsWith('.ico') ? 'ICO' : 'PNG'}</span></a>`).join('\n      ')}
    </div>
    <p class="hint">Sumber kebenaran selalu SVG. PNG dan ICO adalah turunan — jangan disunting, dan jangan dipakai sebagai acuan bentuk.</p>
  </section>

  <div class="foot">NEXCHAIN · NEX FLOW · v1 · TERKUNCI</div>
</div>
</body>
</html>
`;

writeFileSync(join(HERE, 'preview.html'), PREVIEW, 'utf8');

/* ------------------------------------------------------------------ *
 * 9. Ringkasan
 * ------------------------------------------------------------------ */

const counts = { mark: 4, lockup: 5, icon: 0 };
counts.icon = CHROME ? 11 : 3;

console.log(`[nexchain-logo] mark/   ${counts.mark} berkas`);
console.log(`[nexchain-logo] lockup/ ${counts.lockup} berkas`);
console.log(`[nexchain-logo] icon/   ${counts.icon} berkas`);
console.log('[nexchain-logo] preview.html');
