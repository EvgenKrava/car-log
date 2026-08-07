import { describe, expect, it } from 'vitest';
import {
  holdGestureReducer, holdOutcome, initialHoldState,
  HOLD_THRESHOLD_MS, CANCEL_SLIDE_PX, type HoldState,
} from './hold-gesture';

const down = (at = 0) => ({ kind: 'down', at } as const);
const up = (at: number) => ({ kind: 'up', at } as const);

describe('holdGestureReducer', () => {
  it('short press yields a hint, not a recording', () => {
    let s: HoldState = holdGestureReducer(initialHoldState, down(0));
    expect(s.phase).toBe('pressed');
    const ev = up(HOLD_THRESHOLD_MS - 1);
    expect(holdOutcome(s, ev)).toBe('hint');
    s = holdGestureReducer(s, ev);
    expect(s.phase).toBe('idle');
  });

  it('holdTimer promotes pressed → recording; release records', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(s.phase).toBe('recording');
    expect(holdOutcome(s, up(5_000))).toBe('record');
  });

  it('sliding past the cancel threshold cancels on release', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    s = holdGestureReducer(s, { kind: 'move', dx: -(CANCEL_SLIDE_PX + 1) });
    expect(s.phase).toBe('cancelling');
    expect(holdOutcome(s, up(5_000))).toBe('cancel');
  });

  it('sliding back under the threshold un-cancels', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    s = holdGestureReducer(s, { kind: 'move', dx: -(CANCEL_SLIDE_PX + 1) });
    s = holdGestureReducer(s, { kind: 'move', dx: -10 });
    expect(s.phase).toBe('recording');
    expect(holdOutcome(s, up(5_000))).toBe('record');
  });

  it('holdTimer after release does nothing (stale timer)', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, up(100));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(s.phase).toBe('idle');
  });

  it('reset returns to idle from any phase', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    s = holdGestureReducer(s, { kind: 'reset' });
    expect(s.phase).toBe('idle');
  });
});
