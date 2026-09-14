# Launch Readiness — Public Beta Hardening

**Date:** 2026-09-14
**Status:** Approved

## Goal

Take CarLog from "personal deployment" to "safe to send strangers to": a real hostname,
bounded per-user cost, no white-screen crashes, a legal footing (privacy/terms + self-service
account deletion), and a lighter first load on mobile. Everything else in the audit was
explicitly deferred (see *Accepted risks*).

## Decisions taken (audit walk-through, 2026-09-14)

| Finding | Decision |
|---|---|
| Lambda concurrency quota 10 (56% throttled) | Raise to 100 via AWS Support case (manual — API refuses below-default restriction) |
| Cognito default email, 50/day cap | **Ignore** |
| DESTROY removal policies, no PITR | **Ignore** |
| No custom domain | `carlog.onlytools.click` — cheapest, hosted zone exists |
| No privacy/terms/account deletion | All three |
| Unbounded AI + upload cost | Per-user daily AI quota + presigned POST with size cap |
| No alarms / error boundary / 404 | Error boundary + 404 only |
| Hardening gaps | Cheap fixes only (no WAF, no Secrets Manager) |
| No CI | **Ignore** |
| 1.24 MB main bundle | Route-level code-splitting + drop heic2any from precache |

## Accepted risks (deferred, revisit before growth)

- **Email:** Cognito default sender caps at 50 emails/day → signups/resets silently fail past
  that. Fix later: SES + verified domain + `EmailSendingAccount: DEVELOPER`.
- **Data retention:** table/bucket/pool are `RemovalPolicy.DESTROY`, PITR off. `cdk destroy`
  or a resource-replacing change deletes all user data.
- **No CI / no staging:** deploys are manual from a laptop.
- **No alarms:** outages surface via users. No WAF: one abusive IP consumes the global
  20 req/s stage throttle.
- **Secrets in plaintext Lambda env** (VAPID private key, Google client secret in the CFN
  template) — visible to anyone with console read access.

---

## 1. Custom domain — `carlog.onlytools.click`

**CDK** (`infrastructure/cdk/lib/carlog-stack.ts`):

- Constants at the top of the stack: `WEB_DOMAIN = 'carlog.onlytools.click'`,
  `ZONE_NAME = 'onlytools.click'`, `WEB_ORIGIN = \`https://${WEB_DOMAIN}\``.
- `HostedZone.fromLookup(this, 'Zone', { domainName: ZONE_NAME })`. `fromLookup` needs a
  concrete account in `env` — `bin/carlog.ts` passes
  `{ account: process.env.CDK_DEFAULT_ACCOUNT, region }` (the CLI populates it from the
  profile). The lookup result is cached in `cdk.context.json` — commit that file.
- `Certificate` (ACM, `CertificateValidation.fromDns(zone)`) in us-east-1 — this stack's
  region, which is also what CloudFront requires.
- `Distribution`: `domainNames: [WEB_DOMAIN]`, `certificate`.
- `ARecord` + `AaaaRecord` alias → `CloudFrontTarget(distribution)`.
- `WebUrl` output → `WEB_ORIGIN` (the deploy script derives `.env.production`, Cognito
  callback/logout URLs from this output — no script change needed).
- `UserPoolClient.callbackUrls/logoutUrls` include `WEB_ORIGIN` alongside localhost so a
  bare `cdk deploy` never leaves the pool client without the live callback.
- Photos-bucket CORS `allowedOrigins`: `[WEB_ORIGIN, 'http://localhost:5173']` (replaces the
  hardcoded `dkn291e7rr9st.cloudfront.net`).
- **Cognito hosted-UI domain stays** at `carlog-<acct>.auth.us-east-1.amazoncognito.com`.
  Changing it requires editing the Google OAuth client's authorized redirect URI in Google
  Cloud Console (manual, outside this repo). It is only visible during the Google redirect.
- The `*.cloudfront.net` hostname keeps serving (CloudFront always does) but is not a
  Cognito callback, so sign-in there fails — acceptable; nothing links to it after this.

**Manual, after first deploy:** none for DNS — the hosted zone is authoritative. First
deploy stalls on ACM DNS validation for a few minutes (CDK waits).

## 2. Hardening — cheap fixes

- **API CORS** (`HttpApi.corsPreflight.allowOrigins`): `[WEB_ORIGIN, 'http://localhost:5173']`.
  HTTP APIs with CORS configured own the response headers and ignore integration-supplied
  ones, so the `Access-Control-*` keys in `apps/api/src/errors.ts` are dead — remove them,
  keep `Content-Type`.
- **`lambda:InvokeFunction`** resource → `function:${stackName}-CarsFn*` (the generated
  name is `CarLogStack-CarsFn<hash>-<suffix>`; a name-prefix wildcard avoids the
  self-reference cycle `grantInvoke` would create).
- **CloudFront `ResponseHeadersPolicy`** on the default behaviour: HSTS 1 year +
  `includeSubdomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`. **No CSP** — MUI/emotion needs
  `style-src 'unsafe-inline'`, and presigned S3/Cognito/API origins make a safe policy
  fiddly; deferred.
- **Malformed JSON body** (`apps/api/src/handler.ts`): `JSON.parse` currently runs outside
  `withErrorHandling`, so a bad body crashes the invocation (API GW returns a generic 500).
  Parse inside a try; on failure return `400 { error: 'ValidationError', message: 'Malformed JSON body' }`.

## 3. Error boundary + 404 (web)

- `apps/web/src/components/ErrorBoundary.tsx` — class component (React 18 has no hook
  equivalent). Wraps `<Routes>` in `main.tsx`, inside `BrowserRouter` and the providers so
  the fallback can use theme + i18n. Fallback: centred MUI `Card` — title, one-line
  explanation, **Reload** button (`window.location.reload()`), **Back to garage** link
  (`href="/"`). `componentDidCatch` → `console.error` (no reporter — deferred).
- `apps/web/src/routes/NotFound.tsx` on `path="*"`: same card style, "Page not found",
  link to `/`. Public (no `RequireAuth`) — unauthenticated users on a bad URL should see
  404, not a login redirect.
- Strings in `common.json` (en + uk): `errorTitle`, `errorBody`, `reload`, `notFoundTitle`,
  `notFoundBody`, `backToGarage`.

## 4. Code-splitting (web)

- `React.lazy` + a single `<Suspense fallback={<RouteFallback />}>` around `<Routes>`:
  - **Eager:** `Login`, `Garage`, `Vehicle`, `Callback` — the logged-out entry and the two
    core screens.
  - **Lazy:** `SignUp`, `ConfirmSignUp`, `ForgotPassword`, `ResetPassword`, `Profile`,
    `ChatConversation` (pulls `react-markdown` + `remark-gfm`), `PublicVehicle`, `admin/*`,
    `NotFound`, legal pages (§6).
  - `RouteFallback`: full-height `Box` with a centred `CircularProgress` — it only shows on
    the first visit to a lazy route; the skeleton system stays for data loading.
- `vite.config.ts` → `injectManifest.globIgnores: ['**/heic2any-*.js']`. The converter is
  already a dynamic import; this stops the SW from precaching 1.35 MB on install. Existing
  gate (`sw.js` contains 0 `execute-api` references) unchanged.
- Success check: main chunk < 700 kB minified (from 1,238 kB); precache < 2 MB (from 3.2 MB).

## 5. Cost caps

### 5a. Per-user daily AI quota

**Domain** (`packages/domain/src/usage-quota.ts`):

```ts
export type QuotaKind = 'chat' | 'scan' | 'extract' | 'import' | 'transcribe';
export const DAILY_QUOTA: Record<QuotaKind, number> = {
  chat: 50, scan: 10, extract: 10, import: 3, transcribe: 30,
};
export interface UsageQuota {
  // Atomically increments today's counter; returns false (no increment) when at the limit.
  consume(ownerId: string, kind: QuotaKind, limit: number, day: string): Promise<boolean>;
}
export class QuotaExceededError extends Error { constructor(readonly kind: QuotaKind, readonly resetsAt: string) }
export const quotaDay = (now = new Date()) => now.toISOString().slice(0, 10);   // UTC date
// Midnight UTC of the day AFTER `day`, as ISO — what the 429 body reports.
export const quotaResetsAt = (day: string) => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();
export async function consumeQuota(quota, ownerId, kind, isAdmin): Promise<void>
  // isAdmin → return (admins bypass). Else consume(); false → throw QuotaExceededError.
```

Counting is by **request**, not model call: one chat turn = 1 `chat` regardless of tool
rounds; one import job = 1 `import` regardless of chunks. Simple, explainable to users.

**API** (`apps/api/src/dynamo-usage-quota.ts`): `UpdateCommand` on
`PK=USER#<sub>`, `SK=QUOTA#<kind>#<YYYY-MM-DD>`, `ADD #c :one`,
`ConditionExpression: attribute_not_exists(#c) OR #c < :limit`, `SET #ttl` = day + 2 days
(epoch seconds, uses the table's existing `ttl` attribute). `ConditionalCheckFailedException`
→ `false`. One round-trip, no read-before-write. `InMemoryUsageQuota` for tests.

Call sites (thin handlers, before the AI call): `POST …/chat/sessions/{sid}/messages`
(chat), `POST /import/scan` (scan), `POST /import/extract` (extract), `POST /import/jobs`
(import), `POST …/chat/transcribe` (transcribe). `ApiEvent` already carries `groups` →
`isAdmin(groups)`. `errors.ts` maps `QuotaExceededError` →
`429 { error: 'QuotaExceeded', kind, resetsAt }`.

**Web:** `api-client.ts` `request()` throws a typed `ApiError { status, body }` instead of
`Error('API 429')`. A `useApiErrorMessage(err)` helper returns the quota string
(`common:quotaExceeded` — "Daily limit for {{kind}} reached. Resets {{time}}.") for a 429
with `error === 'QuotaExceeded'`, else the existing generic text. Wired into the four
surfaces that show mutation errors: chat composer, scan sheet, import (paste + file), voice
button. No other error-UX change.

### 5b. Upload size cap — presigned POST

- `PhotoStorage.presignPut(key, contentType, maxSize)` → **`presignUpload(key, contentType, maxSize): Promise<PresignedUpload>`** where
  `PresignedUpload = { url: string; fields: Record<string, string> }` (contracts:
  `PresignedUploadSchema`). Implementation: `createPresignedPost` from
  `@aws-sdk/s3-presigned-post` with `Conditions: [['content-length-range', 1, maxSize], ['eq', '$Content-Type', contentType]]`,
  `Fields: { 'Content-Type': contentType }`, `Expires: 3600`.
- The two call sites that pass `maxSize = 0` today (import txt, scan) pass
  `IMPORT_FILE_MAX` / `MAX_SCAN_SIZE`. Proofs `MAX_PROOF_SIZE`, chat `maxScanSize(ct)`.
- Contracts: the four presign responses replace `uploadUrl: string` with
  `upload: PresignedUploadSchema` (`ProofPresignResponseSchema`,
  `ScanPresignResponseSchema`, `ChatAttachmentPresignResponseSchema`, and the web-local
  `ImportPresignSchema`, which moves into contracts as `ImportPresignResponseSchema`).
- Web `uploadToS3(upload, file)`: `FormData` — every `fields` entry, then `file` **last**
  (S3 ignores fields after `file`) — `fetch(upload.url, { method: 'POST', body })`. Do not
  set `Content-Type` on the fetch (the browser adds the multipart boundary).
- Photos-bucket CORS `allowedMethods` gains `POST`.
- S3 returns **204** on a successful POST — `uploadToS3` treats `res.ok` as success as now.

## 6. Legal pages + account deletion

### 6a. Privacy + terms

- Markdown sources: `apps/web/src/legal/{privacy,terms}.{en,uk}.md`, imported with
  `?raw`, rendered with the existing `react-markdown` inside a `Container maxWidth="md"`.
  Lazy route component `Legal.tsx` takes `doc: 'privacy' | 'terms'`, picks the file by
  `i18n.language` (fallback `en`). Public routes `/privacy` and `/terms`.
- Content is a **plain-English draft covering what the app actually does**: account data
  (email, Cognito), vehicle/service data, uploaded files (S3, us-east-1), AI processing
  (Amazon Bedrock/Transcribe — data not used for training), push subscriptions, public
  share links, retention (until deleted), deletion (self-service), contact email, no
  third-party analytics, no sale of data. Terms: as-is service, acceptable use, account
  termination, liability limits. **Flagged for owner review — not legal advice.**
- Links: footer of `Login` (privacy · terms) and the `Profile` account section.

### 6b. Delete my account

**API:** `DELETE /me` (JWT-protected route added in CDK). Handler steps, in order — data
first, identity last, so a mid-way failure leaves the user able to retry:

1. `cars.listByOwner(sub)` → for every `shared` car, `cars.setShared(sub, id, false)`
   (removes the `SHARE#<carId>` row — the only rows not under the user's PK).
2. `storage.deletePrefix(p)` for `proofs/<sub>/`, `scans/<sub>/`, `imports/<sub>/`,
   `chat/<sub>/` — new `PhotoStorage` method: `ListObjectsV2` paginated + `DeleteObjects`
   in batches of 1000.
3. `userData.deleteAllForOwner(sub)` — new `UserDataRepository` port (domain) /
   `DynamoUserDataRepository` (api): `Query PK=USER#<sub>` projecting keys only, paginated,
   `BatchWrite` deletes in 25s with unprocessed-item retry. Covers cars, events, proofs,
   reminders, chat sessions, import jobs, push subscriptions, quota counters.
4. `adminUsers.deleteUser(username)` — `AdminDeleteUser` (role already has the permission).
   `username` comes from the access token's `username` claim, threaded through `ApiEvent`
   as `username: string | null` next to `ownerId`. Federated (Google) users have
   `google_<id>` usernames — same call works.

Orchestration lives in `packages/domain/src/delete-account.ts` (`deleteAccount(deps, sub, username)`)
so the sequence is unit-tested against the in-memory adapters; the route is a 3-line adapter.
Returns `204`.

**Web:** `Profile` → account section → **Delete account** (outlined, `color="error"`).
Confirmation is a new `DeleteAccountDialog` (the existing `ConfirmDialog` has no text
input): explains everything is deleted permanently and requires typing `DELETE` into a
`TextField` before the destructive button enables. On success: `signOut()` → `/login`.
Strings in `auth.json` (en + uk).

---

## Testing

- **Domain/CDK:** `cdk synth` succeeds; snapshot-free — assert via `Template.fromStack`
  that the distribution has the alias + cert, the API CORS lists exactly the two origins,
  the invoke policy resource is the prefixed ARN, and a `ResponseHeadersPolicy` exists.
- **API:** unit tests through `route()` with in-memory adapters — 429 on the 4th import /
  51st chat, admin bypass, presign responses carry `upload.fields`, malformed JSON → 400,
  `DELETE /me` sequence (share rows gone, prefixes purged, PK rows gone, Cognito called
  last) and that a Cognito failure after purge still returns 5xx (retryable).
- **Domain:** `consumeQuota`, `quotaDay`/`quotaResetsAt`, `deleteAccount` ordering.
- **Web:** `uploadToS3` builds `FormData` with `file` last; `ErrorBoundary` renders the
  fallback on a throwing child; `NotFound` on an unknown path; `useApiErrorMessage` maps
  429. Bundle sizes are checked once by hand in the plan (`vite build` output), not by a
  permanent test.
- **Live:** after deploy — sign in on the new domain, upload a proof (POST path), open a
  bad URL (404), and from a throwaway **non-admin** account hit the `import` limit (3/day —
  the smallest, so it's cheap to reach) and confirm the 429 message. Quota limits are
  constants, not env-tunable.

## Rollout order

1. Domain (§1) — first deploy waits on ACM validation.
2. Hardening (§2) — depends on `WEB_ORIGIN`.
3. Error boundary + 404 (§3), code-splitting (§4) — web only, one deploy.
4. Cost caps (§5) — contracts change; deploy API and web together (old web + new API
   would break uploads).
5. Legal + deletion (§6).
