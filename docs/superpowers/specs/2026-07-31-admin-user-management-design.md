# Admin User Management — Design

**Date:** 2026-07-31
**Status:** Approved (pending spec review)

## Goal

Add an admin-only **User Management** feature to CarLog. Only users whose token
carries the `admin` role may access it. This first slice delivers a full vertical
slice: the Cognito role model, an admin-gated backend API, and a frontend page that
lists and fully manages users (grant/revoke admin, enable/disable, delete).

Also in scope (adjacent UX request): the `UserMenu` must appear in **every** page
header, and the "User management" entry sits between "Account" and "Sign out".

## Role model

- A new Cognito **user pool group `admin`**. Group membership is emitted in the
  access/ID token as the `cognito:groups` claim.
- The **first** admin is bootstrapped once, out of band:
  ```
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id <UserPoolId> --username <you> --group-name admin --profile yevhenii
  ```
  A re-login (or token refresh) is required for the new claim to appear in the token.
- After the first admin exists, admins manage each other in-app.

## Security boundary (non-negotiable)

- The HTTP API JWT authorizer validates the token but does **not** check groups.
- Therefore **every `/admin/*` route runs a server-side admin guard** that reads
  `cognito:groups` from `event.requestContext.authorizer.jwt.claims` and returns
  **403** for non-admins. Client-side hiding of the link/route is UX only, never
  the security control.
- The claim may arrive as a JSON array or a serialized string (e.g. `"[admin]"` or
  `"admin"`); the guard parses both robustly.

## Backend

Extends the existing single Lambda router in `apps/api/src/handler.ts` (consistent
with the current monolith), plus a Cognito adapter behind a port.

### Routes (all behind the admin guard)
- `GET /admin/users` — list users (Cognito `ListUsers`), paginated (pass through
  `paginationToken`); returns `{ users: AdminUser[], nextToken?: string }`.
- `PUT /admin/users/{username}/admin` — grant admin (`AdminAddUserToGroup`).
- `DELETE /admin/users/{username}/admin` — revoke admin (`AdminRemoveUserFromGroup`).
- `PUT /admin/users/{username}/enabled` — body `{ enabled: boolean }`
  (`AdminEnableUser` / `AdminDisableUser`).
- `DELETE /admin/users/{username}` — delete user (`AdminDeleteUser`).

### Self-lockout guards (server-side, in addition to client)
- An admin may **not revoke their own admin** role.
- An admin may **not delete themselves**.
- Identify "self" by comparing the caller's `sub` claim to the target user's `sub`
  attribute (Cognito `Username` is not reliably the sub for federated/email pools,
  so `sub` is the stable key). Violations return **409** (conflict) with a clear code.

### Layering (per AGENTS.md)
- `packages/domain` stays framework-independent — **no AWS SDK**.
- Define a `CognitoUserAdminPort` interface (list/addToGroup/removeFromGroup/
  enable/disable/delete). The AWS implementation (`@aws-sdk/client-cognito-identity-provider`)
  lives in an `apps/api` adapter. A thin application service composes the guard +
  port; the handler parses input, calls the service, shapes the response.
- The admin guard (claim parsing + isAdmin decision) is a **pure function** with
  unit tests.

### Contracts (`packages/contracts`, Zod → `z.infer`)
- `AdminUserSchema`: `{ username, sub, email, status, enabled, createdAt, isAdmin }`
  (`sub` is the stable identity used for self-lockout comparisons; `username` is the
  key passed to the Cognito Admin* actions).
- `ListUsersResponseSchema`: `{ users: AdminUser[], nextToken?: string }`.
- `SetEnabledSchema`: `{ enabled: boolean }`.

### CDK (`infrastructure/cdk`)
- Create the `admin` `CfnUserPoolGroup` in the user pool.
- Grant the Lambda execution role, scoped to the user pool ARN:
  `cognito-idp:ListUsers`, `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`,
  `AdminEnableUser`, `AdminDisableUser`, `AdminDeleteUser`, `AdminGetUser`.
- Pass the user pool id to the Lambda via env (already available in stack).

## Frontend

### Auth
- Extend `useAuth`/`AuthProvider`: expose `isAdmin: boolean` and `groups: string[]`,
  derived in `refresh()` from `session.tokens?.accessToken?.payload['cognito:groups']`
  (Amplify decodes the payload). Default `[]` / `false`.

### UserMenu — everywhere + admin entry
- Move `<UserMenu/>` into `PageHeader` so it renders on every page header. Remove
  the per-page `actions={<UserMenu/>}` on Garage; `PageHeader` keeps an optional
  `actions` slot for page-specific items placed left of the menu. Auth screens use
  `AuthLayout` (no `PageHeader`) and are unaffected.
- In `UserMenu`, add a **"User management"** `MenuItem` **between** the Account
  (Profile) item and Sign out, rendered only when `isAdmin`.

### Routing
- New route `/admin/users` wrapped in a `RequireAdmin` guard: `loading` → spinner;
  unauthenticated → redirect `/login`; authenticated but not admin → redirect `/`
  (no admin page flash).

### User Management page
- Lists users as cards (mobile-first, consistent with the app): email, status,
  created date, enabled state, and an admin badge.
- Per-user actions: grant/revoke admin, enable/disable, delete — each mutating via
  typed api-client + TanStack Query hooks, with optimistic-friendly invalidation.
- Destructive/irreversible actions (delete, disable, revoke admin) confirm through
  the universal `ConfirmDialog`.
- The current user's own row disables "revoke admin" and "delete" (mirrors the
  server guard) to prevent self-lockout.
- Loading/error/empty states via the existing `StatusView`/`EmptyState`.
- Full **en/uk** i18n for all strings (new `admin` namespace).

## Testing

- **Pure guard** (`isAdmin`/claim parsing): unit tests — array claim, string claim,
  missing claim, non-admin, admin.
- **Contracts**: schema parse/reject tests for the new schemas.
- **Self-lockout** decision logic: unit tests (caller == target cases).
- **Live verification**: exercise each endpoint (200 as admin, 403 as non-admin,
  409 on self-lockout) and the page flows after deploy.

## Out of scope (later increments)

- Inviting/creating users from the UI.
- Server-side search/filter/sort of the user list (client-side for the first pass).
- Audit logging of admin actions.