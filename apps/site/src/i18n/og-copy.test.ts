import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { uk } from './uk';

// scripts/og.mjs can't import from src/i18n/*.ts (it stays a plain .mjs script), so
// scripts/og-copy.json duplicates the headline strings by hand. Guard against drift.
const copy = JSON.parse(readFileSync(new URL('../../scripts/og-copy.json', import.meta.url), 'utf8'));

describe('scripts/og-copy.json stays in sync with src/i18n', () => {
  it('en matches src/i18n/en.ts', () => {
    expect(copy.en.siteName).toBe(en.siteName);
    expect(copy.en.h1).toBe(en.hero.h1);
  });

  it('uk matches src/i18n/uk.ts', () => {
    expect(copy.uk.siteName).toBe(uk.siteName);
    expect(copy.uk.h1).toBe(uk.hero.h1);
  });
});
