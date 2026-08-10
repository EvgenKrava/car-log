// Accumulates the Float32 sample chunks an AudioWorklet posts up from the audio thread,
// under a hard sample budget so one clip can never outgrow MAX_CLIP_SECONDS' worth of
// memory (60s at 48kHz ≈ 11.5MB of Float32 — fine, but only because it's bounded).
// Chunks are kept by reference: the worklet allocates a fresh array per render quantum and
// hands it over, so appending never has to copy; the single copy happens in concat().
//
// Pure and DOM-free on purpose. jsdom cannot run an AudioWorklet, but the buffer logic the
// worklet feeds — the cap, the append order, the sample math the WAV encoder's resampling
// depends on — is exactly the part that has to be right, so it lives here and is tested.
export type PcmBuffer = {
  /** Stores as much of `chunk` as the budget allows; returns how many samples were kept. */
  append: (chunk: Float32Array) => number;
  /** Every stored sample, in append order, as one array of exactly `totalSamples` length. */
  concat: () => Float32Array;
  readonly totalSamples: number;
  readonly isFull: boolean;
};

export function createPcmBuffer(maxSamples: number): PcmBuffer {
  const budget = Number.isFinite(maxSamples) ? Math.max(0, Math.floor(maxSamples)) : 0;
  const chunks: Float32Array[] = [];
  let total = 0;

  return {
    append(chunk) {
      const room = budget - total;
      if (room <= 0 || chunk.length === 0) return 0;
      // When the budget runs out mid-chunk, keep the head and drop the rest, so the clip
      // ends exactly at the cap instead of a whole render quantum short or long.
      const kept = chunk.length <= room ? chunk : chunk.subarray(0, room);
      chunks.push(kept);
      total += kept.length;
      return kept.length;
    },
    concat() {
      const out = new Float32Array(total);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    },
    get totalSamples() { return total; },
    get isFull() { return total >= budget; },
  };
}
