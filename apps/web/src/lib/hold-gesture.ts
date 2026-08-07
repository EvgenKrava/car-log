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
