# Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only User Management feature — Cognito `admin` group as the role, an admin-gated backend API over Cognito user administration, and a mobile-first frontend page (in every header's UserMenu) that lists and fully manages users.

**Architecture:** The role is a Cognito user-pool group surfaced as the `cognito:groups` token claim. The existing single Lambda router gains `/admin/*` routes protected by a pure server-side admin guard (the real security boundary — the JWT authorizer only validates the token). Cognito Admin* calls live behind a port/adapter so `packages/domain` stays SDK-free. The frontend reads `isAdmin` from the token, gates the link/route, and drives the API via typed hooks.

**Tech Stack:** AWS Lambda (TypeScript), API Gateway HTTP API + Cognito JWT authorizer, `@aws-sdk/client-cognito-identity-provider`, AWS CDK; React + MUI + TanStack Query + Zod; i18n (en/uk).

## Global Constraints

- Strict TypeScript, **never `any`**; prefer `type` aliases; `interface` only for service/port abstractions.
- `packages/domain` must **not** import the AWS SDK or infra. Lambda handlers/adapters are thin.
- Zod schemas in `packages/contracts` are the source of truth; derive types with `z.infer`.
- Relative TS imports are **extensionless** (bundler/`.js`-free in this repo) — match neighbours.
- No TODO/stub code — production-ready.
- Never add co-authorship / "Generated with" trailers to commits.
- AWS profile `yevhenii`, region `us-east-1` for all AWS ops.
- Commit after each task. Push directly to `main` (no feature branch — project decision).

---

## File structure

**Backend**
- `packages/contracts/src/admin.ts` (create) — Zod schemas + inferred types.
- `packages/contracts/src/index.ts` (modify) — export admin schemas.
- `apps/api/src/admin-guard.ts` (create) — pure `parseGroups` / `isAdmin`.
- `apps/api/src/cognito-user-admin.ts` (create) — `CognitoUserAdminPort` interface + `AwsCognitoUserAdmin` adapter.
- `apps/api/src/admin-service.ts` (create) — application service (guard + self-lockout + port).
- `apps/api/src/admin-routes.ts` (create) — `handleAdminRoute` route module.
- `apps/api/src/router.ts` (modify) — add `groups` to `ApiEvent`, wire `/admin` routes.
- `apps/api/src/handler.ts` (modify) — extract `groups` from claims; construct the port; pass into deps.
- `infrastructure/cdk/lib/carlog-stack.ts` (modify) — `admin` group, `USER_POOL_ID` env, Cognito IAM.

**Frontend**
- `apps/web/src/auth/index.tsx` (modify) — `isAdmin` + `groups` on the context.
- `apps/web/src/api-client.ts` (modify) — admin API functions.
- `apps/web/src/queries.ts` (modify) — admin query/mutation hooks.
- `apps/web/src/components/ui/PageHeader.tsx` (modify) — always render `UserMenu`.
- `apps/web/src/components/ui/UserMenu.tsx` (modify) — admin "User management" item.
- `apps/web/src/routes/Garage.tsx`, `Vehicle.tsx`, `Profile.tsx` (modify) — drop explicit `UserMenu` in `actions` (now in PageHeader); ensure each uses PageHeader.
- `apps/web/src/auth/RequireAdmin.tsx` (create) — admin route guard.
- `apps/web/src/routes/admin/UserManagement.tsx` (create) — the page.
- `apps/web/src/main.tsx` (modify) — `/admin/users` route.
- `apps/web/src/i18n/locales/{en,uk}/admin.json` (create) + `i18n/index.ts` (modify) — new namespace.
- `apps/web/src/i18n/locales/{en,uk}/common.json` (modify) — "User management" label.

---

## Task 1: Admin contracts

**Files:**
- Create: `packages/contracts/src/admin.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/admin.test.ts`

**Interfaces:**
- Produces: `AdminUserSchema`, `ListUsersResponseSchema`, `SetEnabledSchema`; types `AdminUser`, `ListUsersResponse`, `SetEnabledInput`.

- [ ] **Step 1: Write the failing test** — `packages/contracts/src/admin.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { AdminUserSchema, ListUsersResponseSchema, SetEnabledSchema } from './admin';

describe('admin contracts', () => {
  const user = {
    username: 'u-1', sub: '11111111-1111-1111-1111-111111111111', email: 'a@b.com',
    status: 'CONFIRMED', enabled: true, createdAt: '2026-01-01T00:00:00.000Z', isAdmin: false,
  };
  it('accepts a valid admin user', () => {
    expect(AdminUserSchema.parse(user)).toMatchObject({ email: 'a@b.com', isAdmin: false });
  });
  it('rejects a user missing sub', () => {
    const { sub, ...rest } = user;
    expect(() => AdminUserSchema.parse(rest)).toThrow();
  });
  it('parses a list response with optional nextToken', () => {
    expect(ListUsersResponseSchema.parse({ users: [user] })).toMatchObject({ users: [{ email: 'a@b.com' }] });
    expect(ListUsersResponseSchema.parse({ users: [], nextToken: 'x' }).nextToken).toBe('x');
  });
  it('validates SetEnabled body', () => {
    expect(SetEnabledSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(() => SetEnabledSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

Run: `pnpm --filter @carlog/contracts test src/admin.test.ts`
Expected: FAIL (cannot find `./admin`).

- [ ] **Step 3: Implement** — `packages/contracts/src/admin.ts`

```ts
import { z } from 'zod';

export const AdminUserSchema = z.object({
  username: z.string().min(1),
  sub: z.string().min(1),
  email: z.string().email().or(z.literal('')),
  status: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  isAdmin: z.boolean(),
});

export const ListUsersResponseSchema = z.object({
  users: z.array(AdminUserSchema),
  nextToken: z.string().optional(),
});

export const SetEnabledSchema = z.object({ enabled: z.boolean() });

export type AdminUser = z.infer<typeof AdminUserSchema>;
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;
export type SetEnabledInput = z.infer<typeof SetEnabledSchema>;
```

- [ ] **Step 4: Export from index** — add to `packages/contracts/src/index.ts` (match existing `export * from './x'` style):

```ts
export * from './admin';
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @carlog/contracts test src/admin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/admin.ts packages/contracts/src/index.ts packages/contracts/src/admin.test.ts
git commit -m "feat(contracts): admin user schemas"
```

---

## Task 2: Admin guard (pure)

**Files:**
- Create: `apps/api/src/admin-guard.ts`
- Test: `apps/api/src/admin-guard.test.ts`

**Interfaces:**
- Produces: `parseGroups(claim: unknown): string[]`, `isAdmin(groups: string[]): boolean`, `ADMIN_GROUP = 'admin'`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/admin-guard.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseGroups, isAdmin, ADMIN_GROUP } from './admin-guard';

describe('parseGroups', () => {
  it('handles a real array claim', () => {
    expect(parseGroups(['admin', 'staff'])).toEqual(['admin', 'staff']);
  });
  it('handles a JSON-array string claim', () => {
    expect(parseGroups('["admin","staff"]')).toEqual(['admin', 'staff']);
  });
  it('handles a bracketed non-JSON string claim (API Gateway form)', () => {
    expect(parseGroups('[admin staff]')).toEqual(['admin', 'staff']);
  });
  it('handles a single string claim', () => {
    expect(parseGroups('admin')).toEqual(['admin']);
  });
  it('returns [] for missing/empty', () => {
    expect(parseGroups(undefined)).toEqual([]);
    expect(parseGroups('')).toEqual([]);
    expect(parseGroups(null)).toEqual([]);
  });
});

describe('isAdmin', () => {
  it('is true when the admin group is present', () => {
    expect(isAdmin(['staff', ADMIN_GROUP])).toBe(true);
  });
  it('is false otherwise', () => {
    expect(isAdmin(['staff'])).toBe(false);
    expect(isAdmin([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @carlog/api test src/admin-guard.test.ts`
Expected: FAIL (cannot find `./admin-guard`).

- [ ] **Step 3: Implement** — `apps/api/src/admin-guard.ts`

```ts
export const ADMIN_GROUP = 'admin';

// The `cognito:groups` claim reaches us in several shapes depending on token
// source and API Gateway serialization: a real array, a JSON array string, a
// space-separated bracketed string (`"[admin staff]"`), or a bare string.
export function parseGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map(String).filter(Boolean);
  if (typeof claim !== 'string' || claim.trim() === '') return [];
  const trimmed = claim.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // Not JSON — the API Gateway "[a b c]" form. Strip brackets, split on comma/space.
    }
    return trimmed.slice(1, -1).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [trimmed];
}

export function isAdmin(groups: string[]): boolean {
  return groups.includes(ADMIN_GROUP);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @carlog/api test src/admin-guard.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin-guard.ts apps/api/src/admin-guard.test.ts
git commit -m "feat(api): pure admin group guard"
```

---

## Task 3: Carry groups through ApiEvent

**Files:**
- Modify: `apps/api/src/router.ts` (the `ApiEvent` type, ~line 13)
- Modify: `apps/api/src/handler.ts` (the `apiEvent` construction, ~line 94)

**Interfaces:**
- Produces: `ApiEvent.groups: string[]` populated from the `cognito:groups` claim.
- Consumes: `parseGroups` (Task 2).

- [ ] **Step 1: Add `groups` to `ApiEvent`** in `apps/api/src/router.ts`:

```ts
export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  groups: string[];
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  body: unknown;
};
```

- [ ] **Step 2: Populate it in `handler.ts`** — add the import and set the field:

```ts
import { parseGroups } from './admin-guard';
// ...inside the apiEvent object literal, after ownerId:
    groups: parseGroups(event.requestContext.authorizer?.jwt?.claims?.['cognito:groups']),
```

- [ ] **Step 3: Compile check**

Run: `pnpm --filter @carlog/api typecheck`
Expected: PASS (existing `ApiEvent` construction sites — tests — may need `groups: []`; fix any that fail by adding `groups: []`).

- [ ] **Step 4: Fix test fixtures** — if any existing `apps/api` test builds an `ApiEvent` literal, add `groups: []`. Re-run:

Run: `pnpm --filter @carlog/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/router.ts apps/api/src/handler.ts apps/api/src
git commit -m "feat(api): expose token groups on ApiEvent"
```

---

## Task 4: Cognito user-admin port + adapter

**Files:**
- Create: `apps/api/src/cognito-user-admin.ts`

**Interfaces:**
- Produces:
  - `type CognitoUser = { username: string; sub: string; email: string; status: string; enabled: boolean; createdAt: string }`
  - `interface CognitoUserAdmin { listUsers(nextToken?: string): Promise<{ users: CognitoUser[]; nextToken?: string }>; listGroupUsernames(group: string): Promise<Set<string>>; addToGroup(username: string, group: string): Promise<void>; removeFromGroup(username: string, group: string): Promise<void>; setEnabled(username: string, enabled: boolean): Promise<void>; deleteUser(username: string): Promise<void>; }`
  - `class AwsCognitoUserAdmin implements CognitoUserAdmin` (ctor: `(client: CognitoIdentityProviderClient, userPoolId: string)`).

- [ ] **Step 1: Add dependency** — in `apps/api/package.json` dependencies add `"@aws-sdk/client-cognito-identity-provider": "^3.716.0"` (match the version range of other `@aws-sdk/*` deps already present), then:

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Implement** — `apps/api/src/cognito-user-admin.ts`

```ts
import {
  CognitoIdentityProviderClient, ListUsersCommand, ListUsersInGroupCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand,
  AdminEnableUserCommand, AdminDisableUserCommand, AdminDeleteUserCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';

export type CognitoUser = {
  username: string;
  sub: string;
  email: string;
  status: string;
  enabled: boolean;
  createdAt: string;
};

export interface CognitoUserAdmin {
  listUsers(nextToken?: string): Promise<{ users: CognitoUser[]; nextToken?: string }>;
  listGroupUsernames(group: string): Promise<Set<string>>;
  addToGroup(username: string, group: string): Promise<void>;
  removeFromGroup(username: string, group: string): Promise<void>;
  setEnabled(username: string, enabled: boolean): Promise<void>;
  deleteUser(username: string): Promise<void>;
}

const attr = (u: UserType, name: string): string =>
  u.Attributes?.find((a) => a.Name === name)?.Value ?? '';

function toUser(u: UserType): CognitoUser {
  return {
    username: u.Username ?? '',
    sub: attr(u, 'sub'),
    email: attr(u, 'email'),
    status: u.UserStatus ?? 'UNKNOWN',
    enabled: u.Enabled ?? true,
    createdAt: u.UserCreateDate?.toISOString() ?? '',
  };
}

export class AwsCognitoUserAdmin implements CognitoUserAdmin {
  constructor(private readonly client: CognitoIdentityProviderClient, private readonly userPoolId: string) {}

  async listUsers(nextToken?: string): Promise<{ users: CognitoUser[]; nextToken?: string }> {
    const res = await this.client.send(new ListUsersCommand({
      UserPoolId: this.userPoolId, Limit: 60, PaginationToken: nextToken,
    }));
    return { users: (res.Users ?? []).map(toUser), nextToken: res.PaginationToken };
  }

  async listGroupUsernames(group: string): Promise<Set<string>> {
    const names = new Set<string>();
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListUsersInGroupCommand({
        UserPoolId: this.userPoolId, GroupName: group, NextToken: token,
      }));
      for (const u of res.Users ?? []) if (u.Username) names.add(u.Username);
      token = res.NextToken;
    } while (token);
    return names;
  }

  async addToGroup(username: string, group: string): Promise<void> {
    await this.client.send(new AdminAddUserToGroupCommand({ UserPoolId: this.userPoolId, Username: username, GroupName: group }));
  }
  async removeFromGroup(username: string, group: string): Promise<void> {
    await this.client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: this.userPoolId, Username: username, GroupName: group }));
  }
  async setEnabled(username: string, enabled: boolean): Promise<void> {
    await this.client.send(enabled
      ? new AdminEnableUserCommand({ UserPoolId: this.userPoolId, Username: username })
      : new AdminDisableUserCommand({ UserPoolId: this.userPoolId, Username: username }));
  }
  async deleteUser(username: string): Promise<void> {
    await this.client.send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username }));
  }
}
```

- [ ] **Step 3: Compile check**

Run: `pnpm --filter @carlog/api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/src/cognito-user-admin.ts pnpm-lock.yaml
git commit -m "feat(api): Cognito user-admin port and AWS adapter"
```

---

## Task 5: Admin application service (guard + self-lockout)

**Files:**
- Create: `apps/api/src/admin-service.ts`
- Test: `apps/api/src/admin-service.test.ts`

**Interfaces:**
- Consumes: `CognitoUserAdmin`, `CognitoUser` (Task 4); `ADMIN_GROUP` (Task 2); `AdminUser` (Task 1).
- Produces:
  - `class ForbiddenError extends Error` / `class SelfLockoutError extends Error`.
  - `type AdminActor = { sub: string; isAdmin: boolean }`
  - `listUsers(port, actor, nextToken?): Promise<ListUsersResponse>`
  - `setAdmin(port, actor, username, targetSub, makeAdmin): Promise<void>`
  - `setEnabled(port, actor, username, enabled): Promise<void>`
  - `deleteUser(port, actor, username, targetSub): Promise<void>`

- [ ] **Step 1: Write the failing test** — `apps/api/src/admin-service.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import type { CognitoUserAdmin, CognitoUser } from './cognito-user-admin';
import { listUsers, setAdmin, deleteUser, ForbiddenError, SelfLockoutError } from './admin-service';

const CALLER = { sub: 'caller-sub', isAdmin: true };
const other: CognitoUser = { username: 'other', sub: 'other-sub', email: 'o@x.com', status: 'CONFIRMED', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' };

function fakePort(overrides: Partial<CognitoUserAdmin> = {}): CognitoUserAdmin {
  return {
    listUsers: vi.fn(async () => ({ users: [other], nextToken: undefined })),
    listGroupUsernames: vi.fn(async () => new Set<string>(['other'])),
    addToGroup: vi.fn(async () => {}),
    removeFromGroup: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    deleteUser: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('admin-service authorization', () => {
  it('rejects non-admin callers', async () => {
    await expect(listUsers(fakePort(), { sub: 'x', isAdmin: false })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('lists users with isAdmin derived from group membership', async () => {
    const res = await listUsers(fakePort(), CALLER);
    expect(res.users[0]).toMatchObject({ username: 'other', isAdmin: true });
  });
});

describe('self-lockout guards', () => {
  it('blocks revoking your own admin', async () => {
    await expect(setAdmin(fakePort(), CALLER, 'me', 'caller-sub', false)).rejects.toBeInstanceOf(SelfLockoutError);
  });
  it('blocks deleting yourself', async () => {
    await expect(deleteUser(fakePort(), CALLER, 'me', 'caller-sub')).rejects.toBeInstanceOf(SelfLockoutError);
  });
  it('allows revoking another admin', async () => {
    const port = fakePort();
    await setAdmin(port, CALLER, 'other', 'other-sub', false);
    expect(port.removeFromGroup).toHaveBeenCalledWith('other', 'admin');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @carlog/api test src/admin-service.test.ts`
Expected: FAIL (cannot find `./admin-service`).

- [ ] **Step 3: Implement** — `apps/api/src/admin-service.ts`

```ts
import type { ListUsersResponse, AdminUser } from '@carlog/contracts';
import { ADMIN_GROUP } from './admin-guard';
import type { CognitoUserAdmin } from './cognito-user-admin';

export class ForbiddenError extends Error {}
export class SelfLockoutError extends Error {}

export type AdminActor = { sub: string; isAdmin: boolean };

function requireAdmin(actor: AdminActor): void {
  if (!actor.isAdmin) throw new ForbiddenError('Admin role required');
}

export async function listUsers(port: CognitoUserAdmin, actor: AdminActor, nextToken?: string): Promise<ListUsersResponse> {
  requireAdmin(actor);
  const [{ users, nextToken: next }, adminUsernames] = await Promise.all([
    port.listUsers(nextToken),
    port.listGroupUsernames(ADMIN_GROUP),
  ]);
  const mapped: AdminUser[] = users.map((u) => ({
    username: u.username, sub: u.sub, email: u.email, status: u.status,
    enabled: u.enabled, createdAt: u.createdAt, isAdmin: adminUsernames.has(u.username),
  }));
  return { users: mapped, nextToken: next };
}

export async function setAdmin(port: CognitoUserAdmin, actor: AdminActor, username: string, targetSub: string, makeAdmin: boolean): Promise<void> {
  requireAdmin(actor);
  if (!makeAdmin && targetSub === actor.sub) throw new SelfLockoutError('You cannot revoke your own admin role');
  if (makeAdmin) await port.addToGroup(username, ADMIN_GROUP);
  else await port.removeFromGroup(username, ADMIN_GROUP);
}

export async function setEnabled(port: CognitoUserAdmin, actor: AdminActor, username: string, enabled: boolean): Promise<void> {
  requireAdmin(actor);
  await port.setEnabled(username, enabled);
}

export async function deleteUser(port: CognitoUserAdmin, actor: AdminActor, username: string, targetSub: string): Promise<void> {
  requireAdmin(actor);
  if (targetSub === actor.sub) throw new SelfLockoutError('You cannot delete yourself');
  await port.deleteUser(username);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @carlog/api test src/admin-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin-service.ts apps/api/src/admin-service.test.ts
git commit -m "feat(api): admin service with authorization and self-lockout guards"
```

---

## Task 6: Admin route module + router wiring

**Files:**
- Create: `apps/api/src/admin-routes.ts`
- Modify: `apps/api/src/router.ts` (RouteDeps + dispatch), `apps/api/src/handler.ts` (construct port into deps)
- Test: `apps/api/src/admin-routes.test.ts`

**Interfaces:**
- Consumes: `ApiEvent` (with `groups`), `admin-service` fns, `isAdmin`/`parseGroups`, `errors.ok`.
- Produces: `handleAdminRoute(port: CognitoUserAdmin, event: ApiEvent): Promise<ApiResult | undefined>`.

**Note on error mapping:** map `ForbiddenError → 403`, `SelfLockoutError → 409`. Check `apps/api/src/errors.ts` for the existing `withErrorHandling` mapping and add these two error classes there if that's where domain errors are mapped; otherwise catch locally in `handleAdminRoute` and return `ok(403|409, { error })`. The steps below catch locally to stay self-contained.

- [ ] **Step 1: Write the failing test** — `apps/api/src/admin-routes.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import type { CognitoUserAdmin, CognitoUser } from './cognito-user-admin';
import { handleAdminRoute } from './admin-routes';
import type { ApiEvent } from './router';

const other: CognitoUser = { username: 'other', sub: 'other-sub', email: 'o@x.com', status: 'CONFIRMED', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
const port = (): CognitoUserAdmin => ({
  listUsers: vi.fn(async () => ({ users: [other] })),
  listGroupUsernames: vi.fn(async () => new Set<string>()),
  addToGroup: vi.fn(async () => {}), removeFromGroup: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => {}), deleteUser: vi.fn(async () => {}),
});
const base = (over: Partial<ApiEvent>): ApiEvent => ({
  method: 'GET', path: '/admin/users', ownerId: 'caller', groups: ['admin'],
  pathParams: {}, queryParams: {}, body: null, ...over,
});

describe('handleAdminRoute', () => {
  it('returns undefined for non-admin paths', async () => {
    expect(await handleAdminRoute(port(), base({ path: '/cars' }))).toBeUndefined();
  });
  it('403s a non-admin caller', async () => {
    const res = await handleAdminRoute(port(), base({ groups: [] }));
    expect(res?.statusCode).toBe(403);
  });
  it('lists users for an admin', async () => {
    const res = await handleAdminRoute(port(), base({}));
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res!.body as string).users).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @carlog/api test src/admin-routes.test.ts`
Expected: FAIL (cannot find `./admin-routes`).

- [ ] **Step 3: Implement** — `apps/api/src/admin-routes.ts`

```ts
import { SetEnabledSchema } from '@carlog/contracts';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';
import { isAdmin } from './admin-guard';
import type { CognitoUserAdmin } from './cognito-user-admin';
import {
  listUsers, setAdmin, setEnabled, deleteUser, ForbiddenError, SelfLockoutError, type AdminActor,
} from './admin-service';

// Returns undefined for non-/admin paths so the main router can continue.
export async function handleAdminRoute(port: CognitoUserAdmin, event: ApiEvent): Promise<ApiResult | undefined> {
  const { method, path, ownerId, groups, pathParams, queryParams, body } = event;
  if (!path.startsWith('/admin/')) return undefined;

  const actor: AdminActor = { sub: ownerId ?? '', isAdmin: isAdmin(groups) };
  const username = pathParams.username;
  // targetSub is required by self-lockout checks; the client sends it as a query param
  // on mutating actions (it already has it from the list).
  const targetSub = queryParams.sub ?? '';

  try {
    if (path === '/admin/users' && method === 'GET') {
      return ok(200, await listUsers(port, actor, queryParams.nextToken));
    }
    if (username && path === `/admin/users/${username}/admin` && method === 'PUT') {
      await setAdmin(port, actor, username, targetSub, true);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}/admin` && method === 'DELETE') {
      await setAdmin(port, actor, username, targetSub, false);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}/enabled` && method === 'PUT') {
      const { enabled } = SetEnabledSchema.parse(body);
      await setEnabled(port, actor, username, enabled);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}` && method === 'DELETE') {
      await deleteUser(port, actor, username, targetSub);
      return ok(204, null);
    }
    return ok(404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof ForbiddenError) return ok(403, { error: 'Forbidden' });
    if (e instanceof SelfLockoutError) return ok(409, { error: e.message });
    throw e;
  }
}
```

- [ ] **Step 4: Wire into `router.ts`** — add `adminUsers: CognitoUserAdmin` to `RouteDeps`, import the handler + type, and dispatch **before** the `/cars` handlers but note the admin guard runs inside. Because `route()` early-returns 401 when `!ownerId`, place the admin dispatch after that check:

```ts
// imports
import { handleAdminRoute } from './admin-routes';
import type { CognitoUserAdmin } from './cognito-user-admin';
// RouteDeps: add
  adminUsers: CognitoUserAdmin;
// inside route(), right after the `if (!ownerId) return ok(401, ...)` line:
    if (path.startsWith('/admin/')) {
      const result = await handleAdminRoute(deps.adminUsers, event);
      if (result) return result;
    }
```

- [ ] **Step 5: Construct the port in `handler.ts`** — near the other deps/singletons at module scope:

```ts
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { AwsCognitoUserAdmin } from './cognito-user-admin';
// module scope (with the other singletons):
const adminUsers = new AwsCognitoUserAdmin(
  new CognitoIdentityProviderClient({}),
  process.env.USER_POOL_ID ?? '',
);
// add `adminUsers` to the `deps` object passed to route()
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @carlog/api test src/admin-routes.test.ts && pnpm --filter @carlog/api typecheck`
Expected: PASS (3 tests) and clean typecheck. Fix any `deps` construction sites in existing tests by adding an `adminUsers` fake.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/admin-routes.ts apps/api/src/admin-routes.test.ts apps/api/src/router.ts apps/api/src/handler.ts
git commit -m "feat(api): /admin/users routes wired into the router"
```

---

## Task 7: CDK — admin group, env, IAM

**Files:**
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

- [ ] **Step 1: Create the admin group** — after the `UserPool` is created (~line 45–60), add:

```ts
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
// ...
new CfnUserPoolGroup(this, 'AdminGroup', {
  userPoolId: userPool.userPoolId,
  groupName: 'admin',
  description: 'CarLog administrators',
});
```

- [ ] **Step 2: Pass the pool id to the Lambda** — in the `NodejsFunction` `environment` block (~line 118), add:

```ts
        USER_POOL_ID: userPool.userPoolId,
```

- [ ] **Step 3: Grant Cognito admin permissions** — after `table.grantReadWriteData(fn)` (~line 143), add:

```ts
fn.addToRolePolicy(new PolicyStatement({
  actions: [
    'cognito-idp:ListUsers',
    'cognito-idp:ListUsersInGroup',
    'cognito-idp:AdminAddUserToGroup',
    'cognito-idp:AdminRemoveUserFromGroup',
    'cognito-idp:AdminEnableUser',
    'cognito-idp:AdminDisableUser',
    'cognito-idp:AdminDeleteUser',
  ],
  resources: [userPool.userPoolArn],
}));
```

- [ ] **Step 4: Add the API routes** — after the existing `httpApi.addRoutes(...)` block (~line 184):

```ts
httpApi.addRoutes({ path: '/admin/users', methods: [HttpMethod.GET], integration, authorizer });
httpApi.addRoutes({ path: '/admin/users/{username}', methods: [HttpMethod.DELETE], integration, authorizer });
httpApi.addRoutes({ path: '/admin/users/{username}/admin', methods: [HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
httpApi.addRoutes({ path: '/admin/users/{username}/enabled', methods: [HttpMethod.PUT], integration, authorizer });
```

- [ ] **Step 5: Synth check**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth`
Expected: synthesizes without error; the template shows the new group, env var, policy, and routes.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(cdk): admin Cognito group, user-pool env, IAM, and /admin routes"
```

---

## Task 8: Frontend — isAdmin in useAuth

**Files:**
- Modify: `apps/web/src/auth/index.tsx`

**Interfaces:**
- Produces: `AuthValue.isAdmin: boolean`, `AuthValue.groups: string[]`.

- [ ] **Step 1: Extend the type + state** — add to `AuthValue`:

```ts
  isAdmin: boolean;
  groups: string[];
```

Add state near `accessToken`:

```ts
  const [groups, setGroups] = useState<string[]>([]);
```

- [ ] **Step 2: Read groups in `refresh()`** — inside the `if (token) {` block, after `setAccessToken(token)`:

```ts
        const raw = session.tokens?.accessToken?.payload?.['cognito:groups'];
        setGroups(Array.isArray(raw) ? raw.map(String) : []);
```

And in the `else`/`catch` branches (unauthenticated), reset: `setGroups([]);`

- [ ] **Step 3: Expose on the context value** — in the `useMemo`, add `groups`, `isAdmin: groups.includes('admin')`, and add `groups` to the dependency array. In `signOut`, also `setGroups([])`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/auth/index.tsx
git commit -m "feat(web): expose isAdmin/groups from useAuth"
```

---

## Task 9: Frontend — admin api-client + query hooks

**Files:**
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`

**Interfaces (match existing api-client fn style — read a nearby fn like `listCars` first):**
- Produces (api-client): `listUsers(token, nextToken?)`, `setUserAdmin(token, username, sub, makeAdmin)`, `setUserEnabled(token, username, enabled)`, `deleteUser(token, username, sub)`.
- Produces (queries): `useAdminUsers()`, `useSetUserAdmin()`, `useSetUserEnabled()`, `useDeleteUser()`.

- [ ] **Step 1: api-client functions** — mirror the existing `request`/fetch helper used by `listCars` etc. Add:

```ts
import type { ListUsersResponse } from '@carlog/contracts';

export function listUsers(token: string, nextToken?: string): Promise<ListUsersResponse> {
  const qs = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : '';
  return apiGet(token, `/admin/users${qs}`); // use the same GET helper listCars uses
}
export function setUserAdmin(token: string, username: string, sub: string, makeAdmin: boolean): Promise<void> {
  const path = `/admin/users/${encodeURIComponent(username)}/admin?sub=${encodeURIComponent(sub)}`;
  return apiSend(token, makeAdmin ? 'PUT' : 'DELETE', path); // same helper the mutations use
}
export function setUserEnabled(token: string, username: string, enabled: boolean): Promise<void> {
  return apiSend(token, 'PUT', `/admin/users/${encodeURIComponent(username)}/enabled`, { enabled });
}
export function deleteUser(token: string, username: string, sub: string): Promise<void> {
  return apiSend(token, 'DELETE', `/admin/users/${encodeURIComponent(username)}?sub=${encodeURIComponent(sub)}`);
}
```

> Adapt `apiGet`/`apiSend` to the actual helper names/signatures in `api-client.ts` (read `listCars`/`createCar`/`deleteCar` to see the exact request helper — reuse it verbatim; do not hand-roll fetch).

- [ ] **Step 2: Query hooks** — in `queries.ts` (mirror `useCars`/`useDeleteCar`):

```ts
import { listUsers, setUserAdmin, setUserEnabled, deleteUser } from './api-client';

export function useAdminUsers() {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: ['admin', 'users'], queryFn: () => listUsers(token), enabled: Boolean(token) });
}
export function useSetUserAdmin() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, sub, makeAdmin }: { username: string; sub: string; makeAdmin: boolean }) =>
      setUserAdmin(token, username, sub, makeAdmin),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}
export function useSetUserEnabled() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, enabled }: { username: string; enabled: boolean }) => setUserEnabled(token, username, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}
export function useDeleteUser() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, sub }: { username: string; sub: string }) => deleteUser(token, username, sub),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api-client.ts apps/web/src/queries.ts
git commit -m "feat(web): admin api-client functions and query hooks"
```

---

## Task 10: Frontend — UserMenu everywhere + admin item

**Files:**
- Modify: `apps/web/src/components/ui/PageHeader.tsx`, `apps/web/src/components/ui/UserMenu.tsx`, `apps/web/src/routes/Garage.tsx`
- Verify: `apps/web/src/routes/Vehicle.tsx`, `apps/web/src/routes/Profile.tsx` use `PageHeader`.

- [ ] **Step 1: Read `PageHeader.tsx`** to see its current `actions` prop and layout. Then render `<UserMenu/>` on the right of every header, keeping `actions` for page-specific items placed left of it:

```tsx
import { UserMenu } from './UserMenu';
// in the header's right-side area:
  <Stack direction="row" alignItems="center" spacing={1}>
    {actions}
    <UserMenu />
  </Stack>
```

- [ ] **Step 2: Remove the now-duplicated menu on Garage** — in `Garage.tsx`, change `<PageHeader title=... actions={<UserMenu />} />` to `<PageHeader title=... />` and drop the `UserMenu` import.

- [ ] **Step 3: Admin item in `UserMenu.tsx`** — read `isAdmin` and insert an item **between** Profile and Sign out, admin-only:

```tsx
import GroupIcon from '@mui/icons-material/Group';
// const { email, signOut, isAdmin } = useAuth();
// between the Profile MenuItem and the Sign out MenuItem:
{isAdmin ? (
  <MenuItem onClick={() => { close(); navigate('/admin/users'); }}>
    <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
    <ListItemText>{t('common:userManagement')}</ListItemText>
  </MenuItem>
) : null}
```

- [ ] **Step 4: Verify Vehicle/Profile headers** — confirm both render `PageHeader` (Vehicle does: `<PageHeader title={title} onBack=.../>`; Profile — read it). If a page doesn't use PageHeader, wrap its header accordingly so the menu shows. Do not touch auth screens (`AuthLayout`).

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/PageHeader.tsx apps/web/src/components/ui/UserMenu.tsx apps/web/src/routes/Garage.tsx
git commit -m "feat(web): UserMenu in every header + admin User management entry"
```

---

## Task 11: Frontend — RequireAdmin guard + route

**Files:**
- Create: `apps/web/src/auth/RequireAdmin.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Implement the guard** — `apps/web/src/auth/RequireAdmin.tsx`

```tsx
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '.';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, isAdmin } = useAuth();
  if (status === 'loading') {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 2: Add the route** — in `main.tsx`, import `RequireAdmin` and `UserManagement`, then add inside `<Routes>`:

```tsx
<Route path="/admin/users" element={<RequireAdmin><UserManagement /></RequireAdmin>} />
```

- [ ] **Step 3: Typecheck** (UserManagement created next task — for now stub the import only if needed, or do Task 12 before wiring the route). To keep this task self-contained, add the route in Task 12 Step 5 instead and here only create+test the guard.

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/auth/RequireAdmin.tsx
git commit -m "feat(web): RequireAdmin route guard"
```

---

## Task 12: Frontend — User Management page

**Files:**
- Create: `apps/web/src/routes/admin/UserManagement.tsx`
- Modify: `apps/web/src/main.tsx` (add the route from Task 11 Step 2)

**Interfaces:**
- Consumes: `useAdminUsers`/`useSetUserAdmin`/`useSetUserEnabled`/`useDeleteUser` (Task 9); `useAuth` (for the caller's identity to disable self-actions); `AppShell`, `PageHeader`, `StatusView`, `EmptyState`, `ConfirmDialog`.

- [ ] **Step 1: Implement the page** — `apps/web/src/routes/admin/UserManagement.tsx`

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Card, CardContent, Chip, Container, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ShieldIcon from '@mui/icons-material/Shield';
import BlockIcon from '@mui/icons-material/Block';
import DeleteIcon from '@mui/icons-material/Delete';
import type { AdminUser } from '@carlog/contracts';
import { useAuth } from '../../auth';
import { useAdminUsers, useSetUserAdmin, useSetUserEnabled, useDeleteUser } from '../../queries';
import { AppShell } from '../../components/ui/AppShell';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusView } from '../../components/ui/StatusView';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatDate } from '../../i18n/format';

function UserCard({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setAdmin = useSetUserAdmin();
  const setEnabled = useSetUserEnabled();
  const del = useDeleteUser();
  const close = () => setAnchor(null);

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <div>
            <Typography sx={{ fontWeight: 700 }}>{user.email || user.username}</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {user.isAdmin ? <Chip size="small" color="primary" icon={<ShieldIcon />} label={t('admin:roleAdmin')} /> : null}
              {!user.enabled ? <Chip size="small" color="warning" label={t('admin:disabled')} /> : null}
              <Chip size="small" variant="outlined" label={user.status} />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {user.createdAt ? formatDate(user.createdAt, i18n.language) : ''}
            </Typography>
          </div>
          <IconButton size="small" aria-label={t('admin:userActions')} onClick={(e) => setAnchor(e.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
            <MenuItem onClick={() => { close(); setAdmin.mutate({ username: user.username, sub: user.sub, makeAdmin: !user.isAdmin }); }}
              disabled={isSelf && user.isAdmin}>
              <ListItemIcon><ShieldIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{user.isAdmin ? t('admin:revokeAdmin') : t('admin:grantAdmin')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { close(); setEnabled.mutate({ username: user.username, enabled: !user.enabled }); }}>
              <ListItemIcon><BlockIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{user.enabled ? t('admin:disable') : t('admin:enable')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { close(); setConfirmDelete(true); }} disabled={isSelf} sx={{ color: 'error.main' }}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText>{t('common:delete')}</ListItemText>
            </MenuItem>
          </Menu>
        </Stack>
      </CardContent>
      <ConfirmDialog open={confirmDelete} title={t('admin:deleteTitle')} message={t('admin:deleteConfirm', { email: user.email || user.username })}
        confirmLabel={t('common:delete')} loading={del.isPending}
        onConfirm={async () => { await del.mutateAsync({ username: user.username, sub: user.sub }); setConfirmDelete(false); }}
        onClose={() => setConfirmDelete(false)} />
    </Card>
  );
}

export function UserManagement() {
  const { t } = useTranslation(['admin']);
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAdminUsers();
  const { email } = useAuth();

  return (
    <AppShell>
      <PageHeader title={t('admin:title')} onBack={() => navigate('/')} />
      <Container maxWidth="sm" sx={{ py: 3 }}>
        {isLoading ? (
          <StatusView state="loading" />
        ) : isError ? (
          <StatusView state="error" message={t('admin:loadError')} />
        ) : !data?.users.length ? (
          <EmptyState title={t('admin:empty')} />
        ) : (
          <Stack spacing={1.5}>
            {data.users.map((u) => <UserCard key={u.username} user={u} isSelf={u.email === email} />)}
          </Stack>
        )}
      </Container>
    </AppShell>
  );
}
```

> Self-identification in the UI uses email match (the caller's email from `useAuth`) to disable self-destructive menu items; the **server** enforces the real self-lockout by `sub`. This is intentional defense-in-depth.

- [ ] **Step 2: Add the route in `main.tsx`**

```tsx
import { UserManagement } from './routes/admin/UserManagement';
import { RequireAdmin } from './auth/RequireAdmin';
// inside <Routes>:
<Route path="/admin/users" element={<RequireAdmin><UserManagement /></RequireAdmin>} />
```

- [ ] **Step 3: Typecheck + build + lint**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web build && pnpm --filter @carlog/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/admin/UserManagement.tsx apps/web/src/main.tsx
git commit -m "feat(web): admin User Management page"
```

---

## Task 13: i18n (en/uk) admin namespace

**Files:**
- Create: `apps/web/src/i18n/locales/en/admin.json`, `apps/web/src/i18n/locales/uk/admin.json`
- Modify: `apps/web/src/i18n/index.ts` (register the `admin` namespace), `apps/web/src/i18n/locales/{en,uk}/common.json` (add `userManagement`)

- [ ] **Step 1: Read `i18n/index.ts`** to see how namespaces/resources are registered (imports + `resources` map). Add `admin` alongside the others for both `en` and `uk`.

- [ ] **Step 2: `en/admin.json`**

```json
{
  "title": "User management",
  "loadError": "Could not load users.",
  "empty": "No users found.",
  "roleAdmin": "Admin",
  "disabled": "Disabled",
  "userActions": "User actions",
  "grantAdmin": "Grant admin",
  "revokeAdmin": "Revoke admin",
  "enable": "Enable",
  "disable": "Disable",
  "deleteTitle": "Delete user",
  "deleteConfirm": "Delete {{email}}? This permanently removes the account and can't be undone."
}
```

- [ ] **Step 3: `uk/admin.json`**

```json
{
  "title": "Керування користувачами",
  "loadError": "Не вдалося завантажити користувачів.",
  "empty": "Користувачів не знайдено.",
  "roleAdmin": "Адмін",
  "disabled": "Вимкнено",
  "userActions": "Дії з користувачем",
  "grantAdmin": "Надати права адміна",
  "revokeAdmin": "Забрати права адміна",
  "enable": "Увімкнути",
  "disable": "Вимкнути",
  "deleteTitle": "Видалити користувача",
  "deleteConfirm": "Видалити {{email}}? Обліковий запис буде остаточно видалено без можливості відновлення."
}
```

- [ ] **Step 4: `common.json` label** — add to both en/uk:

en: `"userManagement": "User management"` · uk: `"userManagement": "Керування користувачами"`

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n
git commit -m "feat(web): en/uk strings for user management"
```

---

## Task 14: Deploy, bootstrap first admin, verify live

**Files:** none (ops).

- [ ] **Step 1: Full gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: all green.

- [ ] **Step 2: Deploy backend (CDK) then web**

```bash
AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never
./scripts/deploy-web.sh
```

- [ ] **Step 3: Bootstrap the first admin** (replace `<UserPoolId>` from stack output, `<you>` = your Cognito username):

```bash
AWS_PROFILE=yevhenii aws cognito-idp admin-add-user-to-group \
  --user-pool-id <UserPoolId> --username <you> --group-name admin --region us-east-1
```

Then **sign out and back in** on the web app so the new token carries `cognito:groups: [admin]`.

- [ ] **Step 4: Verify**
  - As admin: the UserMenu shows "User management"; the page lists users; grant/revoke/enable/disable/delete work; your own row can't revoke-admin or delete.
  - As a non-admin (or via curl without the group): `GET /admin/users` returns **403**.
  - Self-lockout: revoking your own admin returns **409**.

- [ ] **Step 5: (No commit — ops only.)** Note results.

---

## Self-review

- **Spec coverage:** role model → Task 7 (group) + Task 8 (isAdmin) + Task 14 (bootstrap); server guard → Tasks 2/6; self-lockout → Task 5 (server) + Task 12 (client); routes → Task 6/7; contracts → Task 1; layering (port/adapter, domain SDK-free) → Task 4/5; frontend page → Task 12; UserMenu everywhere + admin item → Task 10; RequireAdmin → Task 11; i18n → Task 13; testing → Tasks 1/2/5/6; deploy+verify → Task 14. All covered.
- **Placeholders:** api-client Step 1 intentionally says to reuse the repo's existing request helper (names verified at implementation time) rather than invent fetch — flagged explicitly, not a silent gap.
- **Type consistency:** `AdminUser` shape (with `sub`) is consistent across contracts (Task 1), service mapping (Task 5), and page (Task 12); `AdminActor.sub` = caller `ownerId` = token `sub`; mutating routes pass `?sub=` for self-lockout (Tasks 6, 9).