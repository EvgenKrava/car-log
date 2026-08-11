import { describe, expect, it } from 'vitest';
import {
  holdGestureReducer, holdOutcome, micEffect, initialHoldState,
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

// These pin the iOS fix: the mic must be ACQUIRED in the pointerdown handler (a user-gesture
// context) and merely PROMOTED to recording by the 300ms timer, which on iOS/Safari is not a
// gesture context and cannot legally call getUserMedia or start an AudioContext.
describe('micEffect', () => {
  it('acquires the mic on pointerdown, not on the promote timer', () => {
    expect(micEffect(initialHoldState, down(0), false)).toBe('acquire');
  });

  it('the promote timer only begins recording — it must never acquire', () => {
    const pressed = holdGestureReducer(initialHoldState, down(0));
    expect(micEffect(pressed, { kind: 'holdTimer' }, false)).toBe('begin');
  });

  it('a stale promote timer (already released) does nothing', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, up(100));
    expect(micEffect(s, { kind: 'holdTimer' }, false)).toBeNull();
  });

  it('a short tap releases the mic acquired by pointerdown', () => {
    const pressed = holdGestureReducer(initialHoldState, down(0));
    expect(micEffect(pressed, up(HOLD_THRESHOLD_MS - 1), false)).toBe('release');
  });

  it('slide-to-cancel releases the mic', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    s = holdGestureReducer(s, { kind: 'move', dx: -(CANCEL_SLIDE_PX + 1) });
    expect(micEffect(s, up(5_000), true)).toBe('release');
  });

  it('releasing a real recording finishes it', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(micEffect(s, up(5_000), true)).toBe('finish');
  });

  // Regression: the whole hold can elapse behind the browser's permission prompt — the
  // reducer promotes to 'recording' but capture never went live. Releasing there is the
  // user reaching for the prompt's buttons; it must hand the mic back, never encode an
  // empty clip and surface a "didn't catch that" failure for a mere access request.
  it('releasing while the permission prompt blocked capture releases, not finishes', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(micEffect(s, up(5_000), false)).toBe('release');
  });

  it('an interruption (pointercancel/reset) always releases the mic', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    expect(micEffect(s, { kind: 'reset' }, false)).toBe('release');
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(micEffect(s, { kind: 'reset' }, true)).toBe('release');
  });

  it('moving mid-recording has no mic-lifecycle effect', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(micEffect(s, { kind: 'move', dx: -10 }, true)).toBeNull();
  });

  it('every gesture that acquires eventually releases or finishes', () => {
    // Exhaustive over the terminal paths: tap, cancel-slide, record, interruption.
    const paths: Array<{ events: Parameters<typeof holdGestureReducer>[1][]; captureLive: boolean; final: string }> = [
      { events: [down(0)], captureLive: false, final: 'release' },
      { events: [down(0), { kind: 'holdTimer' }], captureLive: true, final: 'finish' },
      { events: [down(0), { kind: 'holdTimer' }], captureLive: false, final: 'release' },
      { events: [down(0), { kind: 'holdTimer' }, { kind: 'move', dx: -(CANCEL_SLIDE_PX + 1) }], captureLive: true, final: 'release' },
    ];
    for (const { events, captureLive, final } of paths) {
      expect(micEffect(initialHoldState, events[0]!, false)).toBe('acquire');
      const s = events.reduce<HoldState>(holdGestureReducer, initialHoldState);
      expect(micEffect(s, up(9_999), captureLive)).toBe(final);
    }
  });
});
