# Custom Login + Internationalization (EN/UK) — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan(s)
**Builds on:** the deployed CarLog app (MVP + CRUD + PWA + redesign + photos).

Two features built **in parallel via git worktrees**, on a **shared i18n foundation
landed on `main` first**:
- **Feature A — Custom in-app login** replacing the Cognito Hosted UI (Amplify Auth).
- **Feature B — Full internationalization** (English + Ukrainian) of the app.

Login is built **i18n-native** (its strings live in the `auth` translation namespace
from day one), so both features consume the shared foundation and can run concurrently
without a dependency edge. Merge order: login → i18n.

## Locked Decisions

| Area | Decision |
|------|----------|
| Login auth method | AWS Amplify Auth v6 (`aws-amplify/auth`), SRP, in custom MUI screens; removes `react-oidc-context`/`oidc-client-ts` |
| Login flows | Full self-service: sign in, sign up, confirm (email code), forgot/reset password |
| Token storage | Amplify configured to persist tokens in **localStorage** (session survives reload/restart) |
| Backend | **Unchanged** — API Gateway JWT authorizer still validates the same Cognito tokens (access token carries `client_id` = audience). No CDK/API change (SRP flow already active; app client `ExplicitAuthFlows` unset). |
| i18n library | `react-i18next` + `i18next-browser-languagedetector`, JSON namespaces per locale |
| Languages | English (default) + Ukrainian; no others, no RTL |
| Switch UX | Language switcher (EN/UK) in the app bar; browser-detect on first visit → fallback English; persist choice in localStorage (`carlog.lang`) |
| Formatting | Locale-aware numbers + dates via `Intl.*` bound to the active language |
| Login strings | Covered by i18n (the `auth` namespace) — one bilingual pass, no rework |
| Parallelism | Phase 0 foundation on `main`, then 2 concurrent worktrees; merge login→i18n |

## Phase 0 — Shared i18n foundation (lands on `main` before the worktrees)

A single prep commit so both worktrees build against a stable base:
- Deps: `i18next`, `react-i18next`, `i18next-browser-languagedetector`.
- `apps/web/src/i18n/index.ts` — i18next init: `en` default, fallback `en`,
  `supportedLngs: ['en','uk']`, browser LanguageDetector with `localStorage` (key
  `carlog.lang`) then `navigator`, `react-i18next` bound.
- `apps/web/src/i18n/locales/{en,uk}/*.json` — namespaces `common`, `garage`,
  `vehicle`, `car`, `photos`, `auth`. `common` populated; others start as skeletons
  that the two worktrees fill.
- `apps/web/src/i18n/format.ts` — `formatNumber(n, lng)` / `formatDate(iso, lng)` using
  `Intl.NumberFormat`/`Intl.DateTimeFormat` for the active language.
- `apps/web/src/i18n/resolve-language.ts` — pure `resolveInitialLanguage({ stored, browser })`
  → `'en' | 'uk'` (stored wins if supported; else browser prefix if `uk`; else `en`).
  Vitest-tested.
- `main.tsx` — import the i18n init once; wrap the app so `t()` is available. Keep this
  edit minimal (it's the shared file both worktrees also touch).

## Feature A — Custom in-app login (Amplify Auth), i18n-native

**Dependency swap:** remove `react-oidc-context` + `oidc-client-ts`; add `aws-amplify` (v6).

**`apps/web/src/auth/amplify.ts`** — `Amplify.configure(...)` from the existing
`VITE_COGNITO_*` env (User Pool id, app client id, region derived from the authority/pool
id). Configure **localStorage** token persistence via
`cognitoUserPoolsTokenProvider.setKeyValueStorage(...)` backed by `window.localStorage`.

**`apps/web/src/auth/` module:**
- `useAuth()` — app hook exposing `{ user, status, idToken, accessToken, signIn, signUp,
  confirmSignUp, resendCode, forgotPassword, confirmForgotPassword, signOut }` wrapping
  Amplify's `signIn`/`signUp`/`confirmSignUp`/`resetPassword`/`confirmResetPassword`/
  `signOut`/`fetchAuthSession`.
- `AuthProvider` — holds session state; on mount calls `fetchAuthSession` to hydrate
  (stored refresh token keeps the user logged in across reloads).
- `RequireAuth` — same guard contract; when unauthenticated, **redirects to `/login`**
  (in-app route) instead of `signinRedirect()`.

**Screens (`apps/web/src/routes/auth/`), MUI + `t('auth:...')`, shared `AuthLayout`
(centered card, logo, redesign theme):**
- `Login` (`/login`) — email + password; links to sign-up and forgot-password.
- `SignUp` (`/signup`) — email + password (+ confirm) → Cognito sign-up → confirm step.
- `ConfirmSignUp` (`/confirm`) — email code → confirm → sign in.
- `ForgotPassword` (`/forgot`) — request reset code.
- `ResetPassword` (`/reset`) — code + new password → confirm reset.
- **Error mapping:** Cognito exception names (`NotAuthorizedException`,
  `UserNotConfirmedException`, `UsernameExistsException`, `CodeMismatchException`,
  `InvalidPasswordException`, `LimitExceededException`, …) → `t('auth:errors.*')`. A pure
  `authErrorKey(err)` helper, Vitest-tested.

**Routing:** `/login`, `/signup`, `/confirm`, `/forgot`, `/reset` public; `/`, `/cars/:id`
behind `RequireAuth`. The `/callback` route is **removed**. Garage sign-out calls
`signOut()`.

**API compatibility:** the api-client attaches the Amplify **access token** as
`Authorization: Bearer`. The API Gateway JWT authorizer is unchanged (same token shape).
No backend edit and **no CDK change**: the app client's `ExplicitAuthFlows` is unset
(verified), so Cognito's legacy default flow set — which includes `ALLOW_USER_SRP_AUTH` —
is active and Amplify's SRP sign-in works as-is. No Cognito callback-URL reconciliation
(SRP doesn't redirect).

**Auth strings live in the `auth` namespace** (owned by this worktree), EN + UK.

## Feature B — Full i18n of existing screens

- Replace every hardcoded string in Garage, Vehicle, CarFormDialog, ConfirmDialog,
  PhotoGallery, EmptyState, StatusView with `t()` calls under the right namespace; author
  **EN + UK** for all.
- Replace raw `toLocaleString()` / date rendering with the shared `formatNumber` /
  `formatDate` (locale-aware).
- **Language switcher** (EN/UK) in the app bar via `PageHeader` actions — MUI menu/toggle
  calling `i18n.changeLanguage(lng)` + persisting to `carlog.lang`; updates `<html lang>`.
- Fill the `common`, `garage`, `vehicle`, `car`, `photos` namespaces (the `auth` namespace
  belongs to Feature A).

## Testing

- **Vitest (pure logic):** `resolveInitialLanguage` (stored/browser/fallback branches);
  `authErrorKey` (Cognito codes → keys); a `formatNumber`/`formatDate` locale test
  (en vs uk grouping/month names); existing `resolveInstallMode`, `validatePhotoFile`,
  contracts/domain/api suites stay green.
- **Static gates:** `pnpm turbo run typecheck lint test` green.
- **SW guard:** after web build, `grep -c execute-api dist/sw.js == 0` (auth/i18n must not
  make the SW cache the API). Note: Amplify calls Cognito endpoints directly from the
  browser — confirm the SW's `globPatterns` don't precache those (they won't; SW only
  precaches built assets, and cognito-idp is cross-origin, never navigated).
- No backend tests (backend unchanged).

## Merge & Deploy (single combined web-only deploy)

1. Land Phase 0 on `main`.
2. Two worktrees build concurrently (login on `feat/custom-login`, i18n on `feat/i18n`).
3. Merge **login → main**, then **i18n → main**; resolve `main.tsx` / `PageHeader`
   conflicts.
4. Full gates green on `main`.
5. **Web-only deploy** via `scripts/deploy-web.sh` (no backend/infra change — SRP flow
   already active, so no `cdk deploy`).
6. **Live smoke test:** full auth flow on the deployed app — sign up → email confirm →
   sign in (session persists on reload) → the API accepts the Amplify token (garage
   loads, add a car) → forgot/reset password → sign out; then switch EN⇄UK and confirm
   every screen (incl. auth) translates and numbers/dates localize; `<html lang>` updates.

## Scope Guard (YAGNI)

Out of scope: languages beyond EN/UK; RTL; MFA / social / passwordless login;
server-side per-user language preference (localStorage only); theming the (now unused)
Cognito Hosted UI; changing the DynamoDB/API/photos backend.

## Files (anticipated)

**Phase 0 (main):**
```
apps/web/package.json                         + i18next, react-i18next, detector
apps/web/src/i18n/index.ts                    CREATE  i18next init
apps/web/src/i18n/format.ts                   CREATE  formatNumber/formatDate
apps/web/src/i18n/resolve-language.ts         CREATE  + .test.ts
apps/web/src/i18n/locales/en/*.json           CREATE  common populated; others skeleton
apps/web/src/i18n/locales/uk/*.json           CREATE
apps/web/src/main.tsx                          MODIFY  import i18n init
```
**Feature A (feat/custom-login):**
```
apps/web/package.json                          - react-oidc-context, oidc-client-ts; + aws-amplify
apps/web/src/auth/amplify.ts                   CREATE  Amplify.configure + localStorage
apps/web/src/auth/index.tsx (useAuth/AuthProvider/RequireAuth)  CREATE (replaces auth.tsx)
apps/web/src/auth/auth-error.ts                CREATE  authErrorKey + .test.ts
apps/web/src/routes/auth/{AuthLayout,Login,SignUp,ConfirmSignUp,ForgotPassword,ResetPassword}.tsx  CREATE
apps/web/src/routes/Callback.tsx               DELETE
apps/web/src/main.tsx                          MODIFY  auth provider + public/guarded routes
apps/web/src/api-client.ts                     MODIFY  Bearer = Amplify access token
apps/web/src/queries.ts                        MODIFY  token source = useAuth()
apps/web/src/routes/Garage.tsx                 MODIFY  sign-out via new signOut
apps/web/src/i18n/locales/{en,uk}/auth.json    FILL
infrastructure/cdk/lib/carlog-stack.ts         NO CHANGE (SRP flow already active)
```
**Feature B (feat/i18n):**
```
apps/web/src/components/ui/LanguageSwitcher.tsx CREATE
apps/web/src/components/ui/PageHeader.tsx       MODIFY  switcher slot
apps/web/src/routes/Garage.tsx                  MODIFY  t() + formatNumber
apps/web/src/routes/Vehicle.tsx                 MODIFY  t() + format
apps/web/src/components/{CarFormDialog,ConfirmDialog,PhotoGallery}.tsx  MODIFY  t()
apps/web/src/components/ui/{EmptyState,StatusView}.tsx  MODIFY  t()
apps/web/src/i18n/locales/{en,uk}/{common,garage,vehicle,car,photos}.json  FILL
```
