// Raw-PCM capture tap for the voice recorder. Runs on the audio render thread and forwards
// every render quantum to the main thread as plain Float32 samples — no container, no
// codec, so nothing downstream has to decode anything (see useVoiceRecorder.ts's header for
// why decoding is the thing we are avoiding: WebKit's decodeAudioData cannot read the
// fragmented MP4 that WebKit's own MediaRecorder produces).
//
// Shipped as a real file rather than a Blob URL: Safari's support for blob: AudioWorklet
// modules is undocumented, and a same-origin file served by Vite is one less unknown on the
// only platform this code path exists for. Deliberately plain JS — `?url` imports are
// emitted verbatim, so this file is never transpiled.
//
// Kept dumb on purpose. It does exactly two things beyond copying: downmix to mono (the
// encoder wants mono anyway, and it halves the traffic on a stereo input), and post. The
// sample budget, the level meter and the 60s cap all live on the main thread, where they
// can be tested.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    // No input connected yet / disconnected already: stay alive (returning false would
    // permanently kill the processor, and the node outlives brief graph changes).
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    if (frames === 0) return true;

    // A fresh array per quantum: the buffers handed to process() are recycled by the audio
    // thread, so anything kept must be a copy. The main thread then owns this outright and
    // stores it without copying again.
    const mono = new Float32Array(frames);
    for (let ch = 0; ch < input.length; ch += 1) {
      const data = input[ch];
      for (let i = 0; i < frames; i += 1) mono[i] += data[i] / input.length;
    }
    // Structured-clone rather than a transfer: ~512 bytes per quantum is nothing next to
    // the risk of a transfer list behaving differently in one engine's worklet scope, where
    // a throw would be invisible.
    this.port.postMessage(mono);

    // Outputs are left silent. The node still has to reach the destination for the graph to
    // pull it at all — useVoiceRecorder routes it through a muted gain node so the mic is
    // never echoed back out of the speaker.
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
