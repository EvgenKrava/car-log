import { describe, expect, it } from 'vitest';
import { rekeyIndexHtml } from './rename-index';

describe('rekeyIndexHtml', () => {
  it('moves index.html to app.html and leaves other assets alone', () => {
    const bundle: Record<string, { fileName: string }> = { 'index.html': { fileName: 'index.html' }, 'assets/a.js': { fileName: 'assets/a.js' } };
    rekeyIndexHtml(bundle);
    expect(Object.keys(bundle).sort()).toEqual(['app.html', 'assets/a.js']);
    expect(bundle['app.html']?.fileName).toBe('app.html');
  });
  it('is a no-op without index.html', () => {
    const bundle = { 'assets/a.js': { fileName: 'assets/a.js' } };
    rekeyIndexHtml(bundle);
    expect(Object.keys(bundle)).toEqual(['assets/a.js']);
  });
});
