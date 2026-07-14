# "Continue with Google" Sign-In — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the deployed custom Amplify auth (SRP email/password) + Cognito setup.
Completes the remaining piece of the login-UX feature (the password show/hide +
requirement hints already shipped in commit `ac30856`, pending the next web deploy).

## Goal

Add "Continue with Google" to the custom Login and SignUp screens: federated
sign-in via Cognito's Google identity provider, using Amplify's
`signInWithRedirect`. Email/password stays pure SRP (no redirect); only Google
uses the OAuth redirect through Cognito's hosted domain.

## Locked Decisions

| Area | Decision |
|------|----------|
| Return flow | Amplify `signInWithRedirect({ provider: 'Google' })` → Cognito hosted domain → Google → Cognito → app `/callback` route (Amplify-native, completes the code exchange) |
| IdP config | CDK `UserPoolIdentityProviderGoogle`; client id in code (non-secret); client **secret** via `SecretValue.ssmSecure('/carlog/google-client-secret')` (never in repo/synth) |
| Button UX | `GoogleSignInButton` at the TOP of Login AND SignUp, then an "or" divider, then the email/password form; Google-branded; reused component |
| Callback URLs | CDK/deploy own the Cognito app-client callbacks (already include `/callback`); USER adds the Google Console redirect URI |
| Scope | Google only. No other IdPs, no account-linking UI, no SRP-flow changes |

## Verified infra state (already federation-ready)

Checked live against the deployed stack — much is already in place:
- Cognito hosted domain exists: `carlog-898836755334`.
- App client (`3ud7k7q094uhuetdu0htkpgg99`) already has `AllowedOAuthFlows: [code]`,
  `AllowedOAuthFlowsUserPoolClient: true`, scopes `openid/email/profile`, and callback
  URLs `https://dkn291e7rr9st.cloudfront.net/callback` + `http://localhost:5173/callback`
  (leftover from the original OIDC setup — now reused). Public client (`generateSecret: false`).
- `SupportedIdentityProviders: [COGNITO]` — needs `Google` added.
- No identity providers configured yet — need to add the Google one.

So the CDK change is small: add the Google IdP + enable it on the client. OAuth
flow/scopes/callbacks/domain are already correct.

## Prerequisites (user manual steps — the build's live verification depends on these)

1. **Rotate** the Google client secret in the Google Cloud Console (it was pasted in
   chat) and store the fresh value in SSM:
   `aws ssm put-parameter --profile yevhenii --region us-east-1 --name /carlog/google-client-secret --type SecureString --value '<new-secret>'`
2. **Add the Cognito redirect URI** to the Google Console → Authorized redirect URIs
   (JavaScript origins already correct):
   `https://carlog-898836755334.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`

Client id `290283855365-pqhjtbokk5k7bfccg3phiurskol4u8qs.apps.googleusercontent.com`
is non-secret → goes directly in CDK.

## Layer 1 — Infrastructure (CDK)

Extend `infrastructure/cdk/lib/carlog-stack.ts`:
- `new UserPoolIdentityProviderGoogle(this, 'GoogleIdP', { userPool, clientId: <id>,
  clientSecretValue: SecretValue.ssmSecure('/carlog/google-client-secret'),
  scopes: ['openid','email','profile'],
  attributeMapping: { email: ProviderAttribute.GOOGLE_EMAIL } })`.
- Add `UserPoolClientIdentityProviderType.GOOGLE` to the existing app client's
  `supportedIdentityProviders` (currently `[COGNITO]`).
- **Dependency:** `userPoolClient.node.addDependency(googleIdP)` so the client isn't
  updated to reference the provider before it exists.
- No change to OAuth flows/scopes/callbacks/domain (already correct).
- **`SecretValue.ssmSecure` caveat:** the CDK task must `synth` first to confirm
  `UserPoolIdentityProviderGoogle.clientSecretValue` accepts `SecretValue.ssmSecure` in
  aws-cdk-lib ^2.160. If that prop requires a plain string, fall back to a deploy-time
  context param (`--context googleClientSecret=$(aws ssm get-parameter ... --with-decryption ...)`)
  — never hardcode. Flag which path was used.
- **Verify:** synth succeeds; template shows the Google IdP + `Google` in the client's
  supported providers; the literal secret does NOT appear in synth output (SSM dynamic
  reference) — grep to confirm.

## Layer 2 — Frontend (Amplify federated sign-in)

- **`apps/web/src/auth/amplify.ts`:** add the `loginWith.oauth` block to
  `Amplify.configure` (required for `signInWithRedirect`):
  ```
  loginWith: { oauth: {
    domain: <VITE_COGNITO_DOMAIN, host only>,
    scopes: ['openid','email','profile'],
    redirectSignIn: [<CloudFront>/callback, http://localhost:5173/callback],
    redirectSignOut: [<CloudFront>, http://localhost:5173],
    responseType: 'code',
  }}
  ```
  Values from `VITE_*` env — VERIFIED all already emitted by `deploy-web.sh`
  (`VITE_COGNITO_DOMAIN`, `VITE_REDIRECT_URI`, `VITE_LOGOUT_URI`, from the original OIDC
  setup); `amplify.ts` currently reads only AUTHORITY + CLIENT_ID, so this task just wires
  the existing vars into the oauth block. **No `deploy-web.sh` / `.env.example` change
  needed.** No hardcoding.
- **`apps/web/src/components/ui/GoogleSignInButton.tsx`:** MUI outlined button, Google
  "G" mark + `t('auth:continueWithGoogle')`, `onClick` → `signInWithRedirect({ provider: 'Google' })`
  from `aws-amplify/auth`. Reused on Login + SignUp.
- **Login.tsx / SignUp.tsx:** render `<GoogleSignInButton/>` at the top, then an MUI
  `Divider` with `t('auth:orDivider')`, then the existing form. No other changes.
- **`apps/web/src/routes/Callback.tsx` (reintroduced, Amplify-native):** on mount, show a
  spinner while Amplify processes the OAuth redirect; on success navigate `/`, on failure
  `/login`. Registered as a PUBLIC route in `main.tsx`.
- **`AuthProvider`:** add an Amplify `Hub` listener for `signInWithRedirect` /
  `signInWithRedirect_failure` to refresh session state after the federated return.
  `signOut()` already clears federated sessions — unchanged.
- **i18n:** new keys `auth:continueWithGoogle`, `auth:orDivider`, `auth:errors.federation`
  (EN + UK).

## Testing

- Static gates: `pnpm turbo run typecheck lint test` green; `grep -c execute-api dist/sw.js == 0`.
- The redirect flow leaves the app, so it's not unit-testable; if the Hub handler grows
  branching logic, extract a pure helper + test it. Otherwise the real proof is the live
  sign-in round-trip.
- CDK: synth passes, IdP + `Google` provider present, secret absent from synth output.

## Verification (definition of done)

Gated on the two prerequisites + user go. Deploy backend (`cdk deploy`) then web
(`deploy-web.sh` — also ships the already-merged password show/hide + hints):
1. Login shows "Continue with Google" above the form + "or" divider.
2. Click → Google → back via Cognito → signed in on the garage; reload keeps session.
3. API accepts the federated user's token (garage loads, add a car works).
4. Sign out → `/login`, session cleared.
5. Existing email/password SRP login unchanged; EN⇄UK translates the new strings.
6. Password show/hide toggle + requirement hints are live (they ship in this deploy).

**Risk:** federation is the fiddliest AWS flow; mismatched redirect URIs (Google Console
vs Cognito vs Amplify `oauth` config) are the #1 failure and only surface at the live
test. Not "done" until the live Google round-trip succeeds; the devops agent's diagnosis
loop + an exact-URL checklist pinpoints any mismatch.

## Scope Guard (YAGNI)

Out of scope: other identity providers (Apple/Facebook/etc.); account-linking UI (Cognito
auto-creates the federated user on first sign-in; password-vs-Google same-email linking is
a separate concern); any change to the SRP email/password flows or the backend API.

## Files (anticipated)

```
infrastructure/cdk/lib/carlog-stack.ts        MODIFY  Google IdP + enable on client + dependency
apps/web/src/auth/amplify.ts                   MODIFY  add loginWith.oauth block
apps/web/src/components/ui/GoogleSignInButton.tsx  CREATE
apps/web/src/routes/Callback.tsx               CREATE  Amplify-native federated callback
apps/web/src/routes/auth/Login.tsx             MODIFY  button + divider above form
apps/web/src/routes/auth/SignUp.tsx            MODIFY  button + divider above form
apps/web/src/auth/index.tsx                    MODIFY  Hub listener in AuthProvider
apps/web/src/main.tsx                          MODIFY  register public /callback route
apps/web/src/i18n/locales/{en,uk}/auth.json    MODIFY  continueWithGoogle/orDivider/errors.federation
(no .env.example / deploy-web.sh change — all needed VITE_ vars already emitted)
```
