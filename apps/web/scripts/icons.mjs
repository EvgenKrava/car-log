// Generates every CarLog icon from one vector mark. Run from the repo root:
//   pnpm --filter @carlog/web icons
// Needs `rsvg-convert` on PATH (brew install librsvg) for the PNG rasters.
//
// Output (apps/web/public, also served under the marketing site):
//   icons/icon.svg                 theme-aware favicon (light mark, dark via prefers-color-scheme)
//   icons/icon-light.svg           static light mark (rounded square)
//   icons/icon-dark.svg            static dark mark  (rounded square)
//   icons/icon-{192,512}.png       manifest icons, purpose "any"   (light)
//   icons/icon-maskable-512.png    manifest icon,  purpose "maskable" (light, full-bleed, safe zone)
//   icons/icon-monochrome-512.png  manifest icon,  purpose "monochrome" (Android themed icons)
//   icons/dark/…                   the same rasters for the dark mark
//   apple-touch-icon.png           180px, full-bleed (iOS rounds it); apple-touch-icon-dark.png alongside
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// The mark: a bold side-view car, drawn in a 512 box. `hole` is the paint for the
// cut-outs (windows, wheel wells) — the same paint as the background, so they punch
// through cleanly. `scale` shrinks the mark around its centre for maskable safe zones.
const mark = (fg, hole, scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -308)">
    <rect x="48" y="290" width="416" height="86" rx="26" fill="${fg}"/>
    <path fill="${fg}" d="M144 296 L188 216 Q200 196 224 196 L326 196 Q350 196 362 216 L406 296 Z"/>
    <path fill="${hole}" d="M198 280 L226 232 Q230 226 238 226 L262 226 L262 280 Z"/>
    <path fill="${hole}" d="M286 226 L314 226 Q322 226 326 232 L354 280 L286 280 Z"/>
    <circle cx="144" cy="376" r="56" fill="${hole}"/>
    <circle cx="144" cy="376" r="38" fill="${fg}"/>
    <circle cx="144" cy="376" r="15" fill="${hole}"/>
    <circle cx="368" cy="376" r="56" fill="${hole}"/>
    <circle cx="368" cy="376" r="38" fill="${fg}"/>
    <circle cx="368" cy="376" r="15" fill="${hole}"/>
  </g>`;

// userSpaceOnUse gradients so cut-outs painted with the same gradient line up with
// the background pixel for pixel.
const gradient = (id, top, bottom) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="512"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;

const VARIANTS = {
  light: { fg: '#FFFFFF', bg: gradient('bg', '#6E6EE8', '#4E4ECC') },
  dark: { fg: '#8A8AF0', bg: gradient('bg', '#2C2C30', '#151517') },
};

const open = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`;

// rounded: transparent corners (favicons, "any" icons); full-bleed otherwise.
const icon = ({ fg, bg }, { rounded = true, scale = 1 } = {}) =>
  `${open}<defs>${bg}</defs><rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#bg)"/>${mark(fg, 'url(#bg)', scale)}</svg>`;

// The favicon carries both marks and lets the browser pick by colour scheme.
const themed = () =>
  `${open}<defs>${VARIANTS.light.bg}${gradient('bgDark', '#2C2C30', '#151517')}</defs>
  <style>.d{display:none}@media (prefers-color-scheme:dark){.l{display:none}.d{display:inline}}</style>
  <g class="l"><rect width="512" height="512" rx="112" fill="url(#bg)"/>${mark('#FFFFFF', 'url(#bg)')}</g>
  <g class="d"><rect width="512" height="512" rx="112" fill="url(#bgDark)"/>${mark('#8A8AF0', 'url(#bgDark)')}</g>
</svg>`;

// Monochrome: the mark alone on transparency — Android tints the alpha for themed icons.
const monochrome = () => `${open}${mark('#000000', 'transparent', 0.74)}</svg>`;

const png = (svg, size, out) => {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', out], { input: svg });
};

const write = (rel, svg) => {
  const out = join(PUBLIC, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${svg}\n`);
};

write('icons/icon.svg', themed());
write('icons/icon-light.svg', icon(VARIANTS.light));
write('icons/icon-dark.svg', icon(VARIANTS.dark));

for (const [name, v] of Object.entries(VARIANTS)) {
  const dir = name === 'light' ? 'icons' : 'icons/dark';
  png(icon(v), 192, join(PUBLIC, dir, 'icon-192.png'));
  png(icon(v), 512, join(PUBLIC, dir, 'icon-512.png'));
  png(icon(v, { rounded: false, scale: 0.74 }), 512, join(PUBLIC, dir, 'icon-maskable-512.png'));
  png(icon(v, { rounded: false }), 180, join(PUBLIC, name === 'light' ? 'apple-touch-icon.png' : 'apple-touch-icon-dark.png'));
}
png(monochrome(), 512, join(PUBLIC, 'icons', 'icon-monochrome-512.png'));
console.log('icons written to', PUBLIC);
