// Generates the PROP PANIC logo kit as self-contained SVGs (text outlined from Fredoka 700, so no font is needed to display them).
// One-off tool; its deps are not in package.json. Run from the repo root:
//   npm i --no-save opentype.js @fontsource/fredoka && node tools/brand-logo.cjs
const opentype = require('opentype.js');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'client/public/brand';
fs.mkdirSync(OUT, { recursive: true });
const buf = fs.readFileSync(require.resolve('@fontsource/fredoka/files/fredoka-latin-700-normal.woff'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));

const C = { navy: '#1b2a4a', navy2: '#16213e', ink: '#22223b', yellow: '#ffd166', yellowD: '#f2b632', pink: '#ef476f', pinkD: '#c9305a', teal: '#2ec4b6', cyan: '#5fe0ff', white: '#ffffff' };
const r1 = (n) => Math.round(n * 10) / 10;
const pd = (p) => p.commands.map((c) => c.type === 'Z' ? 'Z' : c.type + (c.type === 'Q' ? [c.x1, c.y1, c.x, c.y] : c.type === 'C' ? [c.x1, c.y1, c.x2, c.y2, c.x, c.y] : [c.x, c.y]).map(r1).join(' ')).join('');

// ---------- glyph layout ----------
// items: { ch } or { eye: true }. Returns { parts: [{d, kind, cx, cy, r}], width }.
function layoutWord(items, size, opts = {}) {
  const k = size / font.unitsPerEm;
  const cap = 700 * k;
  const track = (opts.track ?? 0.01) * size;
  const bounce = opts.bounce || [];
  let x = 0;
  const parts = [];
  items.forEach((it, i) => {
    const b = bounce[i] || [0, 0];
    if (it.eye) {
      const R = cap * 0.56;
      const cx = x + R + size * 0.02, cy = -cap / 2 + b[0];
      parts.push({ kind: 'eye', cx, cy, R, rot: b[1] });
      x += 2 * R + size * 0.04 + track;
      return;
    }
    const g = font.charToGlyph(it.ch);
    const p = g.getPath(x, b[0], size);
    const bb = g.getBoundingBox();
    const cx = x + ((bb.x1 + bb.x2) / 2) * k, cy = -cap / 2 + b[0];
    parts.push({ kind: 'glyph', d: pd(p), cx, cy, rot: b[1] });
    x += g.advanceWidth * k + track;
  });
  return { parts, width: x - track, cap };
}

function eyeSVG(e, fill, stroke, sw, pupil = [0.3, 0.32]) {
  const pr = e.R * 0.47;
  const px = e.cx + e.R * pupil[0], py = e.cy + e.R * pupil[1];
  if (fill === 'none') // one-colour: ring + pupil, no highlight
    return `<circle cx="${r1(e.cx)}" cy="${r1(e.cy)}" r="${r1(e.R - 9)}" fill="none" stroke="${stroke}" stroke-width="18"/>` +
      `<circle cx="${r1(px - e.R * 0.04)}" cy="${r1(py - e.R * 0.04)}" r="${r1(pr)}" fill="${stroke}"/>`;
  return `<circle cx="${r1(e.cx)}" cy="${r1(e.cy)}" r="${r1(e.R)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` +
    `<circle cx="${r1(px)}" cy="${r1(py)}" r="${r1(pr)}" fill="${C.ink}"/>` +
    `<circle cx="${r1(px - pr * 0.36)}" cy="${r1(py - pr * 0.38)}" r="${r1(pr * 0.24)}" fill="#fff"/>`;
}

// Draw a word with: drop shadow, outline, fill. Eyes are drawn on top in white.
function drawWord(word, { fill, sw, shadow, tx, ty, rot, shadowColor = C.ink, outline = C.ink, eyeFill = C.white, pupil }) {
  const glyphs = (attrs) => word.parts.filter((p) => p.kind === 'glyph').map((p) =>
    `<path d="${p.d}"${p.rot ? ` transform="rotate(${p.rot} ${r1(p.cx)} ${r1(p.cy)})"` : ''}${attrs}/>`).join('');
  const eyes = (fn) => word.parts.filter((p) => p.kind === 'eye').map(fn).join('');
  const lj = ' stroke-linejoin="round" stroke-linecap="round"';
  const cx = word.width / 2, cy = -word.cap / 2;
  return `<g transform="translate(${r1(tx)} ${r1(ty)}) rotate(${rot} ${r1(cx)} ${r1(cy)})">` +
    (shadow ? `<g transform="translate(0 ${shadow})" fill="${shadowColor}" stroke="${shadowColor}" stroke-width="${sw}"${lj}>${glyphs('')}${eyes((e) => `<circle cx="${r1(e.cx)}" cy="${r1(e.cy)}" r="${r1(e.R)}"/>`)}</g>` : '') +
    `<g fill="${outline}" stroke="${outline}" stroke-width="${sw}"${lj}>${glyphs('')}</g>` +
    `<g fill="${fill}">${glyphs('')}</g>` +
    eyes((e) => eyeSVG(e, eyeFill, outline, sw * 0.62, pupil)) +
    `</g>`;
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

// ---------- stacked logo ----------
function stacked({ mono = false, color = C.ink } = {}) {
  const S = 200, sw = 20, sh = 13;
  const prop = layoutWord([{ ch: 'P' }, { ch: 'R' }, { eye: true }, { ch: 'P' }], S, { bounce: [[0, -3], [-4, 2], [-6, 0], [2, 4]] });
  const panic = layoutWord([{ ch: 'P' }, { ch: 'A' }, { ch: 'N' }, { ch: 'I' }, { ch: 'C' }], S, { bounce: [[0, 2], [-4, -2], [0, 3], [-5, -3], [2, 2]] });
  const pad = 34;
  const x1 = pad + 6, y1 = pad + prop.cap + 18;
  const x2 = x1 + S * 0.36, y2 = y1 + S * 0.9;
  const fill1 = mono ? color : C.yellow, fill2 = mono ? color : C.pink;
  const o = mono
    ? { sw: 0, shadow: 0, outline: color, eyeFill: 'none' }
    : { sw, shadow: sh };
  let body = '';
  body += drawWord(panic, { fill: fill2, tx: x2, ty: y2, rot: -2, ...o });
  body += drawWord(prop, { fill: fill1, tx: x1, ty: y1, rot: -4, ...o });
  if (!mono) {
    // panic accents: sweat drop + shock lines off the top-right of PROP
    const ax = x1 + prop.width + 26, ay = y1 - prop.cap - 14;
    body += `<g transform="translate(${r1(ax)} ${r1(ay)}) rotate(-4)" stroke="${C.ink}" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M8 40 L34 22" stroke-width="11"/><path d="M14 68 L46 64" stroke-width="11"/>` +
      `<path d="M-6 -2 C-6 -2 -22 20 -22 31 a16 16 0 0 0 32 0 C10 20 -6 -2 -6 -2Z" fill="${C.cyan}" stroke-width="7"/>` +
      `<ellipse cx="-12" cy="30" rx="3.6" ry="6" fill="#fff" stroke="none"/></g>`;
  }
  const W = Math.ceil(x2 + panic.width + pad + 6), H = Math.ceil(y2 + sh + pad + 8);
  return { W, H, body };
}

// ---------- icon (crate with googly eyes, in a reticle) ----------
function crate({ sw = 16, detail = true } = {}) {
  // drawn in a 512 box, centred ~ (256, 270)
  const top = `M150 196 L196 150 L372 150 L372 150 L326 196 Z`;
  const side = `M326 196 L372 150 L372 326 L326 372 Z`;
  const front = `M150 196 L326 196 L326 372 L150 372 Z`;
  const lj = `stroke="${C.ink}" stroke-width="${sw}" stroke-linejoin="round"`;
  let g = `<g transform="rotate(-6 256 262)">`;
  g += `<path d="${top}" fill="#ffe29a" ${lj}/>`;
  g += `<path d="${side}" fill="${C.yellowD}" ${lj}/>`;
  g += `<rect x="150" y="196" width="176" height="176" rx="14" fill="${C.yellow}" ${lj}/>`;
  if (detail) {
    // tape strip
    g += `<path d="M216 196 L262 150 L292 150 L246 196 Z" fill="${C.pink}" stroke="${C.ink}" stroke-width="${sw * 0.6}" stroke-linejoin="round"/>`;
    g += `<rect x="216" y="196" width="30" height="50" fill="${C.pink}" stroke="${C.ink}" stroke-width="${sw * 0.6}" stroke-linejoin="round"/>`;
  }
  // googly eyes on the front face
  const eye = (cx, cy, R, px, py) => `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff" stroke="${C.ink}" stroke-width="${sw * 0.7}"/>` +
    `<circle cx="${cx + px}" cy="${cy + py}" r="${R * 0.48}" fill="${C.ink}"/>` +
    (detail ? `<circle cx="${cx + px - R * 0.17}" cy="${cy + py - R * 0.18}" r="${R * 0.12}" fill="#fff"/>` : '');
  g += eye(200, 300, 34, 13, -10) + eye(278, 292, 40, 16, -12);
  if (detail) g += `<path d="M196 346 q16 -10 30 0 q14 10 30 0 q14 -10 30 0" fill="none" stroke="${C.ink}" stroke-width="${sw * 0.7}" stroke-linecap="round" stroke-linejoin="round"/>`;
  g += `</g>`;
  return g;
}

function icon({ size = 512, detail = true, reticle = true } = {}) {
  const sw = detail ? 16 : 22;
  let b = `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26396a"/><stop offset="1" stop-color="${C.navy2}"/></linearGradient></defs>`;
  b += `<rect width="512" height="512" rx="112" fill="url(#bg)"/>`;
  if (reticle) {
    const m = 70, L = 64, s = 22;
    const br = (d) => `<path d="${d}" fill="none" stroke="${C.pink}" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round"/>`;
    b += br(`M${m} ${m + L} V${m} H${m + L}`) + br(`M${512 - m - L} ${m} H${512 - m} V${m + L}`) +
      br(`M${512 - m} ${512 - m - L} V${512 - m} H${512 - m - L}`) + br(`M${m + L} ${512 - m} H${m} V${512 - m - L}`);
  }
  // soft floor shadow
  b += `<ellipse cx="262" cy="392" rx="128" ry="18" fill="#000" opacity="0.28"/>`;
  b += crate({ sw, detail });
  if (detail) {
    b += `<g stroke="${C.ink}" stroke-linejoin="round"><path d="M392 168 C392 168 372 196 372 210 a20 20 0 0 0 40 0 C412 196 392 168 392 168Z" fill="${C.cyan}" stroke-width="9"/></g>` +
      `<ellipse cx="385" cy="208" rx="4.5" ry="8" fill="#fff"/>`;
  }
  return svg(size, size, b, 'PROP PANIC').replace(`viewBox="0 0 ${size} ${size}"`, 'viewBox="0 0 512 512"');
}

// ---------- horizontal lockup ----------
function horizontal() {
  const S = 160, sw = 16, sh = 10;
  // split into two coloured words with a space
  const prop = layoutWord([{ ch: 'P' }, { ch: 'R' }, { eye: true }, { ch: 'P' }], S, { bounce: [[0, -2], [-3, 2], [-5, 0], [2, 3]] });
  const panic = layoutWord([{ ch: 'P' }, { ch: 'A' }, { ch: 'N' }, { ch: 'I' }, { ch: 'C' }], S, { bounce: [[0, 2], [-3, -2], [0, 3], [-4, -3], [2, 2]] });
  const iconSize = 200, pad = 24;
  const tx = pad + iconSize + 34, ty = pad + iconSize / 2 + prop.cap / 2;
  let b = `<g transform="translate(${pad} ${pad}) scale(${iconSize / 512})">${icon().replace(/^<svg[^>]*>|<\/svg>\n$/g, '').replace(/<title>.*?<\/title>/, '')}</g>`;
  b += drawWord(prop, { fill: C.yellow, sw, shadow: sh, tx, ty, rot: -3 });
  b += drawWord(panic, { fill: C.pink, sw, shadow: sh, tx: tx + prop.width + S * 0.26, ty: ty + 4, rot: -1.5 });
  const W = Math.ceil(tx + prop.width + S * 0.26 + panic.width + pad + 8), H = iconSize + pad * 2;
  return svg(W, H, b, 'PROP PANIC');
}

const st = stacked();
fs.writeFileSync(path.join(OUT, 'logo.svg'), svg(st.W, st.H, st.body, 'PROP PANIC'));
const mono = stacked({ mono: true, color: '#ffffff' });
fs.writeFileSync(path.join(OUT, 'logo-mono-white.svg'), svg(mono.W, mono.H, mono.body, 'PROP PANIC'));
const monoInk = stacked({ mono: true, color: C.ink });
fs.writeFileSync(path.join(OUT, 'logo-mono-ink.svg'), svg(monoInk.W, monoInk.H, monoInk.body, 'PROP PANIC'));
fs.writeFileSync(path.join(OUT, 'icon.svg'), icon());
fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg(64, 64,
  `<rect width="64" height="64" rx="14" fill="${C.navy}"/>` +
  `<g transform="rotate(-6 32 33)"><rect x="9" y="12" width="46" height="42" rx="7" fill="${C.yellow}" stroke="${C.ink}" stroke-width="3.5"/>` +
  `<circle cx="22" cy="31" r="9" fill="#fff" stroke="${C.ink}" stroke-width="2.5"/><circle cx="25" cy="29" r="4.6" fill="${C.ink}"/>` +
  `<circle cx="42" cy="30" r="10.5" fill="#fff" stroke="${C.ink}" stroke-width="2.5"/><circle cx="45.5" cy="27.5" r="5.2" fill="${C.ink}"/>` +
  `<rect x="27" y="12" width="9" height="7" fill="${C.pink}"/></g>`, 'PROP PANIC'));
fs.writeFileSync(path.join(OUT, 'logo-horizontal.svg'), horizontal());

// social card 1200x630
{
  const s = 1.25;
  let b = `<defs><radialGradient id="g" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#2a3f72"/><stop offset="1" stop-color="${C.navy2}"/></radialGradient></defs><rect width="1200" height="630" fill="url(#g)"/>`;
  const lw = st.W * s, lh = st.H * s;
  b += `<g transform="translate(${r1((1200 - lw) / 2)} ${r1((630 - lh) / 2 - 36)}) scale(${s})">${st.body}</g>`;
  b += `<text x="600" y="${r1((630 + lh) / 2 + 10)}" text-anchor="middle" font-family="Fredoka, 'Arial Rounded MT Bold', sans-serif" font-weight="600" font-size="40" fill="#fff">TAGLINE</text>`;
  // outline the tagline too
  const tl = font.getPath("Blend in. Don't get caught.", 0, 0, 44);
  const bb = tl.getBoundingBox();
  const tw = bb.x2 - bb.x1;
  b = b.replace(/<text[^]*?<\/text>/, `<path transform="translate(${r1(600 - tw / 2 - bb.x1)} ${r1((630 + lh) / 2 + 4)})" d="${pd(tl)}" fill="#fff"/>`);
  fs.writeFileSync(path.join(OUT, 'social-card.svg'), svg(1200, 630, b, "PROP PANIC — Blend in. Don't get caught."));
}
console.log('wrote', fs.readdirSync(OUT).join(', '));
