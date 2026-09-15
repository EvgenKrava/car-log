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

// The mark: a clipboard service checklist (oil, tire, wrench, check) with a car in
// front, drawn in a 512 box. Two-tone: `fg` is the paper/car, `hole` the ink — pass
// the background paint as `hole` so cut-outs punch through cleanly and the dark
// variant is an exact inversion. `scale` shrinks the mark around its centre for
// maskable safe zones.
const mark = (fg, hole, scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
  <g transform="translate(-4 -6)">
    <!-- clipboard -->
    <rect x="92" y="104" width="216" height="330" rx="24" fill="${fg}"/>
    <rect x="156" y="78" width="88" height="48" rx="16" fill="${fg}"/>
    <rect x="178" y="94" width="44" height="14" rx="7" fill="${hole}"/>
    <!-- row 1: oil -->
    <path fill="${hole}" d="M144 154 C156 170 168 184 168 198 A24 24 0 0 1 120 198 C120 184 132 170 144 154 Z"/>
    <rect x="186" y="180" width="94" height="20" rx="10" fill="${hole}"/>
    <!-- row 2: tire (ring with outer tread) -->
    <circle cx="144" cy="256" r="24" fill="${hole}"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="140" y="226" width="8" height="10" rx="2" fill="${hole}" transform="rotate(${a} 144 256)"/>`).join('')}
    <circle cx="144" cy="256" r="13" fill="${fg}"/>
    <circle cx="144" cy="256" r="5" fill="${hole}"/>
    <rect x="186" y="246" width="94" height="20" rx="10" fill="${hole}"/>
    <!-- row 3: wrench -->
    <g transform="rotate(-45 144 322)">
      <rect x="137" y="306" width="14" height="52" rx="7" fill="${hole}"/>
      <circle cx="144" cy="300" r="17" fill="${hole}"/>
      <rect x="138" y="278" width="12" height="26" rx="4" fill="${fg}"/>
    </g>
    <rect x="186" y="312" width="94" height="20" rx="10" fill="${hole}"/>
    <!-- row 4: check -->
    <path d="M126 388 L140 402 L166 372" fill="none" stroke="${hole}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="186" y="378" width="94" height="20" rx="10" fill="${hole}"/>
    <!-- car, with an ink halo so it separates from the paper -->
    <g stroke="${hole}" stroke-width="18" stroke-linejoin="round">
      <path fill="${fg}" d="M226 372 L250 308 C256 290 272 278 296 278 L384 278 C408 278 424 290 430 308 L454 372 Z"/>
      <rect x="190" y="352" width="300" height="76" rx="28" fill="${fg}"/>
      <rect x="208" y="326" width="24" height="20" rx="7" fill="${fg}"/>
      <rect x="448" y="326" width="24" height="20" rx="7" fill="${fg}"/>
    </g>
    <path fill="${fg}" d="M226 372 L250 308 C256 290 272 278 296 278 L384 278 C408 278 424 290 430 308 L454 372 Z"/>
    <rect x="208" y="326" width="24" height="20" rx="7" fill="${fg}"/>
    <rect x="448" y="326" width="24" height="20" rx="7" fill="${fg}"/>
    <rect x="190" y="352" width="300" height="76" rx="28" fill="${fg}"/>
    <path fill="${hole}" d="M262 350 L280 310 C284 302 292 298 302 298 L378 298 C388 298 396 302 400 310 L418 350 Z"/>
    <rect x="214" y="380" width="46" height="20" rx="10" fill="${hole}"/>
    <rect x="420" y="380" width="46" height="20" rx="10" fill="${hole}"/>
    <rect x="300" y="384" width="80" height="14" rx="7" fill="${hole}"/>
    <rect x="206" y="420" width="56" height="24" rx="10" fill="${fg}"/>
    <rect x="418" y="420" width="56" height="24" rx="10" fill="${fg}"/>
  </g>
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

// Monochrome: the mark alone on transparency — Android tints the alpha for themed
// icons. The ink must be real holes, so the mark is used as a luminance mask
// (white = keep, black = cut) over a solid square.
const monochrome = () =>
  `${open}<defs><mask id="m"><rect width="512" height="512" fill="#000"/>${mark('#FFFFFF', '#000000', 0.74)}</mask></defs><rect width="512" height="512" fill="#000" mask="url(#m)"/></svg>`;

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
