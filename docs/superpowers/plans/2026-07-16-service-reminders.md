# Service Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-car maintenance reminders (date- and/or mileage-based, optional repeat interval), surfaced in-app on the vehicle page and garage cards, with a "mark done → log event" flow and automatic car-mileage updates from events.

**Architecture:** New `Reminder` Zod contract in `@carlog/contracts`; pure dueness/recurrence logic in `@carlog/domain`; DynamoDB rows under `SK = CAR#{carId}#REMINDER#{reminderId}` behind a `ReminderRepository` port; REST routes mirroring the events surface; React UI section + form dialog following `ServiceTimeline`/`EventFormDialog` patterns. Spec: `docs/superpowers/specs/2026-07-16-service-reminders-design.md`.

**Tech Stack:** TypeScript strict, Zod, Vitest, AWS Lambda + DynamoDB (single table), React + MUI + TanStack Query + React Hook Form, i18next (en/uk), CDK.

## Global Constraints

- `packages/domain` must NOT import the AWS SDK or anything infrastructure-flavored.
- Zod schemas in `packages/contracts` are the contract source of truth; derive all types with `z.infer`. Never hand-write duplicate types.
- Strict TS, never `any`. `type` aliases preferred; `interface` only for repository ports.
- Lambda handlers stay thin: parse → call domain → shape response.
- `MAX_REMINDERS_PER_CAR = 20`, `REMINDER_LEAD_DAYS = 30`, `REMINDER_LEAD_KM = 1000` (exact values from spec).
- DynamoDB key pattern: `PK = USER#{ownerId}`, `SK = CAR#{carId}#REMINDER#{reminderId}`.
- Conventional commits. NO `Co-Authored-By` / "Generated with Claude" trailers — ever.
- All gates green at the end: `pnpm turbo run build lint typecheck test`.
- Optional text fields use the empty-string→undefined pattern (`optText` in `packages/contracts/src/event.ts:10`).
- Domain functions take `today`/`now` as parameters or injectable deps — no hidden clock reads in logic under test.

---

### Task 1: Reminder contracts (`@carlog/contracts`)

**Files:**
- Create: `packages/contracts/src/reminder.ts`
- Create: `packages/contracts/src/reminder.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `ReminderSchema`, `CreateReminderSchema`, `CompleteReminderSchema`, types `Reminder`, `CreateReminderInput`, `CompleteReminderInput`, constants `MAX_REMINDERS_PER_CAR`, `REMINDER_LEAD_DAYS`, `REMINDER_LEAD_KM`. `Reminder` = `{ id: uuid, carId: uuid, ownerId, createdAt, updatedAt, title, category: EventCategory, notes?, dueDate?: 'YYYY-MM-DD', dueMileage?: number, repeatMonths?: number, repeatKm?: number }`.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/reminder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CreateReminderSchema, CompleteReminderSchema } from './reminder';

const base = { title: 'Oil change', category: 'oil_change' };

describe('CreateReminderSchema', () => {
  it('accepts a date-only reminder', () => {
    const r = CreateReminderSchema.parse({ ...base, dueDate: '2026-09-01' });
    expect(r.dueDate).toBe('2026-09-01');
    expect(r.dueMileage).toBeUndefined();
  });

  it('accepts a mileage-only reminder with repeat', () => {
    const r = CreateReminderSchema.parse({ ...base, dueMileage: 120000, repeatKm: 10000 });
    expect(r.repeatKm).toBe(10000);
  });

  it('rejects when neither dueDate nor dueMileage is set', () => {
    expect(() => CreateReminderSchema.parse(base)).toThrow();
  });

  it('rejects repeatMonths without dueDate', () => {
    expect(() => CreateReminderSchema.parse({ ...base, dueMileage: 120000, repeatMonths: 12 })).toThrow();
  });

  it('rejects repeatKm without dueMileage', () => {
    expect(() => CreateReminderSchema.parse({ ...base, dueDate: '2026-09-01', repeatKm: 10000 })).toThrow();
  });

  it('normalizes empty notes to undefined', () => {
    const r = CreateReminderSchema.parse({ ...base, dueDate: '2026-09-01', notes: '' });
    expect(r.notes).toBeUndefined();
  });

  it('rejects a malformed dueDate', () => {
    expect(() => CreateReminderSchema.parse({ ...base, dueDate: '01-09-2026' })).toThrow();
  });
});

describe('CompleteReminderSchema', () => {
  it('accepts a valid completion', () => {
    expect(CompleteReminderSchema.parse({ date: '2026-07-16', mileage: 95000 })).toEqual({ date: '2026-07-16', mileage: 95000 });
  });
  it('rejects negative mileage', () => {
    expect(() => CompleteReminderSchema.parse({ date: '2026-07-16', mileage: -1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/contracts test src/reminder.test.ts`
Expected: FAIL — cannot resolve `./reminder`.

- [ ] **Step 3: Write the implementation**

`packages/contracts/src/reminder.ts`:

```ts
import { z } from 'zod';
import { EventCategorySchema } from './event';

export const MAX_REMINDERS_PER_CAR = 20;
export const REMINDER_LEAD_DAYS = 30;
export const REMINDER_LEAD_KM = 1000;

// Same empty-string→undefined convention as event.ts optText: the form submits ''
// for cleared optional inputs.
const optText = (s: z.ZodString) => z.literal('').transform(() => undefined).or(s.optional());

const ReminderFieldsSchema = z.object({
  title: z.string().min(1).max(120),
  category: EventCategorySchema,
  notes: optText(z.string().max(500)),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  dueMileage: z.number().int().min(0).optional(),
  repeatMonths: z.number().int().min(1).max(120).optional(),
  repeatKm: z.number().int().min(100).optional(),
});

// A repeat interval without its base target is meaningless — there is nothing to advance.
const reminderRules = (r: z.infer<typeof ReminderFieldsSchema>, ctx: z.RefinementCtx): void => {
  if (r.dueDate === undefined && r.dueMileage === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'set dueDate or dueMileage', path: ['dueDate'] });
  }
  if (r.repeatMonths !== undefined && r.dueDate === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'repeatMonths requires dueDate', path: ['repeatMonths'] });
  }
  if (r.repeatKm !== undefined && r.dueMileage === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'repeatKm requires dueMileage', path: ['repeatKm'] });
  }
};

export const CreateReminderSchema = ReminderFieldsSchema.superRefine(reminderRules);

export const ReminderSchema = ReminderFieldsSchema.extend({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine(reminderRules);

export const CompleteReminderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  mileage: z.number().int().min(0),
});

export type Reminder = z.infer<typeof ReminderSchema>;
export type CreateReminderInput = z.infer<typeof CreateReminderSchema>;
export type CompleteReminderInput = z.infer<typeof CompleteReminderSchema>;
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './reminder';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/contracts test src/reminder.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/reminder.ts packages/contracts/src/reminder.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): Reminder schemas with due-target and repeat-interval rules"
```

---

### Task 2: Domain logic — dueness, recurrence, mileage bump (`@carlog/domain`)

**Files:**
- Create: `packages/domain/src/reminder.ts`
- Create: `packages/domain/src/reminder.test.ts`
- Create: `packages/domain/src/reminder-repository.ts`
- Modify: `packages/domain/src/car.ts` (add `bumpCarMileage`)
- Modify: `packages/domain/src/car.test.ts` (append tests)
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `Reminder`, `CreateReminderInput`, `CompleteReminderInput`, `REMINDER_LEAD_DAYS`, `REMINDER_LEAD_KM` from Task 1; `Car`, `CreateCarInput` from contracts.
- Produces:
  - `createReminder(ownerId: string, carId: string, input: CreateReminderInput, deps?: { newId?: () => string; now?: () => string }): Reminder`
  - `type ReminderStatus = 'overdue' | 'due_soon' | 'ok'`
  - `reminderStatus(reminder: Pick<Reminder, 'dueDate' | 'dueMileage'>, carMileage: number, today: string): ReminderStatus`
  - `addMonthsClamped(dateISO: string, months: number): string`
  - `completeReminder(reminder: Reminder, completion: CompleteReminderInput, deps?: { now?: () => string }): Reminder | null`
  - `bumpCarMileage(car: Car, mileage: number): CreateCarInput | null`
  - `class ReminderNotFoundError extends Error`
  - `interface ReminderRepository { create; listByCar; getById; update; delete }` (exact signatures below)

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/reminder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Reminder } from '@carlog/contracts';
import { addMonthsClamped, completeReminder, createReminder, reminderStatus } from './reminder';

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: '11111111-1111-4111-8111-111111111111',
  carId: '22222222-2222-4222-8222-222222222222',
  ownerId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Oil change',
  category: 'oil_change',
  dueDate: '2026-09-01',
  ...over,
});

describe('createReminder', () => {
  it('stamps id, ownership and timestamps', () => {
    const r = createReminder('u1', reminder().carId, { title: 'Oil', category: 'oil_change', dueDate: '2026-09-01' },
      { newId: () => reminder().id, now: () => '2026-07-16T00:00:00.000Z' });
    expect(r).toMatchObject({ id: reminder().id, ownerId: 'u1', carId: reminder().carId, createdAt: '2026-07-16T00:00:00.000Z' });
  });
});

describe('reminderStatus', () => {
  it('is ok well before the due date', () => {
    expect(reminderStatus(reminder(), 50000, '2026-07-16')).toBe('ok');
  });
  it('is due_soon exactly at the lead-window edge (30 days)', () => {
    expect(reminderStatus(reminder({ dueDate: '2026-08-15' }), 50000, '2026-07-16')).toBe('due_soon');
  });
  it('is overdue on the due date itself', () => {
    expect(reminderStatus(reminder({ dueDate: '2026-07-16' }), 50000, '2026-07-16')).toBe('overdue');
  });
  it('is due_soon within 1000 km of due mileage', () => {
    expect(reminderStatus(reminder({ dueDate: undefined, dueMileage: 50900 }), 50000, '2026-07-16')).toBe('due_soon');
  });
  it('is overdue at exactly the due mileage', () => {
    expect(reminderStatus(reminder({ dueDate: undefined, dueMileage: 50000 }), 50000, '2026-07-16')).toBe('overdue');
  });
  it('with both targets, the more urgent one wins', () => {
    // date far away, mileage already passed
    expect(reminderStatus(reminder({ dueDate: '2027-01-01', dueMileage: 49000 }), 50000, '2026-07-16')).toBe('overdue');
  });
});

describe('addMonthsClamped', () => {
  it('adds calendar months', () => {
    expect(addMonthsClamped('2026-07-16', 12)).toBe('2027-07-16');
  });
  it('clamps month-end (Jan 31 + 1 month = Feb 28)', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('handles year rollover', () => {
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('completeReminder', () => {
  it('returns null for a one-shot reminder', () => {
    expect(completeReminder(reminder(), { date: '2026-07-16', mileage: 51000 })).toBeNull();
  });
  it('advances dueDate from the completion date by repeatMonths', () => {
    const next = completeReminder(reminder({ repeatMonths: 6 }), { date: '2026-07-20', mileage: 51000 },
      { now: () => '2026-07-20T10:00:00.000Z' });
    expect(next).toMatchObject({ dueDate: '2027-01-20', updatedAt: '2026-07-20T10:00:00.000Z' });
    expect(next?.dueMileage).toBeUndefined();
  });
  it('advances dueMileage from the completion mileage by repeatKm', () => {
    const next = completeReminder(reminder({ dueDate: undefined, dueMileage: 50000, repeatKm: 10000 }),
      { date: '2026-07-20', mileage: 51234 });
    expect(next?.dueMileage).toBe(61234);
    expect(next?.dueDate).toBeUndefined();
  });
  it('drops a target that has no repeat interval', () => {
    // dueDate had no repeatMonths → next occurrence is mileage-only
    const next = completeReminder(reminder({ dueDate: '2026-09-01', dueMileage: 50000, repeatKm: 10000 }),
      { date: '2026-07-20', mileage: 51000 });
    expect(next?.dueDate).toBeUndefined();
    expect(next?.dueMileage).toBe(61000);
  });
  it('keeps the same id', () => {
    const next = completeReminder(reminder({ repeatMonths: 6 }), { date: '2026-07-20', mileage: 0 });
    expect(next?.id).toBe(reminder().id);
  });
});
```

Append to `packages/domain/src/car.test.ts`:

```ts
import { bumpCarMileage } from './car';

describe('bumpCarMileage', () => {
  const car = {
    id: '33333333-3333-4333-8333-333333333333', ownerId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    make: 'Toyota', model: 'Corolla', year: 2020, mileage: 50000, fuelType: 'petrol' as const,
    nickname: undefined, vin: undefined, licensePlate: undefined,
  };
  it('returns update input when the new mileage is higher', () => {
    expect(bumpCarMileage(car, 51000)).toMatchObject({ make: 'Toyota', mileage: 51000 });
  });
  it('returns null when equal or lower', () => {
    expect(bumpCarMileage(car, 50000)).toBeNull();
    expect(bumpCarMileage(car, 49999)).toBeNull();
  });
});
```

(If `car.test.ts` already imports from `./car`, merge the import instead of duplicating it. Keep existing tests untouched.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @carlog/domain test src/reminder.test.ts src/car.test.ts`
Expected: FAIL — `./reminder` unresolved, `bumpCarMileage` not exported.

- [ ] **Step 3: Write the implementation**

`packages/domain/src/reminder.ts`:

```ts
import {
  CreateReminderSchema, REMINDER_LEAD_DAYS, REMINDER_LEAD_KM,
  type CompleteReminderInput, type CreateReminderInput, type Reminder,
} from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreateReminderDeps = { newId?: () => string; now?: () => string };

export function createReminder(
  ownerId: string, carId: string, input: CreateReminderInput, deps: CreateReminderDeps = {},
): Reminder {
  const data = CreateReminderSchema.parse(input);
  const timestamp = (deps.now ?? nowIso)();
  return { ...data, id: (deps.newId ?? defaultNewId)(), carId, ownerId, createdAt: timestamp, updatedAt: timestamp };
}

export type ReminderStatus = 'overdue' | 'due_soon' | 'ok';

const addDaysISO = (dateISO: string, days: number): string => {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Classification is read-time and pure; `today` is injected (YYYY-MM-DD) so tests
// and the API share one clock convention. Due ON the due date/mileage = overdue.
// NOTE: mirrored in apps/web/src/lib/reminder-view.ts (domain isn't browser-safe);
// keep the two in sync.
export function reminderStatus(
  reminder: Pick<Reminder, 'dueDate' | 'dueMileage'>, carMileage: number, today: string,
): ReminderStatus {
  const dateOverdue = reminder.dueDate !== undefined && today >= reminder.dueDate;
  const kmOverdue = reminder.dueMileage !== undefined && carMileage >= reminder.dueMileage;
  if (dateOverdue || kmOverdue) return 'overdue';
  const dateSoon = reminder.dueDate !== undefined && addDaysISO(today, REMINDER_LEAD_DAYS) >= reminder.dueDate;
  const kmSoon = reminder.dueMileage !== undefined && carMileage + REMINDER_LEAD_KM >= reminder.dueMileage;
  if (dateSoon || kmSoon) return 'due_soon';
  return 'ok';
}

// Calendar-month addition with month-end clamping (Jan 31 + 1mo → Feb 28).
export function addMonthsClamped(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12; // 0-based month
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export type CompleteReminderDeps = { now?: () => string };

// Next occurrence is anchored to the COMPLETION date/mileage, not the original due
// target — "every 6 months" means 6 months from when you actually did it.
// A target without its repeat interval is dropped from the next occurrence.
export function completeReminder(
  reminder: Reminder, completion: CompleteReminderInput, deps: CompleteReminderDeps = {},
): Reminder | null {
  const repeating = reminder.repeatMonths !== undefined || reminder.repeatKm !== undefined;
  if (!repeating) return null;
  return {
    ...reminder,
    dueDate: reminder.repeatMonths !== undefined ? addMonthsClamped(completion.date, reminder.repeatMonths) : undefined,
    dueMileage: reminder.repeatKm !== undefined ? completion.mileage + reminder.repeatKm : undefined,
    updatedAt: (deps.now ?? nowIso)(),
  };
}

export class ReminderNotFoundError extends Error {
  constructor(id: string) { super(`Reminder ${id} not found`); this.name = 'ReminderNotFoundError'; }
}
```

`packages/domain/src/reminder-repository.ts`:

```ts
import type { Reminder, CreateReminderInput } from '@carlog/contracts';

export interface ReminderRepository {
  create(reminder: Reminder): Promise<Reminder>;
  listByCar(ownerId: string, carId: string): Promise<Reminder[]>;
  getById(ownerId: string, carId: string, reminderId: string): Promise<Reminder | null>;
  update(ownerId: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder>;
  delete(ownerId: string, carId: string, reminderId: string): Promise<void>;
}
```

Append to `packages/domain/src/car.ts`:

```ts
// Events (and reminder completions) carry odometer readings; the car's mileage
// field must never lag behind them. Returns the update input when a bump is
// needed, null when the reading isn't newer.
export function bumpCarMileage(car: Car, mileage: number): CreateCarInput | null {
  if (mileage <= car.mileage) return null;
  return {
    make: car.make, model: car.model, year: car.year, mileage,
    fuelType: car.fuelType, nickname: car.nickname, vin: car.vin, licensePlate: car.licensePlate,
  };
}
```

Append to `packages/domain/src/index.ts`:

```ts
export * from './reminder';
export * from './reminder-repository';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @carlog/domain test src/reminder.test.ts src/car.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/reminder.ts packages/domain/src/reminder.test.ts packages/domain/src/reminder-repository.ts packages/domain/src/car.ts packages/domain/src/car.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): reminder dueness/recurrence logic, repository port, car mileage bump"
```

---

### Task 3: API persistence — keys and repositories

**Files:**
- Create: `apps/api/src/reminder-key.ts`
- Create: `apps/api/src/reminder-key.test.ts`
- Create: `apps/api/src/dynamo-reminder-repository.ts`
- Create: `apps/api/src/in-memory-reminder-repository.ts`

**Interfaces:**
- Consumes: `ReminderRepository`, `ReminderNotFoundError` (Task 2); `MAX_REMINDERS_PER_CAR`, `Reminder`, `CreateReminderInput` (Task 1); `CapExceededError` from `@carlog/domain`.
- Produces: `reminderSk(carId, reminderId)`, `isReminderRow(sk)`, `assertReminderUnderCap(count)`, `DynamoReminderRepository`, `InMemoryReminderRepository`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/reminder-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertReminderUnderCap, isReminderRow, reminderSk } from './reminder-key';

describe('reminder keys', () => {
  it('builds the reminder SK', () => {
    expect(reminderSk('c1', 'r1')).toBe('CAR#c1#REMINDER#r1');
  });
  it('identifies reminder rows and rejects others', () => {
    expect(isReminderRow('CAR#c1#REMINDER#r1')).toBe(true);
    expect(isReminderRow('CAR#c1#EVENT#e1')).toBe(false);
    expect(isReminderRow('CAR#c1')).toBe(false);
  });
  it('throws CapExceededError at the cap', () => {
    expect(() => assertReminderUnderCap(20)).toThrow('limit');
    expect(() => assertReminderUnderCap(19)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/api test src/reminder-key.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`apps/api/src/reminder-key.ts`:

```ts
import { MAX_REMINDERS_PER_CAR } from '@carlog/contracts';
import { CapExceededError } from '@carlog/domain';

export const reminderSk = (carId: string, reminderId: string): string => `CAR#${carId}#REMINDER#${reminderId}`;

export const isReminderRow = (sk: string): boolean => sk.includes('#REMINDER#');

export function assertReminderUnderCap(count: number): void {
  if (count >= MAX_REMINDERS_PER_CAR) throw new CapExceededError();
}
```

`apps/api/src/dynamo-reminder-repository.ts` (mirrors `dynamo-event-repository.ts`):

```ts
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { Reminder, CreateReminderInput } from '@carlog/contracts';
import { ReminderNotFoundError, type ReminderRepository } from '@carlog/domain';
import { reminderSk, isReminderRow } from './reminder-key';

const pk = (ownerId: string) => `USER#${ownerId}`;
type Row = Reminder & { PK: string; SK: string };
const toRow = (r: Reminder): Row => ({ ...r, PK: pk(r.ownerId), SK: reminderSk(r.carId, r.id) });
const toReminder = (row: Record<string, unknown>): Reminder => {
  const { PK, SK, ...reminder } = row as Row;
  return reminder;
};

export class DynamoReminderRepository implements ReminderRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(reminder: Reminder): Promise<Reminder> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(reminder) }));
    return reminder;
  }
  async listByCar(ownerId: string, carId: string): Promise<Reminder[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#REMINDER#` },
    }));
    return (res.Items ?? []).filter((i) => isReminderRow(String((i as Row).SK))).map(toReminder);
  }
  async getById(ownerId: string, carId: string, reminderId: string): Promise<Reminder | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: reminderSk(carId, reminderId) } }));
    return res.Item ? toReminder(res.Item) : null;
  }
  async update(ownerId: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder> {
    const existing = await this.getById(ownerId, carId, reminderId);
    if (!existing) throw new ReminderNotFoundError(reminderId);
    const updated: Reminder = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(updated) }));
    return updated;
  }
  async delete(ownerId: string, carId: string, reminderId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: reminderSk(carId, reminderId) } }));
  }
}
```

`apps/api/src/in-memory-reminder-repository.ts` (mirrors `in-memory-event-repository.ts`):

```ts
import type { Reminder, CreateReminderInput } from '@carlog/contracts';
import { ReminderNotFoundError, type ReminderRepository } from '@carlog/domain';
import { reminderSk, isReminderRow } from './reminder-key';

export class InMemoryReminderRepository implements ReminderRepository {
  private rows = new Map<string, Reminder>();
  private k(ownerId: string, sk: string) { return `${ownerId}|${sk}`; }

  async create(reminder: Reminder): Promise<Reminder> {
    this.rows.set(this.k(reminder.ownerId, reminderSk(reminder.carId, reminder.id)), reminder);
    return reminder;
  }
  async listByCar(ownerId: string, carId: string): Promise<Reminder[]> {
    const prefix = `CAR#${carId}#REMINDER#`;
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${ownerId}|`))
      .map(([key, r]) => [key.slice(ownerId.length + 1), r] as const)
      .filter(([sk]) => sk.startsWith(prefix) && isReminderRow(sk))
      .map(([, r]) => r);
  }
  async getById(ownerId: string, carId: string, reminderId: string): Promise<Reminder | null> {
    return this.rows.get(this.k(ownerId, reminderSk(carId, reminderId))) ?? null;
  }
  async update(ownerId: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder> {
    const existing = this.rows.get(this.k(ownerId, reminderSk(carId, reminderId)));
    if (!existing) throw new ReminderNotFoundError(reminderId);
    const updated: Reminder = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    this.rows.set(this.k(ownerId, reminderSk(carId, reminderId)), updated);
    return updated;
  }
  async delete(ownerId: string, carId: string, reminderId: string): Promise<void> {
    this.rows.delete(this.k(ownerId, reminderSk(carId, reminderId)));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/api test src/reminder-key.test.ts`
Expected: PASS. Also run `pnpm --filter @carlog/api typecheck` — both repositories must compile against the port.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reminder-key.ts apps/api/src/reminder-key.test.ts apps/api/src/dynamo-reminder-repository.ts apps/api/src/in-memory-reminder-repository.ts
git commit -m "feat(api): reminder DynamoDB keys and repositories"
```

---

### Task 4: API routes — reminder CRUD + complete, router/handler wiring

**Files:**
- Create: `apps/api/src/reminder-routes.ts`
- Modify: `apps/api/src/router.ts` (deps + dispatch branch)
- Modify: `apps/api/src/errors.ts` (map `ReminderNotFoundError` → 404)
- Modify: `apps/api/src/handler.ts` (instantiate `DynamoReminderRepository`)
- Modify: `apps/api/src/router.test.ts` (deps + new describe block)

**Interfaces:**
- Consumes: Tasks 1–3 exports; `bumpCarMileage` from Task 2.
- Produces: routes `GET/POST /cars/{id}/reminders`, `PUT/DELETE /cars/{id}/reminders/{reminderId}`, `POST /cars/{id}/reminders/{reminderId}/complete` (200 next Reminder / 204 one-shot deleted). `RouteDeps` gains `reminders: ReminderRepository`. Path params: `{id}` = carId, `{reminderId}`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/router.test.ts` — extend the deps setup:

```ts
// add imports
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
```

In the `deps` type add `reminders: InMemoryReminderRepository;` and in `beforeEach` add `reminders: new InMemoryReminderRepository(),`.

Append a describe block:

```ts
describe('reminder routes', () => {
  const carBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 50000, fuelType: 'petrol' };
  const reminderBody = { title: 'Oil change', category: 'oil_change', dueDate: '2099-01-01', repeatMonths: 6 };

  async function makeCar(ownerId = 'u1'): Promise<string> {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: carBody });
    return JSON.parse(res.body).id as string;
  }

  it('POST creates a reminder scoped to the owner and car', async () => {
    const carId = await makeCar();
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ title: 'Oil change', carId, ownerId: 'u1' });
  });

  it('GET lists only that car reminders', async () => {
    const carId = await makeCar();
    await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
    const res = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId } });
    expect(JSON.parse(res.body)).toHaveLength(1);
  });

  it('404s for another owner', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u2', pathParams: { id: carId } });
    expect(res.statusCode).toBe(404);
  });

  it('400s when neither dueDate nor dueMileage is set', async () => {
    const carId = await makeCar();
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: { title: 'x', category: 'other' } });
    expect(res.statusCode).toBe(400);
  });

  it('409s at the 20-reminder cap', async () => {
    const carId = await makeCar();
    for (let i = 0; i < 20; i++) {
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
    }
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
    expect(res.statusCode).toBe(409);
  });

  it('PUT updates and DELETE removes', async () => {
    const carId = await makeCar();
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody })).body);
    const put = await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/reminders/${created.id}`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id }, body: { ...reminderBody, title: 'Renamed' } });
    expect(JSON.parse(put.body).title).toBe('Renamed');
    const del = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/reminders/${created.id}`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id } });
    expect(del.statusCode).toBe(204);
    const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId } });
    expect(JSON.parse(list.body)).toHaveLength(0);
  });

  it('complete on a repeating reminder returns the next occurrence and bumps car mileage', async () => {
    const carId = await makeCar();
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody })).body);
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders/${created.id}/complete`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id }, body: { date: '2026-07-16', mileage: 60000 } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ id: created.id, dueDate: '2027-01-16' });
    const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
    expect(car.mileage).toBe(60000);
  });

  it('complete on a one-shot reminder deletes it and returns 204', async () => {
    const carId = await makeCar();
    const oneShot = { title: 'Inspection', category: 'inspection', dueDate: '2099-01-01' };
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: oneShot })).body);
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders/${created.id}/complete`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id }, body: { date: '2026-07-16', mileage: 0 } });
    expect(res.statusCode).toBe(204);
    const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId } });
    expect(JSON.parse(list.body)).toHaveLength(0);
  });

  it('complete 404s on a missing reminder', async () => {
    const carId = await makeCar();
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders/00000000-0000-4000-8000-000000000000/complete`, ownerId: 'u1', pathParams: { id: carId, reminderId: '00000000-0000-4000-8000-000000000000' }, body: { date: '2026-07-16', mileage: 0 } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @carlog/api test src/router.test.ts`
Expected: FAIL — `reminders` missing from RouteDeps / routes return 404 NoRoute.

- [ ] **Step 3: Write the implementation**

`apps/api/src/reminder-routes.ts`:

```ts
import { CreateReminderSchema, CompleteReminderSchema } from '@carlog/contracts';
import {
  CarNotFoundError, ReminderNotFoundError, createReminder, completeReminder, bumpCarMileage,
  type CarRepository, type ReminderRepository,
} from '@carlog/domain';
import type { Car } from '@carlog/contracts';
import { ok, type ApiResult } from './errors';
import { assertReminderUnderCap } from './reminder-key';
import type { ApiEvent } from './router';

export type ReminderDeps = { cars: CarRepository; reminders: ReminderRepository };

// Handles /cars/{carId}/reminders* ; returns null if not matched.
export async function handleReminderRoute(
  deps: ReminderDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body } = event;
  const base = `/cars/${carId}/reminders`;
  const reminderId = pathParams.reminderId;

  const car: Car | null = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);

  if (path === base && method === 'GET') {
    return ok(200, await deps.reminders.listByCar(ownerId, carId));
  }
  if (path === base && method === 'POST') {
    const existing = await deps.reminders.listByCar(ownerId, carId);
    assertReminderUnderCap(existing.length);
    const reminder = createReminder(ownerId, carId, CreateReminderSchema.parse(body));
    return ok(201, await deps.reminders.create(reminder));
  }
  if (reminderId && path === `${base}/${reminderId}/complete` && method === 'POST') {
    const completion = CompleteReminderSchema.parse(body);
    const reminder = await deps.reminders.getById(ownerId, carId, reminderId);
    if (!reminder) throw new ReminderNotFoundError(reminderId);
    const next = completeReminder(reminder, completion);
    if (next) await deps.reminders.create(next); // Put overwrites the same key
    else await deps.reminders.delete(ownerId, carId, reminderId);
    const bumped = bumpCarMileage(car, completion.mileage);
    if (bumped) await deps.cars.update(ownerId, carId, bumped);
    return next ? ok(200, next) : ok(204, null);
  }
  if (reminderId && path === `${base}/${reminderId}` && method === 'PUT') {
    const existing = await deps.reminders.getById(ownerId, carId, reminderId);
    if (!existing) throw new ReminderNotFoundError(reminderId);
    return ok(200, await deps.reminders.update(ownerId, carId, reminderId, CreateReminderSchema.parse(body)));
  }
  if (reminderId && path === `${base}/${reminderId}` && method === 'DELETE') {
    const existing = await deps.reminders.getById(ownerId, carId, reminderId);
    if (!existing) throw new ReminderNotFoundError(reminderId);
    await deps.reminders.delete(ownerId, carId, reminderId);
    return ok(204, null);
  }
  return null;
}
```

`apps/api/src/router.ts` — three edits:

1. Extend the domain import: add `type ReminderRepository` to the existing `@carlog/domain` import.
2. Add to `RouteDeps`: `reminders: ReminderRepository;`
3. Add the dispatch branch directly after the events branch (after line 66):

```ts
    if (id && path.startsWith(`/cars/${id}/reminders`)) {
      const result = await handleReminderRoute({ cars: deps.cars, reminders: deps.reminders }, event, ownerId, id);
      if (result) return result;
    }
```

with `import { handleReminderRoute } from './reminder-routes';` at the top.

`apps/api/src/errors.ts` — add `ReminderNotFoundError` to the `@carlog/domain` import and extend the existing event/proof 404 branch:

```ts
    if (err instanceof EventNotFoundError || err instanceof ProofNotFoundError || err instanceof ReminderNotFoundError) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'NotFound', message: err.message }) };
    }
```

`apps/api/src/handler.ts` — add:

```ts
import { DynamoReminderRepository } from './dynamo-reminder-repository';
```

and in `deps`: `reminders: new DynamoReminderRepository(tableName, client),`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @carlog/api test`
Expected: PASS — all new reminder tests plus every pre-existing test (no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reminder-routes.ts apps/api/src/router.ts apps/api/src/errors.ts apps/api/src/handler.ts apps/api/src/router.test.ts
git commit -m "feat(api): reminder CRUD + complete routes with recurrence and mileage bump"
```

---

### Task 5: Auto-bump car mileage from events

**Files:**
- Modify: `apps/api/src/event-routes.ts`
- Modify: `apps/api/src/router.test.ts` (append tests)

**Interfaces:**
- Consumes: `bumpCarMileage` (Task 2). `requireCar` in event-routes changes from `Promise<void>` to `Promise<Car>` — internal to the file, no external callers.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/router.test.ts`:

```ts
describe('car mileage auto-bump from events', () => {
  const carBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 50000, fuelType: 'petrol' };
  const eventBody = { date: '2026-07-01', mileage: 55000, cost: 100, category: 'oil_change' };

  it('POST event with higher mileage bumps the car', async () => {
    const carId = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: carBody })).body).id;
    await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: eventBody });
    const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
    expect(car.mileage).toBe(55000);
  });

  it('POST event with lower mileage (backdated) leaves the car unchanged', async () => {
    const carId = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: carBody })).body).id;
    await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: { ...eventBody, mileage: 30000 } });
    const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
    expect(car.mileage).toBe(50000);
  });

  it('PUT event with higher mileage bumps the car', async () => {
    const carId = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: carBody })).body).id;
    const ev = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: eventBody })).body);
    await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/events/${ev.id}`, ownerId: 'u1', pathParams: { id: carId, eventId: ev.id }, body: { ...eventBody, mileage: 60000 } });
    const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
    expect(car.mileage).toBe(60000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @carlog/api test src/router.test.ts`
Expected: FAIL — car mileage stays 50000 after event writes.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/event-routes.ts`:

1. Add `bumpCarMileage` to the `@carlog/domain` import and `type Car` to the `@carlog/contracts` type imports.
2. Change `requireCar` to return the car:

```ts
async function requireCar(deps: EventDeps, ownerId: string, carId: string): Promise<Car> {
  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);
  return car;
}
```

3. In the `POST ${base}` branch:

```ts
  if (path === base && method === 'POST') {
    const car = await requireCar(deps, ownerId, carId);
    const ev = createEvent(ownerId, carId, CreateEventSchema.parse(body));
    const created = await deps.events.create(ev);
    // Odometer readings on events keep the car's mileage current (spec: mileage auto-update).
    const bumped = bumpCarMileage(car, ev.mileage);
    if (bumped) await deps.cars.update(ownerId, carId, bumped);
    return ok(201, created);
  }
```

4. In the `PUT ${base}/${eventId}` branch:

```ts
  if (eventId && path === `${base}/${eventId}` && method === 'PUT') {
    const car = await requireCar(deps, ownerId, carId);
    await requireEvent(deps, ownerId, carId, eventId);
    const input = CreateEventSchema.parse(body);
    const updated = await deps.events.update(ownerId, carId, eventId, input);
    const bumped = bumpCarMileage(car, input.mileage);
    if (bumped) await deps.cars.update(ownerId, carId, bumped);
    return ok(200, updated);
  }
```

(Other `requireCar` call sites ignore the return value — no changes needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @carlog/api test`
Expected: PASS, including all pre-existing event tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/event-routes.ts apps/api/src/router.test.ts
git commit -m "feat(api): auto-bump car mileage from event odometer readings"
```

---

### Task 6: CDK — register reminder routes

**Files:**
- Modify: `infrastructure/cdk/lib/carlog-stack.ts` (after the proofs `{proofId}` route, line ~175)

**Interfaces:**
- Consumes: existing `httpApi`, `integration`, `authorizer` locals.

- [ ] **Step 1: Add the routes**

```ts
    httpApi.addRoutes({ path: '/cars/{id}/reminders', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders/{reminderId}', methods: [HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders/{reminderId}/complete', methods: [HttpMethod.POST], integration, authorizer });
```

- [ ] **Step 2: Verify synth**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth`
Expected: synth succeeds; template contains `POST /cars/{id}/reminders/{reminderId}/complete`.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(cdk): API Gateway routes for reminders"
```

---

### Task 7: Web data layer — api-client, queries, view helpers

**Files:**
- Modify: `apps/web/src/api-client.ts`
- Modify: `apps/web/src/queries.ts`
- Create: `apps/web/src/lib/reminder-view.ts`
- Create: `apps/web/src/lib/reminder-view.test.ts`

**Interfaces:**
- Consumes: `ReminderSchema`, `Reminder`, `CreateReminderInput`, `CompleteReminderInput`, `REMINDER_LEAD_DAYS`, `REMINDER_LEAD_KM` from contracts; existing `request` helper.
- Produces:
  - api-client: `getReminders(token, carId)`, `createReminder(token, carId, input)`, `updateReminder(token, carId, reminderId, input)`, `deleteReminder(token, carId, reminderId)`, `completeReminder(token, carId, reminderId, input): Promise<Reminder | undefined>` (undefined on 204).
  - queries: `useReminders(carId)` (key `['cars', carId, 'reminders']`), `useCreateReminder(carId)`, `useUpdateReminder(carId)` (arg `{ reminderId, input }`), `useDeleteReminder(carId)`, `useCompleteReminder(carId)` (arg `{ reminderId, input }`, invalidates reminders + car queries).
  - reminder-view: `type ReminderStatus`, `todayISO(): string`, `daysUntil(today, dueDate): number`, `reminderStatus(reminder, carMileage, today)`, `sortReminders(reminders, carMileage, today): Reminder[]`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/reminder-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Reminder } from '@carlog/contracts';
import { daysUntil, reminderStatus, sortReminders } from './reminder-view';

const r = (over: Partial<Reminder>): Reminder => ({
  id: crypto.randomUUID(), carId: crypto.randomUUID(), ownerId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'x', category: 'other', ...over,
});

describe('daysUntil', () => {
  it('counts calendar days', () => {
    expect(daysUntil('2026-07-16', '2026-07-20')).toBe(4);
    expect(daysUntil('2026-07-16', '2026-07-16')).toBe(0);
    expect(daysUntil('2026-07-16', '2026-07-10')).toBe(-6);
  });
});

describe('reminderStatus (mirror of domain)', () => {
  it('classifies overdue / due_soon / ok', () => {
    expect(reminderStatus(r({ dueDate: '2026-07-16' }), 0, '2026-07-16')).toBe('overdue');
    expect(reminderStatus(r({ dueDate: '2026-08-10' }), 0, '2026-07-16')).toBe('due_soon');
    expect(reminderStatus(r({ dueDate: '2026-12-01' }), 0, '2026-07-16')).toBe('ok');
    expect(reminderStatus(r({ dueMileage: 50500 }), 50000, '2026-07-16')).toBe('due_soon');
  });
});

describe('sortReminders', () => {
  it('orders overdue → due_soon → ok, then by nearest date', () => {
    const ok = r({ dueDate: '2026-12-01', title: 'ok' });
    const soonLater = r({ dueDate: '2026-08-10', title: 'soonLater' });
    const soonNear = r({ dueDate: '2026-07-20', title: 'soonNear' });
    const over = r({ dueDate: '2026-07-01', title: 'over' });
    const sorted = sortReminders([ok, soonLater, soonNear, over], 0, '2026-07-16');
    expect(sorted.map((x) => x.title)).toEqual(['over', 'soonNear', 'soonLater', 'ok']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/web test src/lib/reminder-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/reminder-view.ts`:

```ts
import { REMINDER_LEAD_DAYS, REMINDER_LEAD_KM, type Reminder } from '@carlog/contracts';

export type ReminderStatus = 'overdue' | 'due_soon' | 'ok';

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const daysUntil = (today: string, dueDate: string): number =>
  Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

const addDaysISO = (dateISO: string, days: number): string => {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Mirrors packages/domain/src/reminder.ts reminderStatus — the domain package
// isn't browser-safe (node:crypto), so the classification is duplicated here.
// Keep the two implementations in sync.
export function reminderStatus(
  reminder: Pick<Reminder, 'dueDate' | 'dueMileage'>, carMileage: number, today: string,
): ReminderStatus {
  const dateOverdue = reminder.dueDate !== undefined && today >= reminder.dueDate;
  const kmOverdue = reminder.dueMileage !== undefined && carMileage >= reminder.dueMileage;
  if (dateOverdue || kmOverdue) return 'overdue';
  const dateSoon = reminder.dueDate !== undefined && addDaysISO(today, REMINDER_LEAD_DAYS) >= reminder.dueDate;
  const kmSoon = reminder.dueMileage !== undefined && carMileage + REMINDER_LEAD_KM >= reminder.dueMileage;
  if (dateSoon || kmSoon) return 'due_soon';
  return 'ok';
}

const STATUS_RANK: Record<ReminderStatus, number> = { overdue: 0, due_soon: 1, ok: 2 };

// Urgency first; within a status, nearest due date, then smallest km remaining.
export function sortReminders(reminders: Reminder[], carMileage: number, today: string): Reminder[] {
  return [...reminders].sort((a, b) => {
    const rank = STATUS_RANK[reminderStatus(a, carMileage, today)] - STATUS_RANK[reminderStatus(b, carMileage, today)];
    if (rank !== 0) return rank;
    const byDate = (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
    if (byDate !== 0) return byDate;
    return (a.dueMileage ?? Infinity) - (b.dueMileage ?? Infinity);
  });
}
```

Append to `apps/web/src/api-client.ts` (extend the contracts import with `ReminderSchema`, `type Reminder`, `type CreateReminderInput`, `type CompleteReminderInput`):

```ts
const ReminderListSchema = z.array(ReminderSchema);
const reminderBase = (carId: string) => `/cars/${carId}/reminders`;

export const getReminders = (token: string, carId: string): Promise<Reminder[]> =>
  request(token, reminderBase(carId), ReminderListSchema);
export const createReminder = (token: string, carId: string, input: CreateReminderInput): Promise<Reminder> =>
  request(token, reminderBase(carId), ReminderSchema, { method: 'POST', body: JSON.stringify(input) });
export const updateReminder = (token: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder> =>
  request(token, `${reminderBase(carId)}/${reminderId}`, ReminderSchema, { method: 'PUT', body: JSON.stringify(input) });
export const deleteReminder = (token: string, carId: string, reminderId: string): Promise<void> =>
  request(token, `${reminderBase(carId)}/${reminderId}`, ReminderSchema, { method: 'DELETE' }).then(() => undefined);
// 200 → the rescheduled next occurrence; 204 (one-shot, deleted) → undefined.
export const completeReminder = (token: string, carId: string, reminderId: string, input: CompleteReminderInput): Promise<Reminder | undefined> =>
  request(token, `${reminderBase(carId)}/${reminderId}/complete`, ReminderSchema, { method: 'POST', body: JSON.stringify(input) });
```

Append to `apps/web/src/queries.ts` (extend the file's existing single import lines — the new names don't collide with anything already imported there):

```ts
import type { CreateReminderInput, CompleteReminderInput } from '@carlog/contracts';
import { getReminders, createReminder, updateReminder, deleteReminder, completeReminder } from './api-client';

export function useReminders(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars', carId, 'reminders'], queryFn: () => getReminders(token, carId), enabled: Boolean(token && carId) });
}
export function useCreateReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateReminderInput) => createReminder(token, carId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] }) });
}
export function useUpdateReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: ({ reminderId, input }: { reminderId: string; input: CreateReminderInput }) => updateReminder(token, carId, reminderId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] }) });
}
export function useDeleteReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (reminderId: string) => deleteReminder(token, carId, reminderId), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] }) });
}
export function useCompleteReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reminderId, input }: { reminderId: string; input: CompleteReminderInput }) => completeReminder(token, carId, reminderId, input),
    // Completion may bump car.mileage server-side — refresh the car too.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] });
      void qc.invalidateQueries({ queryKey: ['cars', carId] });
      void qc.invalidateQueries({ queryKey: ['cars'] });
    },
  });
}
```

(Merge these imports into the file's existing import lines rather than adding duplicate import statements.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @carlog/web test src/lib/reminder-view.test.ts && pnpm --filter @carlog/web typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api-client.ts apps/web/src/queries.ts apps/web/src/lib/reminder-view.ts apps/web/src/lib/reminder-view.test.ts
git commit -m "feat(web): reminder api-client, queries, and urgency view helpers"
```

---

### Task 8: Web i18n — `reminders` namespace (en + uk)

**Files:**
- Create: `apps/web/src/i18n/locales/en/reminders.json`
- Create: `apps/web/src/i18n/locales/uk/reminders.json`
- Modify: `apps/web/src/i18n/index.ts`

- [ ] **Step 1: Create the locale files**

`apps/web/src/i18n/locales/en/reminders.json`:

```json
{
  "sectionTitle": "Reminders",
  "add": "Add reminder",
  "empty": "No reminders yet. Add one to get nudged before service is due.",
  "loadError": "Could not load reminders.",
  "addTitle": "Add reminder",
  "editTitle": "Edit reminder",
  "deleteTitle": "Delete reminder",
  "deleteConfirm": "Delete this reminder? This can't be undone.",
  "title": "Title",
  "category": "Category",
  "notes": "Notes",
  "dueDate": "Due date",
  "dueMileage": "Due mileage (km)",
  "repeatMonths": "Repeat every (months)",
  "repeatKm": "Repeat every (km)",
  "repeats": "Repeats",
  "done": "Done",
  "completeTitle": "Mark as done",
  "completeDate": "Completion date",
  "completeMileage": "Mileage at completion",
  "complete": "Complete",
  "completeFailed": "Could not complete. Please try again.",
  "save": "Save",
  "saveChanges": "Save changes",
  "saveFailed": "Could not save. Please try again.",
  "errorRequired": "This field is required",
  "errorNeedTarget": "Set a due date or a due mileage",
  "errorRepeatNeedsDate": "Repeating by months needs a due date",
  "errorRepeatNeedsMileage": "Repeating by km needs a due mileage",
  "errorFixFields": "Please fix the highlighted fields",
  "status_overdue": "Overdue",
  "status_due_soon": "Due soon",
  "dueToday": "due today",
  "dueInDays_one": "in {{count}} day",
  "dueInDays_other": "in {{count}} days",
  "overdueDays_one": "{{count}} day overdue",
  "overdueDays_other": "{{count}} days overdue",
  "dueInKm": "in {{count}} km",
  "overdueKm": "{{count}} km overdue",
  "badgeOverdue": "Overdue reminders",
  "badgeDueSoon": "Reminders due soon"
}
```

`apps/web/src/i18n/locales/uk/reminders.json`:

```json
{
  "sectionTitle": "Нагадування",
  "add": "Додати нагадування",
  "empty": "Ще немає нагадувань. Додайте, щоб не пропустити наступне обслуговування.",
  "loadError": "Не вдалося завантажити нагадування.",
  "addTitle": "Додати нагадування",
  "editTitle": "Редагувати нагадування",
  "deleteTitle": "Видалити нагадування",
  "deleteConfirm": "Видалити це нагадування? Цю дію не можна скасувати.",
  "title": "Назва",
  "category": "Категорія",
  "notes": "Нотатки",
  "dueDate": "Дата виконання",
  "dueMileage": "Пробіг виконання (км)",
  "repeatMonths": "Повторювати кожні (місяців)",
  "repeatKm": "Повторювати кожні (км)",
  "repeats": "Повторюється",
  "done": "Виконано",
  "completeTitle": "Позначити виконаним",
  "completeDate": "Дата виконання",
  "completeMileage": "Пробіг на момент виконання",
  "complete": "Виконано",
  "completeFailed": "Не вдалося виконати. Спробуйте ще раз.",
  "save": "Зберегти",
  "saveChanges": "Зберегти зміни",
  "saveFailed": "Не вдалося зберегти. Спробуйте ще раз.",
  "errorRequired": "Це поле обовʼязкове",
  "errorNeedTarget": "Вкажіть дату або пробіг виконання",
  "errorRepeatNeedsDate": "Повторення за місяцями потребує дати виконання",
  "errorRepeatNeedsMileage": "Повторення за км потребує пробігу виконання",
  "errorFixFields": "Виправте позначені поля",
  "status_overdue": "Прострочено",
  "status_due_soon": "Незабаром",
  "dueToday": "сьогодні",
  "dueInDays_one": "через {{count}} день",
  "dueInDays_few": "через {{count}} дні",
  "dueInDays_many": "через {{count}} днів",
  "dueInDays_other": "через {{count}} дня",
  "overdueDays_one": "прострочено на {{count}} день",
  "overdueDays_few": "прострочено на {{count}} дні",
  "overdueDays_many": "прострочено на {{count}} днів",
  "overdueDays_other": "прострочено на {{count}} дня",
  "dueInKm": "через {{count}} км",
  "overdueKm": "прострочено на {{count}} км",
  "badgeOverdue": "Прострочені нагадування",
  "badgeDueSoon": "Нагадування незабаром"
}
```

- [ ] **Step 2: Register the namespace**

In `apps/web/src/i18n/index.ts`: add imports

```ts
import enReminders from './locales/en/reminders.json';
import ukReminders from './locales/uk/reminders.json';
```

add `'reminders'` to the `ns` array, and `reminders: enReminders` / `reminders: ukReminders` to the `en`/`uk` resource maps.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n
git commit -m "feat(web): reminders i18n namespace (en, uk)"
```

---

### Task 9: Web — ReminderFormDialog + CompleteReminderDialog + EventFormDialog prefill

**Files:**
- Create: `apps/web/src/components/ReminderFormDialog.tsx`
- Create: `apps/web/src/components/CompleteReminderDialog.tsx`
- Modify: `apps/web/src/components/EventFormDialog.tsx` (optional `initial` prop)

**Interfaces:**
- Consumes: Task 7 hooks; `NumberField`, `useBottomSheetDismiss`, `EVENT_CATEGORIES`.
- Produces:
  - `ReminderFormDialog({ open, onClose, carId, mode: 'create' | 'edit', reminder?: Reminder })`
  - `CompleteReminderDialog({ open, onClose, carId, reminder: Reminder, carMileage: number, onCompleted: (prefill: Partial<CreateEventInput>) => void })`
  - `EventFormDialog` gains `initial?: Partial<CreateEventInput>` (applied only in create mode).

- [ ] **Step 1: EventFormDialog prefill**

In `apps/web/src/components/EventFormDialog.tsx`:

```ts
export function EventFormDialog({
  open, onClose, carId, mode, event, initial,
}: { open: boolean; onClose: () => void; carId: string; mode: 'create' | 'edit'; event?: Event; initial?: Partial<CreateEventInput> }) {
```

and in the reset effect:

```ts
  useEffect(() => {
    if (!open) return;
    reset(mode === 'edit' && event ? toForm(event) : { ...EMPTY, ...initial });
  }, [open, mode, event, initial, reset]);
```

- [ ] **Step 2: ReminderFormDialog**

`apps/web/src/components/ReminderFormDialog.tsx` (same structure as `EventFormDialog`: RHF + zodResolver, localized schema, bottom-sheet dismiss):

```tsx
import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EVENT_CATEGORIES, type CreateReminderInput, type Reminder } from '@carlog/contracts';
import { useCreateReminder, useUpdateReminder } from '../queries';
import { NumberField } from './ui/NumberField';
import { useBottomSheetDismiss } from './ui/useBottomSheetDismiss';

// Validates against the CreateReminderSchema rules but with localized messages
// (same pattern as EventFormDialog.buildFormSchema).
function buildFormSchema(t: TFunction) {
  return z.object({
    title: z.string().min(1, t('reminders:errorRequired')).max(120),
    category: z.enum(EVENT_CATEGORIES),
    notes: z.literal('').transform(() => undefined).or(z.string().max(500).optional()),
    dueDate: z.literal('').transform(() => undefined).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    dueMileage: z.number().int().min(0).optional(),
    repeatMonths: z.number().int().min(1).max(120).optional(),
    repeatKm: z.number().int().min(100).optional(),
  }).superRefine((r, ctx) => {
    if (r.dueDate === undefined && r.dueMileage === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('reminders:errorNeedTarget'), path: ['dueDate'] });
    }
    if (r.repeatMonths !== undefined && r.dueDate === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('reminders:errorRepeatNeedsDate'), path: ['repeatMonths'] });
    }
    if (r.repeatKm !== undefined && r.dueMileage === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('reminders:errorRepeatNeedsMileage'), path: ['repeatKm'] });
    }
  });
}

const EMPTY: CreateReminderInput = { title: '', category: 'other' };

const toForm = (r: Reminder): CreateReminderInput => ({
  title: r.title, category: r.category, notes: r.notes,
  dueDate: r.dueDate, dueMileage: r.dueMileage, repeatMonths: r.repeatMonths, repeatKm: r.repeatKm,
});

export function ReminderFormDialog({
  open, onClose, carId, mode, reminder,
}: { open: boolean; onClose: () => void; carId: string; mode: 'create' | 'edit'; reminder?: Reminder }) {
  const { t } = useTranslation(['reminders', 'event', 'common']);
  const create = useCreateReminder(carId);
  const update = useUpdateReminder(carId);
  const isPending = create.isPending || update.isPending;

  const formSchema = useMemo(() => buildFormSchema(t), [t]);
  const { control, handleSubmit, reset, formState: { errors, isSubmitted } } = useForm<CreateReminderInput>({
    resolver: zodResolver(formSchema), defaultValues: EMPTY,
  });
  const sheet = useBottomSheetDismiss(onClose);

  useEffect(() => {
    if (!open) return;
    reset(mode === 'edit' && reminder ? toForm(reminder) : EMPTY);
  }, [open, mode, reminder, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (mode === 'edit' && reminder) await update.mutateAsync({ reminderId: reminder.id, input: data });
    else await create.mutateAsync(data);
    reset(EMPTY); onClose();
  });

  const isError = create.isError || update.isError;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" {...sheet}>
      <form onSubmit={onSubmit}>
        <DialogTitle>{mode === 'edit' ? t('reminders:editTitle') : t('reminders:addTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {isError ? <Alert severity="error">{t('reminders:saveFailed')}</Alert> : null}
            {isSubmitted && Object.keys(errors).length > 0 ? (
              <Alert severity="warning">{t('reminders:errorFixFields')}</Alert>
            ) : null}
            <Controller name="title" control={control} render={({ field }) => (
              <TextField {...field} label={t('reminders:title')} fullWidth
                error={Boolean(errors.title)} helperText={errors.title?.message} />
            )} />
            <Controller name="category" control={control} render={({ field }) => (
              <TextField {...field} select label={t('reminders:category')} fullWidth>
                {EVENT_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>{t(`event:category_${c}`)}</MenuItem>
                ))}
              </TextField>
            )} />
            <Stack direction="row" spacing={2}>
              <Controller name="dueDate" control={control} render={({ field }) => (
                <TextField {...field} value={field.value ?? ''} type="date" label={t('reminders:dueDate')} fullWidth
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.dueDate)} helperText={errors.dueDate?.message} />
              )} />
              <Controller name="repeatMonths" control={control} render={({ field }) => (
                <NumberField value={field.value} onChange={field.onChange} min={1}
                  label={t('reminders:repeatMonths')} fullWidth
                  error={Boolean(errors.repeatMonths)} helperText={errors.repeatMonths?.message} />
              )} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <Controller name="dueMileage" control={control} render={({ field }) => (
                <NumberField value={field.value} onChange={field.onChange}
                  label={t('reminders:dueMileage')} fullWidth
                  error={Boolean(errors.dueMileage)} helperText={errors.dueMileage?.message} />
              )} />
              <Controller name="repeatKm" control={control} render={({ field }) => (
                <NumberField value={field.value} onChange={field.onChange} min={100}
                  label={t('reminders:repeatKm')} fullWidth
                  error={Boolean(errors.repeatKm)} helperText={errors.repeatKm?.message} />
              )} />
            </Stack>
            <Controller name="notes" control={control} render={({ field }) => (
              <TextField {...field} value={field.value ?? ''} label={t('reminders:notes')} fullWidth multiline minRows={2} />
            )} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? t('reminders:saveChanges') : t('reminders:save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
```

Note: `repeatMonths` min is 1 — pass `min={1}` so `NumberField` doesn't let 0 through; same for `repeatKm` `min={100}`.

- [ ] **Step 3: CompleteReminderDialog**

`apps/web/src/components/CompleteReminderDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { CreateEventInput, Reminder } from '@carlog/contracts';
import { useCompleteReminder } from '../queries';
import { NumberField } from './ui/NumberField';
import { useBottomSheetDismiss } from './ui/useBottomSheetDismiss';
import { todayISO } from '../lib/reminder-view';

// Completing reschedules (or removes) the reminder server-side, then offers to log
// the work as a service event: onCompleted receives an EventFormDialog prefill.
// Skipping the event afterwards does NOT undo the completion (per spec).
export function CompleteReminderDialog({
  open, onClose, carId, reminder, carMileage, onCompleted,
}: {
  open: boolean; onClose: () => void; carId: string; reminder: Reminder;
  carMileage: number; onCompleted: (prefill: Partial<CreateEventInput>) => void;
}) {
  const { t } = useTranslation(['reminders', 'common']);
  const complete = useCompleteReminder(carId);
  const [date, setDate] = useState(todayISO());
  const [mileage, setMileage] = useState<number | undefined>(carMileage);
  const sheet = useBottomSheetDismiss(complete.isPending ? undefined : onClose);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setMileage(carMileage);
    complete.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when (re)opened
  }, [open, carMileage]);

  const onConfirm = async () => {
    const input = { date, mileage: mileage ?? 0 };
    await complete.mutateAsync({ reminderId: reminder.id, input });
    onClose();
    onCompleted({ title: reminder.title, category: reminder.category, date: input.date, mileage: input.mileage });
  };

  return (
    <Dialog open={open} onClose={complete.isPending ? undefined : onClose} fullWidth maxWidth="xs" {...sheet}>
      <DialogTitle>{t('reminders:completeTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {complete.isError ? <Alert severity="error">{t('reminders:completeFailed')}</Alert> : null}
          <TextField type="date" label={t('reminders:completeDate')} value={date}
            onChange={(e) => setDate(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
          <NumberField value={mileage} onChange={setMileage} label={t('reminders:completeMileage')} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={complete.isPending}>{t('common:cancel')}</Button>
        <Button onClick={() => void onConfirm()} variant="contained" disabled={complete.isPending || !date}>
          {t('reminders:complete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web test`
Expected: clean (components have no unit tests; their logic lives in Task 7's tested lib).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ReminderFormDialog.tsx apps/web/src/components/CompleteReminderDialog.tsx apps/web/src/components/EventFormDialog.tsx
git commit -m "feat(web): reminder form + complete dialogs; EventFormDialog create prefill"
```

---

### Task 10: Web — ReminderCard + RemindersSection

**Files:**
- Create: `apps/web/src/components/ReminderCard.tsx`
- Create: `apps/web/src/components/RemindersSection.tsx`

**Interfaces:**
- Consumes: Tasks 7–9. `Car` from contracts (section takes the whole car — it needs `car.mileage` for status and `car.id` for queries).
- Produces: `RemindersSection({ car: Car })`, `ReminderCard({ reminder, car, onEdit, onDelete, onDone })`.

- [ ] **Step 1: ReminderCard**

`apps/web/src/components/ReminderCard.tsx`:

```tsx
import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useTranslation } from 'react-i18next';
import type { Car, Reminder } from '@carlog/contracts';
import { formatDate, formatNumber } from '../i18n/format';
import { daysUntil, reminderStatus, todayISO } from '../lib/reminder-view';

export function ReminderCard({
  reminder, car, onEdit, onDelete, onDone,
}: { reminder: Reminder; car: Car; onEdit: () => void; onDelete: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation(['reminders', 'event', 'common']);
  const today = todayISO();
  const status = reminderStatus(reminder, car.mileage, today);
  const chipColor = status === 'overdue' ? 'error' as const : status === 'due_soon' ? 'warning' as const : 'default' as const;

  const dateLabel = reminder.dueDate !== undefined ? (() => {
    const d = daysUntil(today, reminder.dueDate);
    const rel = d > 0 ? t('reminders:dueInDays', { count: d })
      : d === 0 ? t('reminders:dueToday')
      : t('reminders:overdueDays', { count: -d });
    return `${formatDate(`${reminder.dueDate}T00:00:00.000Z`, i18n.language)} · ${rel}`;
  })() : null;

  const kmLabel = reminder.dueMileage !== undefined ? (() => {
    const left = reminder.dueMileage - car.mileage;
    return left > 0
      ? `${formatNumber(reminder.dueMileage, i18n.language)} · ${t('reminders:dueInKm', { count: left })}`
      : `${formatNumber(reminder.dueMileage, i18n.language)} · ${t('reminders:overdueKm', { count: -left })}`;
  })() : null;

  return (
    <Card variant="outlined" sx={{ mb: 1, borderRadius: 2 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Chip label={t(`event:category_${reminder.category}`)} size="small" color="primary" variant="outlined" sx={{ minWidth: 96 }} />
          <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{reminder.title}</Typography>
          {reminder.repeatMonths !== undefined || reminder.repeatKm !== undefined ? (
            <Chip icon={<RepeatIcon />} label={t('reminders:repeats')} size="small" variant="outlined" />
          ) : null}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {dateLabel ? <Chip label={dateLabel} size="small" color={chipColor} /> : null}
          {kmLabel ? <Chip label={kmLabel} size="small" color={chipColor} /> : null}
        </Stack>
        {reminder.notes ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{reminder.notes}</Typography>
        ) : null}
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button size="small" startIcon={<CheckCircleOutlineIcon />} onClick={onDone}>{t('reminders:done')}</Button>
          <Button size="small" startIcon={<EditIcon />} onClick={onEdit}>{t('common:edit')}</Button>
          <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={onDelete}>{t('common:delete')}</Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
```

(If `common:edit` / `common:delete` don't exist in `common.json`, add them: en `"edit": "Edit", "delete": "Delete"`, uk `"edit": "Редагувати", "delete": "Видалити"` — check first, EventCard likely already uses them.)

- [ ] **Step 2: RemindersSection**

`apps/web/src/components/RemindersSection.tsx`:

```tsx
import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import type { Car, CreateEventInput, Reminder } from '@carlog/contracts';
import { useDeleteReminder, useReminders } from '../queries';
import { sortReminders, todayISO } from '../lib/reminder-view';
import { ReminderCard } from './ReminderCard';
import { ReminderFormDialog } from './ReminderFormDialog';
import { CompleteReminderDialog } from './CompleteReminderDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { EventFormDialog } from './EventFormDialog';
import { StatusView } from './ui/StatusView';

export function RemindersSection({ car }: { car: Car }) {
  const { t } = useTranslation(['reminders', 'common']);
  const { data: reminders, isLoading, isError } = useReminders(car.id);
  const del = useDeleteReminder(car.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | undefined>();
  const [deleting, setDeleting] = useState<Reminder | undefined>();
  const [completing, setCompleting] = useState<Reminder | undefined>();
  // After a completion, offer to log the done work as a service event (skippable).
  const [eventPrefill, setEventPrefill] = useState<Partial<CreateEventInput> | undefined>();

  const sorted = sortReminders(reminders ?? [], car.mileage, todayISO());

  return (
    <Box sx={{ mt: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('reminders:sectionTitle')}</Typography>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => { setEditing(undefined); setFormOpen(true); }}>
          {t('reminders:add')}
        </Button>
      </Stack>
      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('reminders:loadError')} />
      ) : !sorted.length ? (
        <Typography color="text.secondary">{t('reminders:empty')}</Typography>
      ) : (
        <Box>
          {sorted.map((r) => (
            <ReminderCard key={r.id} reminder={r} car={car}
              onEdit={() => { setEditing(r); setFormOpen(true); }}
              onDelete={() => setDeleting(r)}
              onDone={() => setCompleting(r)} />
          ))}
        </Box>
      )}

      <ReminderFormDialog open={formOpen} onClose={() => setFormOpen(false)} carId={car.id}
        mode={editing ? 'edit' : 'create'} reminder={editing} />

      {deleting ? (
        <ConfirmDialog open title={t('reminders:deleteTitle')} message={t('reminders:deleteConfirm')}
          confirmLabel={t('common:delete')} loading={del.isPending}
          onConfirm={() => { del.mutate(deleting.id, { onSettled: () => setDeleting(undefined) }); }}
          onClose={() => setDeleting(undefined)} />
      ) : null}

      {completing ? (
        <CompleteReminderDialog open carId={car.id} reminder={completing} carMileage={car.mileage}
          onClose={() => setCompleting(undefined)}
          onCompleted={(prefill) => { setCompleting(undefined); setEventPrefill(prefill); }} />
      ) : null}

      <EventFormDialog open={Boolean(eventPrefill)} onClose={() => setEventPrefill(undefined)}
        carId={car.id} mode="create" initial={eventPrefill} />
    </Box>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: clean. Fix any missing `common` keys found in Step 1's check.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ReminderCard.tsx apps/web/src/components/RemindersSection.tsx apps/web/src/i18n
git commit -m "feat(web): reminders section with urgency-sorted cards and done→log-event flow"
```

---

### Task 11: Web — Vehicle page integration + garage badge

**Files:**
- Modify: `apps/web/src/routes/Vehicle.tsx`
- Modify: `apps/web/src/components/ui/VehicleCard.tsx`

- [ ] **Step 1: Vehicle page section**

In `apps/web/src/routes/Vehicle.tsx`, import `RemindersSection` and render it inside `VehicleDetail`'s outer `Stack`, between the Photos box and the Service history box (service history stays last — it's the primary content per project docs):

```tsx
          {/* Reminders — due/overdue maintenance surfaces above the history so
              action items are visible before the archive. */}
          <Box sx={{ '& > *': { mt: 0 } }}>
            <RemindersSection car={car} />
          </Box>
```

- [ ] **Step 2: Garage card badge**

In `apps/web/src/components/ui/VehicleCard.tsx` — add a due badge chip. Per spec this fires one reminders query per visible car (fine at garage scale):

```tsx
import { Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { useTranslation } from 'react-i18next';
import type { Car } from '@carlog/contracts';
import { formatNumber } from '../../i18n/format';
import { useReminders } from '../../queries';
import { reminderStatus, todayISO } from '../../lib/reminder-view';

function DueBadge({ car }: { car: Car }) {
  const { data: reminders } = useReminders(car.id);
  const { t } = useTranslation(['reminders']);
  if (!reminders?.length) return null;
  const today = todayISO();
  const statuses = reminders.map((r) => reminderStatus(r, car.mileage, today));
  const overdue = statuses.filter((s) => s === 'overdue').length;
  const dueSoon = statuses.filter((s) => s === 'due_soon').length;
  if (!overdue && !dueSoon) return null;
  return (
    <Chip size="small" color={overdue ? 'error' : 'warning'} icon={<NotificationsActiveIcon />}
      label={overdue + dueSoon}
      aria-label={t(overdue ? 'reminders:badgeOverdue' : 'reminders:badgeDueSoon')} />
  );
}

export function VehicleCard({ car, onClick }: { car: Car; onClick: () => void }) {
  const { t, i18n } = useTranslation(['vehicle', 'car']);
  const title = car.nickname || `${car.make} ${car.model}`;
  return (
    <Card sx={{ transition: 'box-shadow .15s, transform .15s', '&:hover': { transform: 'translateY(-2px)' } }}>
      <CardActionArea onClick={onClick} sx={{ p: 0.5 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="h6" noWrap>{title}</Typography>
            <Stack direction="row" spacing={0.5}>
              <DueBadge car={car} />
              <Chip label={t(`car:fuelType_${car.fuelType}`)} size="small" color="primary" variant="outlined" />
            </Stack>
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {car.year} · {formatNumber(car.mileage, i18n.language)} {t('vehicle:mileageUnit')}
          </Typography>
          {car.nickname ? (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5 }}>
              {car.make} {car.model}
            </Typography>
          ) : null}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/Vehicle.tsx apps/web/src/components/ui/VehicleCard.tsx
git commit -m "feat(web): reminders section on vehicle page; due badge on garage cards"
```

---

### Task 12: Full gates + docs sync

**Files:**
- Modify: `carlog-docs/API.md` (add reminder routes to the REST surface)
- Modify: `carlog-docs/ROADMAP.md` only if it tracks completion state (read first; if it's a bare phase list, leave it).

- [ ] **Step 1: Run all gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Update API.md**

Append to the route table in `carlog-docs/API.md` (match its existing format):

```
GET/POST         /cars/{id}/reminders
PUT/DELETE       /cars/{id}/reminders/{reminderId}
POST             /cars/{id}/reminders/{reminderId}/complete
```

- [ ] **Step 3: Commit**

```bash
git add carlog-docs/API.md
git commit -m "docs: reminder routes in API surface"
```

- [ ] **Step 4: Verification before completion**

Use the superpowers:verification-before-completion skill. Deployment (`cdk deploy` + `./scripts/deploy-web.sh`) is a separate user decision — do NOT deploy as part of this plan.