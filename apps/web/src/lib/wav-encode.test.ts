import { describe, expect, it } from 'vitest';
import { encodeWav16kMono, WAV_SAMPLE_RATE } from './wav-encode';

// 1s stereo sine at 48kHz: L = sin, R = 0 → mono average = sin/2.
const sine48k = (): { channels: Float32Array[]; sampleRate: number } => {
  const n = 48_000;
  const left = new Float32Array(n);
  for (let i = 0; i < n; i += 1) left[i] = Math.sin((2 * Math.PI * 440 * i) / n);
  return { channels: [left, new Float32Array(n)], sampleRate: 48_000 };
};

const view = (buf: ArrayBuffer) => new DataView(buf);
const ascii = (buf: ArrayBuffer, off: number, len: number) =>
  String.fromCharCode(...new Uint8Array(buf, off, len));

describe('encodeWav16kMono', () => {
  it('writes a valid 44-byte RIFF/WAVE header for 16kHz mono 16-bit', () => {
    const wav = encodeWav16kMono(sine48k());
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    const v = view(wav);
    expect(v.getUint16(20, true)).toBe(1);              // PCM
    expect(v.getUint16(22, true)).toBe(1);              // mono
    expect(v.getUint32(24, true)).toBe(WAV_SAMPLE_RATE); // 16000
    expect(v.getUint16(34, true)).toBe(16);             // bits/sample
    expect(ascii(wav, 36, 4)).toBe('data');
  });

  it('downsamples 48kHz → 16kHz (1s in = 16000 samples out)', () => {
    const wav = encodeWav16kMono(sine48k());
    const dataBytes = view(wav).getUint32(40, true);
    expect(dataBytes / 2).toBe(16_000); // 16-bit samples
    expect(wav.byteLength).toBe(44 + dataBytes);
  });

  it('averages channels to mono (stereo sin+silence → half amplitude)', () => {
    const wav = encodeWav16kMono(sine48k());
    const v = view(wav);
    let peak = 0;
    for (let i = 0; i < 16_000; i += 1) {
      peak = Math.max(peak, Math.abs(v.getInt16(44 + i * 2, true)));
    }
    expect(peak).toBeGreaterThan(0.45 * 32_767);
    expect(peak).toBeLessThan(0.55 * 32_767); // ~0.5 = sin/2
  });

  it('clamps out-of-range floats instead of overflowing', () => {
    const loud = { channels: [new Float32Array([2, -2, 1, -1])], sampleRate: 16_000 };
    const wav = encodeWav16kMono(loud);
    const v = view(wav);
    expect(v.getInt16(44, true)).toBe(32_767);
    expect(v.getInt16(46, true)).toBe(-32_768);
  });
});
