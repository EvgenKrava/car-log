// Transcribe streaming accepts pcm|ogg-opus|flac ONLY, while browsers record webm/opus
// (Chrome) or mp4/AAC (iOS Safari). So we re-encode client-side: average to mono,
// linear-resample to 16kHz, 16-bit LE PCM with a standard 44-byte RIFF header.
// Takes raw channel data rather than an AudioBuffer so it is testable without a DOM.
export const WAV_SAMPLE_RATE = 16_000;
export const MAX_CLIP_SECONDS = 60;

export function encodeWav16kMono(
  input: { channels: Float32Array[]; sampleRate: number },
): ArrayBuffer {
  const { channels, sampleRate } = input;
  const srcLen = channels[0]?.length ?? 0;

  // Average all channels to mono.
  const mono = new Float32Array(srcLen);
  for (const ch of channels) {
    for (let i = 0; i < srcLen; i += 1) mono[i]! += ch[i]! / channels.length;
  }

  // Linear resample to 16kHz.
  const outLen = Math.round((srcLen * WAV_SAMPLE_RATE) / sampleRate);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = (i * sampleRate) / WAV_SAMPLE_RATE;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, srcLen - 1);
    const frac = pos - lo;
    out[i] = (mono[lo] ?? 0) * (1 - frac) + (mono[hi] ?? 0) * frac;
  }

  // 16-bit PCM + RIFF header.
  const dataBytes = outLen * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                       // PCM
  v.setUint16(22, 1, true);                       // mono
  v.setUint32(24, WAV_SAMPLE_RATE, true);
  v.setUint32(28, WAV_SAMPLE_RATE * 2, true);     // byte rate
  v.setUint16(32, 2, true);                       // block align
  v.setUint16(34, 16, true);                      // bits/sample
  writeAscii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < outLen; i += 1) {
    const s = Math.max(-1, Math.min(1, out[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 32_768 : s * 32_767, true);
  }
  return buf;
}
