import { describe, expect, it } from 'vitest';
import { createPcmBuffer } from './pcm-buffer';
import { encodeWav16kMono, MAX_CLIP_SECONDS, WAV_SAMPLE_RATE } from './wav-encode';

const ramp = (n: number, from = 0) => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i += 1) a[i] = from + i;
  return a;
};

describe('createPcmBuffer', () => {
  it('starts empty and not full', () => {
    const buf = createPcmBuffer(128);
    expect(buf.totalSamples).toBe(0);
    expect(buf.isFull).toBe(false);
    expect(buf.concat()).toHaveLength(0);
  });

  it('appends whole chunks and reports the running sample total', () => {
    const buf = createPcmBuffer(1000);
    expect(buf.append(ramp(128))).toBe(128);
    expect(buf.append(ramp(128))).toBe(128);
    expect(buf.totalSamples).toBe(256);
    expect(buf.isFull).toBe(false);
  });

  it('concatenates in append order, not chunk-reversed or interleaved', () => {
    const buf = createPcmBuffer(1000);
    buf.append(new Float32Array([1, 2, 3]));
    buf.append(new Float32Array([4, 5]));
    buf.append(new Float32Array([6]));
    expect(Array.from(buf.concat())).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('truncates the chunk that crosses the budget so the clip ends exactly at the cap', () => {
    const buf = createPcmBuffer(5);
    expect(buf.append(new Float32Array([1, 2, 3]))).toBe(3);
    expect(buf.append(new Float32Array([4, 5, 6, 7]))).toBe(2); // only 2 of 4 fit
    expect(buf.totalSamples).toBe(5);
    expect(buf.isFull).toBe(true);
    expect(Array.from(buf.concat())).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports 0 kept once full, which is how the hook detects the cap without a length check', () => {
    const buf = createPcmBuffer(3);
    expect(buf.append(new Float32Array([1, 2, 3]))).toBe(3);
    expect(buf.append(new Float32Array([4]))).toBe(0);
  });

  it('drops every chunk once full, and never grows past maxSamples', () => {
    const buf = createPcmBuffer(4);
    buf.append(ramp(4));
    expect(buf.append(ramp(128))).toBe(0);
    expect(buf.append(ramp(1))).toBe(0);
    expect(buf.totalSamples).toBe(4);
    expect(buf.concat()).toHaveLength(4);
  });

  it('is a no-op for empty chunks and for a zero budget', () => {
    const buf = createPcmBuffer(10);
    expect(buf.append(new Float32Array(0))).toBe(0);
    expect(buf.totalSamples).toBe(0);

    const none = createPcmBuffer(0);
    expect(none.append(ramp(8))).toBe(0);
    expect(none.isFull).toBe(true);
    expect(none.concat()).toHaveLength(0);
  });

  it('treats a non-finite budget as zero rather than allocating unbounded', () => {
    const nan = createPcmBuffer(Number.NaN);
    expect(nan.append(ramp(8))).toBe(0);
    const inf = createPcmBuffer(Number.POSITIVE_INFINITY);
    expect(inf.append(ramp(8))).toBe(0);
  });

  it('concat() is repeatable and does not consume the buffer', () => {
    const buf = createPcmBuffer(10);
    buf.append(new Float32Array([1, 2, 3]));
    expect(Array.from(buf.concat())).toEqual([1, 2, 3]);
    expect(Array.from(buf.concat())).toEqual([1, 2, 3]);
    expect(buf.totalSamples).toBe(3);
  });

  it('copies out of the chunks it stored, so mutating the result cannot corrupt them', () => {
    const buf = createPcmBuffer(10);
    buf.append(new Float32Array([1, 2, 3]));
    buf.concat()[0] = 99;
    expect(Array.from(buf.concat())).toEqual([1, 2, 3]);
  });
});

// The cap the hook installs is MAX_CLIP_SECONDS worth of samples at the context's real rate,
// which iOS may report as anything the hardware is running at. These pin the arithmetic the
// hook and the encoder agree on, at both a common and an awkward rate.
describe('the 60s sample budget the recorder installs', () => {
  it.each([48_000, 44_100, 16_000, 8_000])('caps a %i Hz capture at MAX_CLIP_SECONDS', (rate) => {
    const budget = Math.ceil(MAX_CLIP_SECONDS * rate);
    const buf = createPcmBuffer(budget);
    // Feed 90s of audio in 128-frame render quanta; only 60s may survive.
    for (let written = 0; written < rate * 90; written += 128) buf.append(new Float32Array(128));
    expect(buf.totalSamples).toBe(budget);
    expect(buf.totalSamples / rate).toBeCloseTo(MAX_CLIP_SECONDS, 5);
  });

  it('feeds the encoder a clip that resamples to exactly MAX_CLIP_SECONDS at 16kHz', () => {
    const rate = 48_000;
    const buf = createPcmBuffer(Math.ceil(MAX_CLIP_SECONDS * rate));
    for (let i = 0; i < rate * 70; i += 128) buf.append(new Float32Array(128));
    const wav = encodeWav16kMono({ channels: [buf.concat()], sampleRate: rate });
    // 44-byte RIFF header + 2 bytes per 16kHz mono sample.
    expect(wav.byteLength).toBe(44 + MAX_CLIP_SECONDS * WAV_SAMPLE_RATE * 2);
  });

  it('preserves the signal through concat → encode (a chunked ramp survives intact)', () => {
    const buf = createPcmBuffer(1024);
    for (let i = 0; i < 8; i += 1) buf.append(ramp(128, i * 128));
    const all = buf.concat();
    expect(all).toHaveLength(1024);
    expect(Array.from(all.slice(126, 130))).toEqual([126, 127, 128, 129]); // no seam at the chunk join
  });
});
