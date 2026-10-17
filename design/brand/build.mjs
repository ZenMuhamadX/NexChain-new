#!/usr/bin/env node
/**
 * NexChain — logo system generator (single source of truth).
 *
 *   node design/brand/build.mjs
 *
 * Emits:
 *   design/brand/svg/<id>-*.svg   (mark / lockup / app icon / favicon, tiap konsep)
 *   design/brand/index.html       (brand sheet interaktif, semua SVG di-inline)
 *
 * Semua marka digambar di kanvas 256x256, murni path/rect/polygon — tanpa font
 * eksternal, tanpa gradien, tanpa filter. Wordmark NEXCHAIN dibangun dari
 * segmen garis pada grid 5x7 supaya bisa di-outline (bukan <text>).
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SVG_DIR = join(HERE, 'svg');

/* ------------------------------------------------------------------ *
 * 1. Token warna
 * ------------------------------------------------------------------ */

const C = {
  blue: '#0784c3', // biru utama — sama dengan token UI explorer/wallet/miner
  mint: '#00c9a7', // aksen
  deep: '#05628f', // biru gelap (bayangan)
  ink: '#0b1620', // gelap UI / tinta
  white: '#ffffff',
};

const PAL = {
  light: { a: C.blue, b: C.mint, c: C.deep }, // di atas latar terang
  inverse: { a: C.white, b: C.mint, c: C.blue }, // di atas latar gelap
  mono: { a: C.ink, b: C.ink, c: C.ink }, // satu warna, latar terang
  monoW: { a: C.white, b: C.white, c: C.white }, // satu warna, latar gelap
};

const r = (n, d = 2) => {
  const f = Math.pow(10, d);
  return String(Math.round(n * f) / f);
};

/* ------------------------------------------------------------------ *
 * 2. Konsep marka
 *
 *   box  = bounding box isi marka di dalam kanvas 256x256 (termasuk stroke)
 *   draw = (palette) => string markup SVG di dalam kanvas 256x256
 * ------------------------------------------------------------------ */

const CONCEPTS = [
  {
    id: 'nx-01',
    num: '01',
    name: 'Monogram N',
    tag: 'Huruf N geometris, diagonal mint',
    idea:
      'Huruf N dibentuk dari dua batang tegak dan satu diagonal yang berwarna mint. Diagonal digambar lebih dulu, batang biru menutupinya, sehingga yang terlihat hanya pita diagonal yang rapi tanpa sambungan.',
    why:
      'Pilihan paling aman. Siluet huruf pertama brand langsung terbaca, dan diagonal kontras memberi satu titik fokus tanpa menambah elemen baru. Legibilitas tertinggi di ukuran kecil.',
    caveat:
      'Huruf N dipakai sangat banyak brand lain. Tanpa aksen mint di diagonal, marka ini mudah tertukar dengan logo generik.',
    box: { x: 42, y: 40, w: 172, h: 176 },
    minPx: 16,
    minWhy: 'Tiga bidang solid dengan tepi lurus — tetap tajam bahkan di 16 px.',
    draw: (c) => `<polygon points="42,40 86,40 214,216 170,216" fill="${c.b}"/>
<rect x="42" y="40" width="44" height="176" fill="${c.a}"/>
<rect x="170" y="40" width="44" height="176" fill="${c.a}"/>`,
  },
  {
    id: 'nx-02',
    num: '02',
    name: 'Hex Core',
    tag: 'Heksagon + inti segitiga',
    idea:
      'Heksagon bergaris tebal sebagai cangkang blok, dengan segitiga terisi mint di tengahnya sebagai inti yang sudah tervalidasi. Dua elemen saja.',
    why:
      'Heksagon adalah bentuk paling ringkas untuk "blok", dan segitiga di dalamnya membawa arti konsensus (tiga hal yang saling menyetujui). Seimbang secara optis di semua arah.',
    caveat:
      'Heksagon sudah jadi pola umum di industri kripto. Nilai pembeda marka ini bertumpu pada proporsi inti, jadi jangan diubah sembarangan.',
    box: { x: 26.5, y: 39.1, w: 203, h: 177.8 },
    minPx: 24,
    minWhy: 'Garis heksagon setebal 15/256 hanya 0,94 px di ukuran 16 px, sehingga inti segitiga luntur. Di bawah 24 px pakai versi satu warna dan naikkan kontras latar.',
    draw: (c) => `<polygon points="222,128 175,209.4 81,209.4 34,128 81,46.6 175,46.6" fill="none" stroke="${c.a}" stroke-width="15" stroke-linejoin="miter"/>
<polygon points="128,82 88.16,151 167.84,151" fill="${c.b}"/>`,
  },
  {
    id: 'nx-03',
    num: '03',
    name: 'Satu Mata Rantai',
    tag: 'Mata rantai tunggal, miring 45°',
    idea:
      'Satu mata rantai utuh yang dimiringkan 45°, dengan ujung atas diberi warna mint sebagai penanda "sambungan berikutnya". Hanya satu bentuk.',
    why:
      'Metafor rantai paling langsung dan paling jujur: satu blok, satu mata rantai. Siluetnya tidak dimiliki marka lain di sini, dan tetap terbaca utuh bahkan di 16 px karena hanya satu objek.',
    caveat:
      'Bentuk oval miring mudah terlihat seperti ikon tautan/URL biasa kalau aksen mintnya dihilangkan.',
    box: { x: 36.8, y: 36.8, w: 182.4, h: 182.4 },
    minPx: 16,
    minWhy: 'Hanya satu objek dengan garis 18/256, jadi siluetnya masih utuh di 16 px.',
    draw: (c) => `<g transform="translate(128,128) rotate(45)">
<path d="M -43,-34 H 43 A 34,34 0 0 1 43,34 H -43 A 34,34 0 0 1 -43,-34 Z" fill="none" stroke="${c.a}" stroke-width="18"/>
<path d="M -43,-34 A 34,34 0 0 0 -43,34" fill="none" stroke="${c.b}" stroke-width="18"/>
</g>`,
  },
  {
    id: 'nx-04',
    num: '04',
    name: 'Tumpukan Blok',
    tag: 'Tiga bilah anak tangga',
    idea:
      'Tiga bilah bersudut tumpul disusun naik ke kanan, masing-masing bergeser 32 px. Bilah teratas berwarna mint sebagai blok terbaru.',
    why:
      'Siluet anak tangga langsung membaca "ledger yang bertambah", dan arahnya naik ke kanan seirama dengan arti nex = berikutnya. Bentuknya sangat sederhana sehingga aman di ukuran ekstrem.',
    caveat:
      'Tanpa aksen mint, tiga bilah ini bisa terlihat seperti ikon grafik batang. Proporsi geseran 32 px adalah bagian dari identitasnya.',
    box: { x: 32, y: 52, w: 192, h: 152 },
    minPx: 16,
    minWhy: 'Tiga bilah tebal 40/256; jarak antar bilah tetap terbaca sampai 16 px.',
    draw: (c) => `<rect x="32" y="164" width="128" height="40" rx="12" fill="${c.a}"/>
<rect x="64" y="108" width="128" height="40" rx="12" fill="${c.a}"/>
<rect x="96" y="52" width="128" height="40" rx="12" fill="${c.b}"/>`,
  },
  {
    id: 'nx-05',
    num: '05',
    name: 'Nex Flow',
    tag: 'Dua chevron maju',
    idea:
      'Dua chevron tebal mengarah ke kanan, yang kedua berwarna mint. Sudut 62° dipilih supaya ujungnya tetap tumpul, bukan runcing seperti ikon media player.',
    why:
      'Marka paling ringkas dan paling netral secara makna: bergerak maju, blok berikutnya. Sangat mudah dipasangkan dengan tipografi apa pun dan sangat kuat sebagai ikon kecil.',
    caveat:
      'Chevron ganda punya kemiripan keluarga dengan ikon fast-forward. Jarak antar chevron 28 px wajib dijaga supaya tetap terbaca sebagai dua elemen.',
    box: { x: 30, y: 48, w: 196.1, h: 160 },
    minPx: 16,
    minWhy: 'Dua bentuk gemuk dengan sudut tumpul; jarak 28 px antar chevron tetap terbaca di 16 px.',
    locked: true,
    draw: (c) => `<path d="M -34,-64 L 0,0 L -34,64" transform="translate(80,128)" fill="none" stroke="${c.a}" stroke-width="32" stroke-linejoin="miter" stroke-linecap="butt"/>
<path d="M -34,-64 L 0,0 L -34,64" transform="translate(192,128)" fill="none" stroke="${c.b}" stroke-width="32" stroke-linejoin="miter" stroke-linecap="butt"/>`,
  },
];

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

function placedMark(concept, pal, targetMax, cx, cy) {
  const b = concept.box;
  const s = targetMax / Math.max(b.w, b.h);
  const tx = cx - (b.x + b.w / 2) * s;
  const ty = cy - (b.y + b.h / 2) * s;
  return `<g transform="translate(${r(tx)},${r(ty)}) scale(${r(s, 5)})">\n${indent(concept.draw(pal), 1)}\n</g>`;
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

function markSvg(concept, pal, label) {
  return svg('0 0 256 256', concept.draw(pal), label, 256, 256);
}

function lockupH(concept, pal, label) {
  const W = 380;
  const H = 100;
  const body = [
    placedMark(concept, pal, 100, 50, 50),
    placedWordmark(pal, 4.5, 134 + (54.6 * 4.5) / 2, 50),
  ].join('\n');
  return svg(`0 0 ${W} ${H}`, body, label, W, H);
}

function lockupV(concept, pal, label) {
  const W = 246;
  const H = 160;
  const body = [
    placedMark(concept, pal, 100, W / 2, 50),
    placedWordmark(pal, 4.5, W / 2, 142),
  ].join('\n');
  return svg(`0 0 ${W} ${H}`, body, label, W, H);
}

function appIcon(concept, pal, label) {
  const body = `<rect width="256" height="256" rx="56" fill="${C.ink}"/>\n${placedMark(concept, pal, 140, 128, 128)}`;
  return svg('0 0 256 256', body, label, 256, 256);
}

function favicon(concept, pal, label) {
  const body = `<rect width="32" height="32" rx="7" fill="${C.ink}"/>\n${placedMark(concept, pal, 21, 16, 16)}`;
  return svg('0 0 32 32', body, label, 32, 32);
}

function clearSpace(concept) {
  const b = concept.box;
  const p = 0.25 * b.h; // clear space = 0.25 x tinggi marka
  const x0 = b.x - p;
  const y0 = b.y - p;
  const x1 = b.x + b.w + p;
  const y1 = b.y + b.h + p;
  const m = 26;
  const vx = x0 - m;
  const vy = y0 - m;
  const vw = x1 - x0 + m * 2;
  const vh = y1 - y0 + m * 2;
  const tick = Math.min(b.w, b.h) * 0.16;
  const body = `${concept.draw(PAL.mono)}
<g fill="none" stroke="${C.blue}" stroke-width="1.6" stroke-dasharray="7 6">
  <rect x="${r(x0)}" y="${r(y0)}" width="${r(x1 - x0)}" height="${r(y1 - y0)}"/>
</g>
<g fill="none" stroke="${C.mint}" stroke-width="2">
  <path d="M ${r(b.x)} ${r(y0)} v ${r(tick)} M ${r(b.x)} ${r(y0)} h ${r(tick)}"/>
  <path d="M ${r(b.x + b.w)} ${r(y0)} v ${r(tick)} M ${r(b.x + b.w)} ${r(y0)} h -${r(tick)}"/>
  <path d="M ${r(b.x)} ${r(y1)} v -${r(tick)} M ${r(b.x)} ${r(y1)} h ${r(tick)}"/>
  <path d="M ${r(b.x + b.w)} ${r(y1)} v -${r(tick)} M ${r(b.x + b.w)} ${r(y1)} h -${r(tick)}"/>
</g>`;
  return svg(`${r(vx)} ${r(vy)} ${r(vw)} ${r(vh)}`, body, `Clear space — ${concept.name}`, vw, vh);
}

function indent(str, n) {
  const pad = '  '.repeat(n);
  return str
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
}

/** Ubah SVG file (punya width/height absolut) jadi SVG yang mengisi kontainernya. */
function embed(str) {
  return str.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="100%"');
}

/* ------------------------------------------------------------------ *
 * 5. Tulis file SVG
 * ------------------------------------------------------------------ */

function writeSvg(name, content) {
  writeFileSync(join(SVG_DIR, name), content, 'utf8');
}

rmSync(SVG_DIR, { recursive: true, force: true });
mkdirSync(SVG_DIR, { recursive: true });

const BUNDLE = [];

for (const c of CONCEPTS) {
  const files = [];
  const add = (name, content) => {
    writeSvg(name, content);
    files.push({ name, href: `svg/${name}` });
  };

  add(`${c.id}-mark.svg`, markSvg(c, PAL.light, `NexChain ${c.name} — marka, latar terang`));
  add(`${c.id}-mark-inverse.svg`, markSvg(c, PAL.inverse, `NexChain ${c.name} — marka, latar gelap`));
  add(`${c.id}-mark-mono.svg`, markSvg(c, PAL.mono, `NexChain ${c.name} — marka satu warna`));
  add(`${c.id}-lockup-h.svg`, lockupH(c, PAL.light, `NexChain ${c.name} — lockup horizontal`));
  add(`${c.id}-lockup-h-inverse.svg`, lockupH(c, PAL.inverse, `NexChain ${c.name} — lockup horizontal, latar gelap`));
  add(`${c.id}-lockup-v.svg`, lockupV(c, PAL.light, `NexChain ${c.name} — lockup vertikal`));
  add(`${c.id}-lockup-v-inverse.svg`, lockupV(c, PAL.inverse, `NexChain ${c.name} — lockup vertikal, latar gelap`));
  add(`${c.id}-appicon.svg`, appIcon(c, PAL.inverse, `NexChain ${c.name} — app icon`));
  add(`${c.id}-favicon.svg`, favicon(c, PAL.monoW, `NexChain ${c.name} — favicon`));

  BUNDLE.push({
    id: c.id,
    num: c.num,
    name: c.name,
    tag: c.tag,
    idea: c.idea,
    why: c.why,
    caveat: c.caveat,
    ratio: `${r(c.box.w)} × ${r(c.box.h)}`,
    locked: !!c.locked,
    minPx: c.minPx,
    minWhy: c.minWhy,
    markLight: embed(markSvg(c, PAL.light, '')),
    markDark: embed(markSvg(c, PAL.inverse, '')),
    markMono: embed(markSvg(c, PAL.mono, '')),
    lockupHDark: embed(lockupH(c, PAL.inverse, '')),
    lockupHLight: embed(lockupH(c, PAL.light, '')),
    lockupVDark: embed(lockupV(c, PAL.inverse, '')),
    lockupVLight: embed(lockupV(c, PAL.light, '')),
    app: embed(appIcon(c, PAL.inverse, '')),
    fav: embed(favicon(c, PAL.monoW, '')),
    clear: embed(clearSpace(c)),
    files,
  });
}

/* ------------------------------------------------------------------ *
 * 6. Brand sheet
 * ------------------------------------------------------------------ */

const DATA_JSON = JSON.stringify(BUNDLE).replace(/<\//g, '<\\/');

const HTML = `<!DOCTYPE html>
<html lang="id" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NexChain — Standarisasi Logo</title>
<style>
  :root {
    --bg:#0a0e13; --panel:#111821; --panel-2:#0d1319; --line:#1e2732;
    --fg:#e8eef6; --fg-dim:#8ea0b3; --fg-faint:#5d6d7e;
    --blue:#0784c3; --mint:#00c9a7; --deep:#05628f; --ink:#0b1620;
    --light-bg:#f6f8fa; --light-panel:#ffffff; --light-fg:#0b1620; --light-dim:#5a6a7a;
    --radius:14px;
    --sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  }
  :root[data-theme="light"] {
    --bg:#f2f5f8; --panel:#ffffff; --panel-2:#f8fafc; --line:#e2e8ee;
    --fg:#0b1620; --fg-dim:#5a6a7a; --fg-faint:#8a99a8;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; }
  body {
    background:var(--bg); color:var(--fg); font-family:var(--sans);
    font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:1120px; margin:0 auto; padding:56px 28px 120px; }

  .kicker {
    font-family:var(--mono); font-size:11px; letter-spacing:.16em;
    text-transform:uppercase; color:var(--fg-dim); display:flex; align-items:center; gap:10px;
  }
  .kicker .dot { width:7px; height:7px; border-radius:2px; background:var(--mint); display:inline-block; }
  h1 { font-size:clamp(30px,4.6vw,46px); line-height:1.1; margin:18px 0 14px; letter-spacing:-.02em; font-weight:600; }
  .lede { max-width:62ch; color:var(--fg-dim); margin:0 0 22px; }
  h2 {
    font-family:var(--mono); font-size:12px; letter-spacing:.16em; text-transform:uppercase;
    color:var(--fg-dim); font-weight:500; margin:0 0 6px;
  }
  h3 { font-size:22px; margin:0; letter-spacing:-.01em; font-weight:600; }
  h4 { font-family:var(--mono); font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--fg-faint); margin:0 0 6px; font-weight:500; }
  section { margin-top:64px; }
  .sub { color:var(--fg-dim); margin:6px 0 22px; max-width:66ch; font-size:14px; }

  .ghost {
    position:absolute; top:56px; right:28px;
    background:transparent; border:1px solid var(--line); color:var(--fg-dim);
    font-family:var(--mono); font-size:11px; letter-spacing:.1em; text-transform:uppercase;
    padding:9px 14px; border-radius:999px; cursor:pointer; transition:.15s;
  }
  .ghost:hover { color:var(--fg); border-color:var(--fg-faint); }
  header.top { position:relative; }

  /* konsep */
  .grid { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
  @media (max-width:900px){ .grid { grid-template-columns:repeat(2,1fr); } }
  .card {
    text-align:left; cursor:pointer; border:1px solid var(--line); background:var(--panel);
    border-radius:var(--radius); padding:14px; color:var(--fg); transition:.16s; font:inherit;
    display:flex; flex-direction:column; gap:10px;
  }
  .card:hover { border-color:var(--fg-faint); transform:translateY(-2px); }
  .card[aria-pressed="true"] { border-color:var(--mint); background:var(--panel-2); box-shadow:0 0 0 1px var(--mint) inset; }
  .card .thumb {
    background:var(--ink); border-radius:9px; height:104px; display:flex; align-items:center; justify-content:center; padding:16px;
  }
  .card .thumb svg { display:block; }
  .card .n { font-family:var(--mono); font-size:10.5px; letter-spacing:.14em; color:var(--fg-faint); }
  .card .pick {
    background:rgba(0,201,167,.14); color:var(--mint); border-radius:4px;
    padding:2px 6px; margin-left:6px; font-size:9.5px; letter-spacing:.1em;
  }
  .card .nm { font-size:13.5px; font-weight:600; }
  .card .tg { font-size:11.5px; color:var(--fg-dim); line-height:1.45; }

  /* panel */
  .two { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:760px){ .two { grid-template-columns:1fr; } }
  .panel { border:1px solid var(--line); border-radius:var(--radius); padding:16px; position:relative; overflow:hidden; }
  .panel.dark { background:var(--ink); border-color:#1b2733; }
  .panel.light { background:var(--light-panel); border-color:#e4e9ee; }
  .panel .lbl {
    position:absolute; top:12px; left:16px; font-family:var(--mono); font-size:10px;
    letter-spacing:.13em; text-transform:uppercase;
  }
  .panel.dark .lbl { color:#5f7385; }
  .panel.light .lbl { color:#93a2b1; }
  .stage { display:flex; align-items:center; justify-content:center; padding:44px 16px 22px; }
  .stage svg { display:block; }
  .stage.hero { height:300px; }
  .stage.hero svg { width:190px; height:190px; }
  .stage.lockup { height:150px; }
  .stage.lockup svg { width:100%; max-width:430px; height:auto; }
  .stage.lockupv { height:210px; }
  .stage.lockupv svg { width:100%; max-width:215px; height:auto; }

  .notes { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:14px; }
  @media (max-width:820px){ .notes { grid-template-columns:1fr; } }
  .notes > div { border:1px solid var(--line); border-radius:var(--radius); padding:16px; background:var(--panel); }
  .notes p { margin:0; font-size:13.5px; color:var(--fg-dim); }

  .stack { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:760px){ .stack { grid-template-columns:1fr; } }

  /* ukuran */
  .sizes { display:flex; align-items:flex-end; gap:30px; flex-wrap:wrap; padding:56px 22px 26px; }
  .size { text-align:center; }
  .size .box { display:flex; align-items:center; justify-content:center; }
  .size .cap { font-family:var(--mono); font-size:10px; letter-spacing:.1em; margin-top:10px; }
  .panel.dark .size .cap { color:#5f7385; }
  .panel.light .size .cap { color:#93a2b1; }

  /* app icon */
  .apps { display:flex; gap:22px; align-items:flex-end; flex-wrap:wrap; }
  .appitem { text-align:center; }
  .appitem .cap { font-family:var(--mono); font-size:10px; letter-spacing:.1em; color:var(--fg-faint); margin-top:9px; }
  .slot { border-radius:21.9%; box-shadow:0 0 0 1px rgba(255,255,255,.10); overflow:hidden; display:flex; align-items:center; justify-content:center; }
  .slot svg { display:block; width:100%; height:100%; }
  .tabmock {
    display:inline-flex; align-items:center; gap:9px; background:#2a2f36; border-radius:9px 9px 0 0;
    padding:9px 14px 9px 10px; font-size:12px; color:#cfd8e2;
  }
  .tabmock .fav { width:16px; height:16px; }
  .tabmock .fav svg { display:block; width:16px; height:16px; }

  /* daftar aturan */
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:760px){ .cols { grid-template-columns:1fr; } }
  .rule { border:1px solid var(--line); border-radius:var(--radius); padding:16px; background:var(--panel); }
  .rule .top { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
  .rule .badge { font-family:var(--mono); font-size:10px; letter-spacing:.1em; padding:3px 8px; border-radius:5px; }
  .rule.ok .badge { background:rgba(0,201,167,.14); color:var(--mint); }
  .rule.no .badge { background:rgba(255,86,86,.14); color:#ff6b6b; }
  .rule .demo { height:78px; display:flex; align-items:center; justify-content:center; background:var(--ink); border-radius:9px; margin-bottom:12px; overflow:hidden; }
  .rule .demo svg { width:54px; height:54px; display:block; }
  .rule p { margin:0; font-size:12.5px; color:var(--fg-dim); }
  .demo.stretch svg { width:78px; height:40px; }
  .demo.rotate svg { transform:rotate(28deg); }
  .demo.glow svg { filter:drop-shadow(0 0 12px #00c9a7) drop-shadow(0 0 22px #0784c3); }
  .demo.outline svg { opacity:.28; }
  .demo.recolor svg { filter:hue-rotate(210deg) saturate(1.5); }
  .demo.wronggap svg { width:44px; height:44px; }

  /* tabel */
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th, td { text-align:left; padding:11px 14px; border-bottom:1px solid var(--line); }
  th { font-family:var(--mono); font-size:10.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--fg-faint); font-weight:500; }
  td.mono, th.mono { font-family:var(--mono); font-size:12px; }
  tbody tr:last-child td { border-bottom:none; }
  .tbl { border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; background:var(--panel); }

  /* swatch */
  .swatches { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  @media (max-width:760px){ .swatches { grid-template-columns:repeat(2,1fr); } }
  .sw { border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; background:var(--panel); }
  .sw .chip { height:82px; }
  .sw .meta { padding:11px 13px; }
  .sw .meta b { display:block; font-size:12.5px; font-weight:600; }
  .sw .meta span { font-family:var(--mono); font-size:11px; color:var(--fg-dim); }

  /* file list */
  .files { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  @media (max-width:860px){ .files { grid-template-columns:1fr 1fr; } }
  .files a {
    font-family:var(--mono); font-size:11.5px; color:var(--fg-dim); text-decoration:none;
    border:1px solid var(--line); border-radius:9px; padding:10px 12px; background:var(--panel);
    display:flex; justify-content:space-between; gap:10px; transition:.15s;
  }
  .files a:hover { color:var(--mint); border-color:var(--mint); }
  .files a .dl { color:var(--fg-faint); }

  code { font-family:var(--mono); font-size:12.5px; background:var(--panel-2); border:1px solid var(--line); border-radius:5px; padding:2px 6px; }
  .foot { margin-top:80px; padding-top:22px; border-top:1px solid var(--line); color:var(--fg-faint); font-size:12.5px; font-family:var(--mono); }
  .hint { font-size:12.5px; color:var(--fg-faint); margin-top:12px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="kicker"><span class="dot"></span> NexChain · Logo System v1</div>
    <h1>Standarisasi Logo</h1>
    <p class="lede">Lima arah marka, satu sistem aturan. Semua marka murni vektor — dua warna, tanpa gradien, tanpa bayangan, tanpa efek. Setiap marka diuji tetap terbaca di 16 px dan tetap utuh saat dicetak satu warna. <b style="color:var(--mint);font-weight:500">Arah 05 (Nex Flow) sudah dipilih</b> — set produksinya ada di <code>design/nexchain-logo/</code>.</p>
    <button class="ghost" id="theme">Tema: Gelap</button>
  </header>

  <section>
    <h2>01 — Pilih arah</h2>
    <p class="sub">Klik satu kartu. Seluruh halaman di bawah mengikuti pilihan itu, termasuk berkas SVG yang bisa diunduh.</p>
    <div class="grid" id="grid"></div>
  </section>

  <section>
    <h2>02 — Detail arah terpilih</h2>
    <div class="two" style="margin-bottom:14px">
      <div><h3 id="d-name">—</h3><p class="sub" id="d-tag" style="margin:4px 0 0"></p></div>
      <p class="sub" style="margin:0;text-align:right;font-family:var(--mono);font-size:12px" id="d-ratio"></p>
    </div>
    <div class="two">
      <div class="panel dark"><span class="lbl">Latar gelap</span><div class="stage hero" id="hero-dark"></div></div>
      <div class="panel light"><span class="lbl">Latar terang</span><div class="stage hero" id="hero-light"></div></div>
    </div>
    <div class="notes">
      <div><h4>Bentuk</h4><p id="d-idea"></p></div>
      <div><h4>Kenapa cocok</h4><p id="d-why"></p></div>
      <div><h4>Risiko</h4><p id="d-caveat"></p></div>
    </div>
  </section>

  <section>
    <h2>03 — Lockup</h2>
    <p class="sub">Marka + wordmark NEXCHAIN. Wordmark dibangun dari segmen garis pada grid 5×7 dan sudah di-outline, jadi tidak bergantung pada font apa pun. Tinggi kapital wordmark = 0,36 × tinggi marka; jarak marka ke wordmark = 0,34 × tinggi marka.</p>
    <div class="stack">
      <div class="panel dark"><span class="lbl">Horizontal · gelap</span><div class="stage lockup" id="lh-dark"></div></div>
      <div class="panel light"><span class="lbl">Horizontal · terang</span><div class="stage lockup" id="lh-light"></div></div>
      <div class="panel dark"><span class="lbl">Vertikal · gelap</span><div class="stage lockupv" id="lv-dark"></div></div>
      <div class="panel light"><span class="lbl">Vertikal · terang</span><div class="stage lockupv" id="lv-light"></div></div>
    </div>
  </section>

  <section>
    <h2>04 — Uji ukuran</h2>
    <p class="sub">Ukuran minimum global: <b>16 px</b> untuk marka digital, <b>96 px</b> untuk lockup horizontal, <b>8 mm</b> untuk cetak. Untuk arah terpilih: <b id="min-px">16 px</b> — <span id="min-why"></span></p>
    <div class="two">
      <div class="panel dark"><span class="lbl">Latar gelap</span><div class="sizes" id="sizes-dark"></div></div>
      <div class="panel light"><span class="lbl">Latar terang</span><div class="sizes" id="sizes-light"></div></div>
    </div>
  </section>

  <section>
    <h2>05 — Ruang bebas (clear space)</h2>
    <p class="sub">Ruang bebas minimum di semua sisi = <b>x = 0,25 × tinggi marka</b>. Tidak ada elemen lain — teks, garis, tepi kontainer, atau marka lain — yang boleh masuk ke dalam kotak putus-putus ini.</p>
    <div class="two">
      <div class="panel light"><span class="lbl">Aturan x</span><div class="stage" id="clear" style="padding:30px 16px 20px"></div></div>
      <div class="panel dark">
        <span class="lbl">Ukuran minimum</span>
        <div class="stage" style="padding:56px 22px 26px;display:block">
          <div class="tbl" style="border-color:#1e2732;background:transparent">
            <table>
              <thead><tr><th>Pemakaian</th><th class="mono">Min. digital</th><th class="mono">Min. cetak</th></tr></thead>
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
    <h2>06 — Ikon aplikasi &amp; favicon</h2>
    <p class="sub">App icon memakai sudut 56/256 (≈22% radius) di atas latar tinta <code>#0b1620</code>. Favicon memakai bentuk yang sama pada 32 px dengan radius 7/32.</p>
    <div class="panel dark">
      <span class="lbl">App icon</span>
      <div class="stage" style="padding:56px 22px 30px;display:block">
        <div class="apps">
          <div class="appitem"><div class="slot" id="app-256" style="width:128px;height:128px"></div><div class="cap">128 px</div></div>
          <div class="appitem"><div class="slot" id="app-64" style="width:64px;height:64px"></div><div class="cap">64 px</div></div>
          <div class="appitem"><div class="slot" id="app-48" style="width:48px;height:48px"></div><div class="cap">48 px</div></div>
          <div class="appitem" style="margin-left:auto">
            <div class="tabmock"><span class="fav" id="fav-16"></span> NexChain Explorer</div>
            <div class="cap">tab browser</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>07 — Yang boleh &amp; yang tidak</h2>
    <p class="sub">Semua contoh di bawah memakai marka arah terpilih, di atas latar tinta.</p>
    <div class="cols">
      <div class="rule ok"><div class="top"><span class="badge">BOLEH</span></div><div class="demo" id="ok-1"></div><p>Skala proporsional, dua warna asli, ruang bebas utuh.</p></div>
      <div class="rule no"><div class="top"><span class="badge">JANGAN</span></div><div class="demo stretch" id="no-1"></div><p>Jangan regangkan atau gepengkan. Selalu ubah ukuran secara proporsional.</p></div>
      <div class="rule no"><div class="top"><span class="badge">JANGAN</span></div><div class="demo rotate" id="no-2"></div><p>Jangan memutar marka. Sudut aslinya bagian dari identitas.</p></div>
      <div class="rule no"><div class="top"><span class="badge">JANGAN</span></div><div class="demo glow" id="no-3"></div><p>Jangan menambah glow, bayangan, atau gradien. Marka harus tetap datar.</p></div>
      <div class="rule no"><div class="top"><span class="badge">JANGAN</span></div><div class="demo recolor" id="no-4"></div><p>Jangan mengganti warna di luar token palet yang ditetapkan.</p></div>
      <div class="rule no"><div class="top"><span class="badge">JANGAN</span></div><div class="demo outline" id="no-5"></div><p>Jangan menurunkan opasitas atau mengubahnya jadi outline tipis.</p></div>
    </div>
  </section>

  <section>
    <h2>08 — Palet</h2>
    <p class="sub">Empat token ini sudah dipakai di explorer, wallet, dan miner-ui. Logo tidak menambah warna baru.</p>
    <div class="swatches">
      <div class="sw"><div class="chip" style="background:#0784c3"></div><div class="meta"><b>Biru utama</b><span>#0784c3</span></div></div>
      <div class="sw"><div class="chip" style="background:#00c9a7"></div><div class="meta"><b>Mint aksen</b><span>#00c9a7</span></div></div>
      <div class="sw"><div class="chip" style="background:#05628f"></div><div class="meta"><b>Biru gelap</b><span>#05628f</span></div></div>
      <div class="sw"><div class="chip" style="background:#0b1620;border-bottom:1px solid var(--line)"></div><div class="meta"><b>Tinta / latar gelap</b><span>#0b1620</span></div></div>
    </div>
    <p class="hint">Aturan warna: di latar terang pakai <code>#0784c3</code> + <code>#00c9a7</code>. Di latar gelap ganti biru utama menjadi <code>#ffffff</code>, aksen mint tetap. Versi satu warna memakai <code>#0b1620</code> (latar terang) atau <code>#ffffff</code> (latar gelap).</p>
  </section>

  <section>
    <h2>09 — Berkas</h2>
    <p class="sub">Semua berkas SVG mandiri, <code>viewBox</code> rapi, tanpa dependensi. Klik untuk mengunduh.</p>
    <div class="files" id="files"></div>
    <p class="hint">Pola penamaan: <code>nx-&lt;nomor&gt;-&lt;jumlah&gt;[-inverse|-mono].svg</code> — contoh <code>nx-03-lockup-h-inverse.svg</code>. Kata <code>inverse</code> berarti versi untuk latar gelap, <code>mono</code> berarti satu warna.</p>
  </section>

  <section>
    <h2>10 — Di mana dipakai</h2>
    <div class="tbl">
      <table>
        <thead><tr><th>Permukaan</th><th>Berkas</th><th class="mono">Tinggi</th></tr></thead>
        <tbody>
          <tr><td>Header <code>explorer/</code></td><td class="mono">lockup-h-inverse</td><td class="mono">28 px</td></tr>
          <tr><td>Header <code>wallet/</code> &amp; <code>wallet-ui/</code></td><td class="mono">lockup-h</td><td class="mono">28 px</td></tr>
          <tr><td><code>miner-ui/</code> sidebar</td><td class="mono">mark-inverse</td><td class="mono">32 px</td></tr>
          <tr><td>Favicon tiap UI</td><td class="mono">favicon</td><td class="mono">16 / 32 px</td></tr>
          <tr><td>README &amp; docs (latar terang)</td><td class="mono">lockup-h</td><td class="mono">40 px</td></tr>
          <tr><td>README gelap / GitHub dark</td><td class="mono">lockup-h-inverse</td><td class="mono">40 px</td></tr>
          <tr><td>App icon / PWA</td><td class="mono">appicon</td><td class="mono">192–512 px</td></tr>
          <tr><td>Stempel, ukir, sablon satu warna</td><td class="mono">mark-mono</td><td class="mono">≥ 8 mm</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div class="foot">NEXCHAIN · LOGO SYSTEM v1 · 5 ARAH · SVG MURNI VEKTOR</div>
</div>

<script id="nx-data" type="application/json">${DATA_JSON}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('nx-data').textContent);
  var SIZES = [256, 128, 64, 32, 16];
  var current = 0;

  function $(id) { return document.getElementById(id); }
  function set(id, html) { var el = $(id); if (el) el.innerHTML = html; }

  function cardHtml(c, i) {
    return '<button class="card" data-i="' + i + '" aria-pressed="false">' +
      '<div class="thumb">' + c.markDark + '</div>' +
      '<div class="n">' + c.num + (c.locked ? ' <span class="pick">DIPILIH</span>' : '') + '</div>' +
      '<div class="nm">' + c.name + '</div>' +
      '<div class="tg">' + c.tag + '</div>' +
      '</button>';
  }

  function sizeHtml(mark) {
    var out = '';
    for (var i = 0; i < SIZES.length; i++) {
      var s = SIZES[i];
      out += '<div class="size"><div class="box" style="width:' + s + 'px;height:' + s + 'px">' +
        mark + '</div><div class="cap">' + s + ' px</div></div>';
    }
    return out;
  }

  function fileHtml(c) {
    var out = '';
    for (var i = 0; i < c.files.length; i++) {
      var f = c.files[i];
      out += '<a href="' + f.href + '" download>' + f.name + '<span class="dl">SVG</span></a>';
    }
    return out;
  }

  function render(i) {
    current = i;
    var c = DATA[i];
    var cards = document.querySelectorAll('.card');
    for (var k = 0; k < cards.length; k++) {
      cards[k].setAttribute('aria-pressed', String(Number(cards[k].getAttribute('data-i')) === i));
    }
    $('d-name').textContent = c.num + ' · ' + c.name;
    $('d-tag').textContent = c.tag;
    $('d-ratio').textContent = 'kanvas 256 × 256 · isi ' + c.ratio;
    $('d-idea').textContent = c.idea;
    $('d-why').textContent = c.why;
    $('d-caveat').textContent = c.caveat;
    $('min-px').textContent = c.minPx + ' px';
    $('min-why').textContent = c.minWhy;

    set('hero-dark', c.markDark);
    set('hero-light', c.markLight);
    set('lh-dark', c.lockupHDark);
    set('lh-light', c.lockupHLight);
    set('lv-dark', c.lockupVDark);
    set('lv-light', c.lockupVLight);
    set('sizes-dark', sizeHtml(c.markDark));
    set('sizes-light', sizeHtml(c.markLight));
    set('clear', c.clear);
    set('app-256', c.app);
    set('app-64', c.app);
    set('app-48', c.app);
    set('fav-16', c.fav);
    set('ok-1', c.markDark);
    set('no-1', c.markDark);
    set('no-2', c.markDark);
    set('no-3', c.markDark);
    set('no-4', c.markDark);
    set('no-5', c.markDark);
    set('files', fileHtml(c));

    // demo "regangkan" hanya meyakinkan kalau rasionya benar-benar dipaksa
    var st = document.querySelector('#no-1 svg');
    if (st) st.setAttribute('preserveAspectRatio', 'none');
  }

  var grid = $('grid');
  var html = '';
  for (var i = 0; i < DATA.length; i++) html += cardHtml(DATA[i], i);
  grid.innerHTML = html;
  grid.addEventListener('click', function (e) {
    var btn = e.target.closest('.card');
    if (btn) render(Number(btn.getAttribute('data-i')));
  });

  var themeBtn = $('theme');
  themeBtn.addEventListener('click', function () {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'dark' : 'light');
    themeBtn.textContent = 'Tema: ' + (light ? 'Gelap' : 'Terang');
  });

  render(0);
})();
</script>
</body>
</html>
`;

writeFileSync(join(HERE, 'index.html'), HTML, 'utf8');

const svgCount = readdirSync(SVG_DIR).length;
console.log(`[brand] ${svgCount} berkas SVG -> design/brand/svg/`);
console.log('[brand] brand sheet    -> design/brand/index.html');
