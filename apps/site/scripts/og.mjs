// One-off: composes 1200×630 OG images from a gradient, the headline and the phone shot.
// Headlines live in scripts/og-copy.json (not imported from src/i18n/*.ts, to keep this a
// plain .mjs script) and must be kept in sync with hero.h1 in src/i18n/en.ts / uk.ts.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const copy = JSON.parse(readFileSync(new URL('./og-copy.json', import.meta.url), 'utf8'));

const shot = new URL('../src/assets/shots/timeline-phone-light.png', import.meta.url).pathname;
const out = (l) => new URL(`../public/og-${l}.png`, import.meta.url).pathname;

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// librsvg (sharp's SVG renderer) does not render <foreignObject> HTML content, so the
// headline is laid out as wrapped <tspan> lines instead of an HTML <div>.
const H1_FONT_SIZE = 34;
const H1_LINE_HEIGHT = 44;
const H1_MAX_WIDTH = 620;
function wrapLines(text, maxWidth, fontSize) {
  const avgCharWidth = fontSize * 0.56;
  const maxChars = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

for (const [locale, s] of Object.entries(copy)) {
  const siteName = escapeXml(s.siteName);
  const h1Lines = wrapLines(escapeXml(s.h1), H1_MAX_WIDTH, H1_FONT_SIZE);
  const h1Tspans = h1Lines.map((line, i) => `<tspan x="72" dy="${i === 0 ? 0 : H1_LINE_HEIGHT}">${line}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5BD6"/><stop offset="1" stop-color="#2E2E8F"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="72" y="220" font-family="Inter, Helvetica, Arial, sans-serif" font-size="58" font-weight="800" fill="#fff">${siteName}</text>
    <text x="72" y="290" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${H1_FONT_SIZE}" font-weight="600" fill="#fff">${h1Tspans}</text>
  </svg>`;
  // fit: 'inside' keeps the composited phone strictly within the 1200×630 canvas
  // (a plain width-only resize overflows the 630px height for the shot's ~0.46 aspect ratio).
  const phone = await sharp(shot).resize({ width: 300, height: 550, fit: 'inside' }).png().toBuffer();
  await sharp(Buffer.from(svg)).composite([{ input: phone, left: 830, top: 60 }]).png().toFile(out(locale));
  console.log('wrote', out(locale));
}
