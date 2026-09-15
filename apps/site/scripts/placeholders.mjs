// One-off: generates solid-colour placeholder screenshots so the hero/feature image wiring
// and the build are green before real captures exist. The controller replaces these files
// (same names) with output from scripts/shots.mjs once the owner has signed in.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../src/assets/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const toRgb = (hex) => {
  const n = hex.replace('#', '');
  return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16), alpha: 1 };
};

const PLACEHOLDERS = [
  { name: 'timeline-phone-light.png', width: 780, height: 1688, color: '#F7F7FA' },
  { name: 'timeline-phone-dark.png', width: 780, height: 1688, color: '#121215' },
  { name: 'timeline-desktop-light.png', width: 2560, height: 1600, color: '#F7F7FA' },
  { name: 'reminders-desktop-light.png', width: 2560, height: 1600, color: '#F7F7FA' },
  { name: 'garage-desktop-light.png', width: 2560, height: 1600, color: '#F7F7FA' },
];

for (const { name, width, height, color } of PLACEHOLDERS) {
  await sharp({ create: { width, height, channels: 4, background: toRgb(color) } })
    .png()
    .toFile(`${OUT}${name}`);
  console.log('wrote', name);
}
