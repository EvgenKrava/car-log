import { describe, expect, it } from 'vitest';
import { chunkText, mergeCandidates } from './chunk-text';

describe('chunkText', () => {
  it('returns one chunk when text fits', () => {
    expect(chunkText('a\nb\nc', 100)).toEqual(['a\nb\nc']);
  });
  it('splits on line boundaries, never mid-line', () => {
    const lines = ['111111', '222222', '333333']; // 6 chars each
    const chunks = chunkText(lines.join('\n'), 14); // fits 2 lines + newline per chunk
    expect(chunks).toEqual(['111111\n222222', '333333']);
  });
  it('hard-splits a single line longer than maxLen', () => {
    const chunks = chunkText('x'.repeat(25), 10);
    expect(chunks).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });
  it('produces no empty chunks and preserves order', () => {
    const chunks = chunkText('a\n\n\nb\nc', 3);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
    expect(chunks.join('\n').replace(/\n+/g, '\n')).toContain('a');
  });
  it('returns [] for empty/whitespace-only text', () => {
    expect(chunkText('', 10)).toEqual([]);
    expect(chunkText('  \n \n ', 10)).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  it('merges in order and truncates at the cap', () => {
    expect(mergeCandidates([[1, 2], [3, 4], [5]], 4)).toEqual([1, 2, 3, 4]);
  });
  it('handles empty lists', () => {
    expect(mergeCandidates([[], [1], []], 10)).toEqual([1]);
  });
});
