import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Car, ChatSession, ChatAction } from '@carlog/contracts';
import type { ChatSessionRecord, LlmProvider, ChatTurnResult } from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { InMemoryChatSessionRepository } from './in-memory-chat-session-repository';
import { InMemoryProofRepository } from './in-memory-proof-repository';
import { InMemoryLlmProvider } from './in-memory-llm-provider';
import { handleChatRoute, type ChatDeps } from './chat-session-routes';
import type { ApiEvent } from './router';

const OWNER = 'owner-1';
const CAR_ID = '33333333-3333-4333-8333-333333333333';
const SID = '55555555-5555-4555-8555-555555555555';
const AID = '66666666-6666-4666-8666-666666666666';
const RID = '77777777-7777-4777-8777-777777777777';

const car: Car = {
  id: CAR_ID, ownerId: OWNER, make: 'VW', model: 'Golf', year: 2018, mileage: 90000,
  fuelType: 'diesel', engineVolume: undefined, nickname: undefined, vin: undefined,
  licensePlate: undefined, createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z', shared: false,
};

// A stub storage: chat attachments are not exercised by these tests.
const storage = {
  presignPut: async () => 'https://example.test/put',
  presignGet: async () => 'https://example.test/get',
  exists: async () => true,
  deleteObject: async () => undefined,
  copyObject: async () => undefined,
};

const pendingAction: ChatAction = {
  id: AID, kind: 'delete_reminder', status: 'pending',
  summary: 'Delete reminder: Oil change', entityId: RID,
  pending: { target: 'reminder', entityId: RID },
};

const post = (path: string): ApiEvent => ({
  method: 'POST', path, ownerId: OWNER, groups: [],
  pathParams: { id: CAR_ID, sid: SID, aid: AID }, queryParams: {}, body: null,
});

// A counter-based unique id generator, valid-UUID-shaped so it satisfies the contract's
// `z.string().uuid()` fields. A fixed `() => AID` would collide with the pending action's
// own (explicitly-seeded) id the moment a test's turn creates a new entity/action —
// masking bugs that only show up when ids genuinely differ.
const makeNewId = (): () => string => {
  let n = 0;
  return () => `10000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
};

describe('chat action confirm/decline', () => {
  let deps: ChatDeps;
  let reminders: InMemoryReminderRepository;
  let sessions: InMemoryChatSessionRepository;

  const seedSession = async (action: ChatAction) => {
    const record: ChatSessionRecord = {
      id: SID, carId: CAR_ID, ownerId: OWNER, title: 'chat',
      messages: [
        { role: 'user', content: 'delete it', attachments: [], actions: [], createdAt: '2026-08-04T10:00:00.000Z' },
        { role: 'assistant', content: 'awaiting confirmation', attachments: [], actions: [action], createdAt: '2026-08-04T10:00:01.000Z' },
      ],
      createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:00:01.000Z',
    };
    await sessions.create(record);
  };

  beforeEach(async () => {
    const cars = new InMemoryCarRepository();
    await cars.create(car);
    reminders = new InMemoryReminderRepository();
    await reminders.create({
      id: RID, carId: CAR_ID, ownerId: OWNER, title: 'Oil change', category: 'oil_change',
      dueMileage: 100000, notes: undefined,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    });
    sessions = new InMemoryChatSessionRepository();
    deps = {
      cars, events: new InMemoryEventRepository(), reminders, sessions,
      proofs: new InMemoryProofRepository(), storage, llm: new InMemoryLlmProvider(null),
      // Counter-based: AID is seeded explicitly wherever a test needs a KNOWN id (the
      // pending action itself), never relied upon as newId's output — see makeNewId above.
      loadS3Base64: async () => null, newId: makeNewId(),
    };
  });

  it('confirm performs the delete and marks the action done', async () => {
    await seedSession(pendingAction);
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(200);
    const session = JSON.parse(res!.body) as ChatSession;
    expect(session.messages[1]!.actions[0]!.status).toBe('done');
    expect(await reminders.getById(OWNER, CAR_ID, RID)).toBeNull();
  });

  it('decline leaves the entity alone and marks the action declined', async () => {
    await seedSession(pendingAction);
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/decline`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(200);
    const session = JSON.parse(res!.body) as ChatSession;
    expect(session.messages[1]!.actions[0]!.status).toBe('declined');
    expect(await reminders.getById(OWNER, CAR_ID, RID)).not.toBeNull();
  });

  it('a second confirm is a 409, not a second delete', async () => {
    await seedSession(pendingAction);
    const path = `/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`;

    const deleteSpy = vi.spyOn(reminders, 'delete');
    expect((await handleChatRoute(deps, post(path), OWNER, CAR_ID))?.statusCode).toBe(200);
    const again = await handleChatRoute(deps, post(path), OWNER, CAR_ID);
    expect(again?.statusCode).toBe(409);
    // Finding 8: the 409 alone doesn't prove the second confirm skipped the delete call —
    // assert the repository was only ever asked to delete once.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('an unknown action id is a 404', async () => {
    await seedSession({ ...pendingAction, id: '88888888-8888-4888-8888-888888888888' });
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(404);
  });

  it('confirming an already-declined action is a 409', async () => {
    await seedSession({ ...pendingAction, status: 'declined' });
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(409);
  });

  it('confirming a pending action whose entity no longer exists under this owner is a 404, and does not delete', async () => {
    // Finding 4: the getById + 404 guard before reminders.delete is unexercised by any
    // existing test — deleting that guard left the whole suite green. Point the pending
    // action's entityId at a reminder id that was never created (simplest foreign/missing
    // case) and confirm the route 404s instead of calling delete on a non-existent row.
    const missingId = '99999999-9999-4999-8999-999999999999';
    await seedSession({
      ...pendingAction, entityId: missingId, pending: { target: 'reminder', entityId: missingId },
    });
    const deleteSpy = vi.spyOn(reminders, 'delete');
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(404);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('propagates a provider error as a rejection instead of swallowing it into a 200 (rethrow branch)', async () => {
    // Finding 3: mutating `if (!(err instanceof ChatTurnInterruptedError)) throw err;` into a
    // swallow-everything left all existing tests green. Pin the propagation: a provider
    // outage with nothing yet committed must reject with the original error (which
    // withErrorHandling upstream turns into the 503), not resolve to a 200 with an
    // empty/blank assistant message. Also assert the session gained no messages.
    const empty: ChatSessionRecord = {
      id: SID, carId: CAR_ID, ownerId: OWNER, title: '', messages: [],
      createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:00:00.000Z',
    };
    await sessions.create(empty);
    const unavailable = new LlmUnavailableError();
    const failing: ChatDeps = { ...deps, llm: new InMemoryLlmProvider(null, unavailable) };
    await expect(handleChatRoute(
      failing,
      { ...post(`/cars/${CAR_ID}/chat/sessions/${SID}/messages`), body: { content: 'hello' } },
      OWNER, CAR_ID,
    )).rejects.toBe(unavailable);
    const stored = await sessions.getById(OWNER, CAR_ID, SID);
    expect(stored!.messages).toHaveLength(0);
  });

  it('persists committed actions when the provider dies mid-turn', async () => {
    // Round 1 creates a reminder; round 2 throws. The turn must still be recorded.
    const boom = new LlmUnavailableError();
    let round = 0;
    const flaky: LlmProvider = {
      extractEvents: async () => null,
      extractEventsFromDocument: async () => null,
      chatTurn: async () => {
        round += 1;
        if (round === 1) {
          return {
            text: '', raw: { r: 1 },
            toolCalls: [{
              id: 'tu1', name: 'create_reminder',
              input: { title: 'From chat', category: 'other', dueMileage: 150000 },
            }],
          };
        }
        throw boom;
      },
    };
    const empty: ChatSessionRecord = {
      id: SID, carId: CAR_ID, ownerId: OWNER, title: '', messages: [],
      createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:00:00.000Z',
    };
    await sessions.create(empty);
    const res = await handleChatRoute(
      { ...deps, llm: flaky },
      { ...post(`/cars/${CAR_ID}/chat/sessions/${SID}/messages`), body: { content: 'add a reminder' } },
      OWNER, CAR_ID,
    );
    expect(res?.statusCode).toBe(200);
    const { session } = JSON.parse(res!.body) as { session: ChatSession };
    const assistant = session.messages.at(-1)!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.actions[0]!.kind).toBe('create_reminder');
    expect(assistant.actions[0]!.status).toBe('done');
    // The write really happened — it must not be silently lost behind a 503.
    expect(await reminders.listByCar(OWNER, CAR_ID)).toHaveLength(2);
  });

  it('a confirm that lands while a message turn is in flight is not overwritten by that turn\'s save (Finding 5)', async () => {
    // The messages route calls the (slow) provider, then saves. If it saved off the
    // session snapshot it read BEFORE that call, a confirm/decline landing during the call
    // would be overwritten: the entity really got deleted, but the action snaps back to
    // "pending" in the persisted record, and re-tapping Confirm then 404s (no double
    // delete, but the status is wrong and visibly stuck). Orchestrate the race with a
    // manually-resolved deferred: chatTurn doesn't resolve until the test has awaited the
    // confirm call against the very same `deps`/`sessions`.
    await seedSession(pendingAction);
    let releaseProvider!: () => void;
    const gate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const gated: LlmProvider = {
      extractEvents: async () => null,
      extractEventsFromDocument: async () => null,
      chatTurn: async (): Promise<ChatTurnResult> => {
        await gate;
        return { text: 'Here is what I found.', toolCalls: [], raw: {} };
      },
    };

    const messagePromise = handleChatRoute(
      { ...deps, llm: gated },
      { ...post(`/cars/${CAR_ID}/chat/sessions/${SID}/messages`), body: { content: 'how are things?' } },
      OWNER, CAR_ID,
    );

    // The confirm lands and completes WHILE the message turn's provider call is still
    // gated open.
    const confirmRes = await handleChatRoute(
      deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID,
    );
    expect(confirmRes?.statusCode).toBe(200);
    expect(await reminders.getById(OWNER, CAR_ID, RID)).toBeNull(); // the delete really happened

    releaseProvider();
    const messageRes = await messagePromise;
    expect(messageRes?.statusCode).toBe(200);

    const saved = await sessions.getById(OWNER, CAR_ID, SID);
    // The confirm's status flip must have survived the message turn's save.
    const confirmedAction = saved!.messages
      .flatMap((m) => m.actions).find((a) => a.id === AID);
    expect(confirmedAction?.status).toBe('done');
    // And the new turn's user + assistant messages must also be present.
    expect(saved!.messages.some((m) => m.role === 'user' && m.content === 'how are things?')).toBe(true);
    expect(saved!.messages.some((m) => m.role === 'assistant' && m.content === 'Here is what I found.')).toBe(true);
  });
});
