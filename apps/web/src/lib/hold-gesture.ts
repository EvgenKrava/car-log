// Pure state machine for the hold-to-record gesture, kept out of React so the
// promote/cancel/hint logic is unit-testable. The component owns the actual timer and
// pointer capture; this decides what each event MEANS.
export const HOLD_THRESHOLD_MS = 300; // shorter press = a tap → show the "hold" hint
export const CANCEL_SLIDE_PX = 72;    // drag this far left while recording to cancel

export type HoldState = {
  phase: 'idle' | 'pressed' | 'recording' | 'cancelling';
  startedAt: number;
  dx: number;
};

export type HoldEvent =
  | { kind: 'down'; at: number }
  | { kind: 'move'; dx: number }
  | { kind: 'up'; at: number }
  | { kind: 'holdTimer' }
  | { kind: 'reset' };

export const initialHoldState: HoldState = { phase: 'idle', startedAt: 0, dx: 0 };

// What does an `up` (or other event) conclude? 'record' = stop and transcribe,
// 'cancel' = discard, 'hint' = too short, show hold-to-record hint. Null for non-final.
export function holdOutcome(state: HoldState, event: HoldEvent): 'record' | 'cancel' | 'hint' | null {
  if (event.kind !== 'up') return null;
  if (state.phase === 'pressed') return 'hint';
  if (state.phase === 'cancelling') return 'cancel';
  if (state.phase === 'recording') return 'record';
  return null;
}

// Which mic-lifecycle side-effect each gesture event requires. Kept pure and separate from
// `holdOutcome` (which decides the USER-FACING notice) because the split is what makes
// hold-to-record work on iOS at all, and is therefore worth pinning in tests:
//
//   'acquire' — open the mic. MUST be run synchronously in the pointerdown handler: iOS
//               only permits getUserMedia + AudioContext startup inside a user-gesture
//               context, and the 300ms promote timer is NOT one.
//   'begin'   — promote the already-acquired mic to a live recording (safe from a timer).
//   'release' — the gesture ended without producing a clip; hand the mic back. Required
//               even for a short tap, because pointerdown already acquired it.
//   'finish'  — stop, encode, and transcribe what was recorded.
export type MicEffect = 'acquire' | 'begin' | 'release' | 'finish' | null;

// `captureLive` is whether the recorder actually reached its recording phase. The reducer
// can sit in 'recording' while the recorder never started: getUserMedia's permission prompt
// keeps the acquisition pending past the promote timer, so the whole hold happens with the
// browser's prompt on screen and zero audio flowing. A release in that window is the user
// reaching for the prompt's Allow/Deny button — it must hand the mic back, not
// stop-and-encode an empty clip and stamp a "didn't catch that" failure over a mere
// permission request.
export function micEffect(state: HoldState, event: HoldEvent, captureLive: boolean): MicEffect {
  switch (event.kind) {
    case 'down':
      return 'acquire';
    case 'holdTimer':
      return state.phase === 'pressed' ? 'begin' : null;
    case 'up':
      if (state.phase === 'recording') return captureLive ? 'finish' : 'release';
      // 'pressed' (tap, never promoted) and 'cancelling' (slid away) both discard the mic.
      if (state.phase === 'pressed' || state.phase === 'cancelling') return 'release';
      return null;
    case 'reset':
      return 'release';
    case 'move':
      return null;
  }
}

export function holdGestureReducer(state: HoldState, event: HoldEvent): HoldState {
  switch (event.kind) {
    case 'down':
      return { phase: 'pressed', startedAt: event.at, dx: 0 };
    case 'holdTimer':
      return state.phase === 'pressed' ? { ...state, phase: 'recording' } : state;
    case 'move': {
      if (state.phase !== 'recording' && state.phase !== 'cancelling') return state;
      const phase = event.dx <= -CANCEL_SLIDE_PX ? 'cancelling' : 'recording';
      return { ...state, phase, dx: event.dx };
    }
    case 'up':
    case 'reset':
      return initialHoldState;
  }
}
