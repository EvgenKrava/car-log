# "Continue with Google" Sign-In — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Continue with Google" federated sign-in (Amplify `signInWithRedirect` via Cognito's Google IdP) to the custom Login and SignUp screens, keeping email/password on the existing SRP flow.

**Architecture:** CDK adds a Cognito Google identity provider (secret from SSM) and enables it on the app client (whose OAuth flow/scopes/callbacks already exist). Frontend adds the Amplify `loginWith.oauth` config, a reused `GoogleSignInButton`, an Amplify-native `/callback` route, and a Hub listener. Only Google uses the OAuth redirect; SRP email/password is unchanged.

**Tech Stack:** aws-cdk-lib ^2.160 (`aws-cognito` UserPoolIdentityProviderGoogle, `SecretValue.ssmSecure`), aws-amplify v6 (`aws-amplify/auth` `signInWithRedirect`, `aws-amplify/utils` `Hub`), React 18 + MUI, react-router v6, react-i18next.

## Global Constraints

- Frontend + CDK only. NO change to the SRP email/password flows or the backend API/Lambda/DynamoDB.
- Strict TS, never `any`. MUI only. Extensionless imports. Every user-facing string translated EN + UK.
- **Secret handling:** the Google client SECRET is read via `SecretValue.ssmSecure('/carlog/google-client-secret')` — never hardcoded, never in synth output. The client ID is non-secret and may be in code: `290283855365-pqhjtbokk5k7bfccg3phiurskol4u8qs.apps.googleusercontent.com`.
- Cognito hosted domain: `carlog-898836755334` (region us-east-1). App client `3ud7k7q094uhuetdu0htkpgg99` already has `AllowedOAuthFlows:[code]`, scopes `openid/email/profile`, callbacks `/callback` on CloudFront + localhost, `SupportedIdentityProviders:[COGNITO]` — only `Google` needs adding.
- All needed `VITE_*` env vars (`VITE_COGNITO_DOMAIN`, `VITE_REDIRECT_URI`, `VITE_LOGOUT_URI`, `VITE_COGNITO_AUTHORITY`, `VITE_COGNITO_CLIENT_ID`) are ALREADY emitted by `deploy-web.sh` — no deploy-script or `.env.example` change.
- SW must not cache API: after web build `grep -c execute-api dist/sw.js == 0`.
- AWS profile `yevhenii`, region `us-east-1`. Conventional commits; NO co-authorship trailers.
- **USER prerequisites (block only the live verification in Task 5, not the build):** (1) rotate the Google secret + `aws ssm put-parameter --name /carlog/google-client-secret --type SecureString`; (2) add `https://carlog-898836755334.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` to the Google Console Authorized redirect URIs.

## File Structure

```
infrastructure/cdk/lib/carlog-stack.ts               MODIFY  Google IdP + enable on client + dependency (T1)
apps/web/src/auth/amplify.ts                          MODIFY  add loginWith.oauth block (T2)
apps/web/src/components/ui/GoogleSignInButton.tsx     CREATE  (T3)
apps/web/src/routes/auth/Login.tsx                    MODIFY  button + divider above form (T3)
apps/web/src/routes/auth/SignUp.tsx                   MODIFY  button + divider above form (T3)
apps/web/src/i18n/locales/{en,uk}/auth.json           MODIFY  continueWithGoogle/orDivider/errors.federation (T3)
apps/web/src/routes/Callback.tsx                      CREATE  Amplify-native federated callback (T4)
apps/web/src/auth/index.tsx                           MODIFY  Hub listener in AuthProvider (T4)
apps/web/src/main.tsx                                 MODIFY  register public /callback route (T4)
```

Order: CDK (1) → amplify oauth config (2) → button + screens + i18n (3) → callback + Hub + route (4) → verify + deploy (5).

---

### Task 1: CDK — Google IdP + enable on the app client

**Files:**
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Consumes: existing `userPool`, the app client construct (find its variable — likely `userPoolClient` or `client`), `SecretValue`.
- Produces: a `UserPoolIdentityProviderGoogle` construct; `Google` added to the client's `supportedIdentityProviders`.

- [ ] **Step 1: Read the current Cognito constructs**

Run: `grep -nE 'UserPool|UserPoolClient|supportedIdentityProviders|import' infrastructure/cdk/lib/carlog-stack.ts | head -30`
Identify: the `userPool` variable, the app-client variable, and the current `aws-cognito` import list. The client currently sets `supportedIdentityProviders: [UserPoolClientIdentityProviderType.COGNITO]` (or similar). Note the exact names.

- [ ] **Step 2: Extend the imports**

Ensure these are imported from `aws-cdk-lib/aws-cognito`: `UserPoolIdentityProviderGoogle`, `ProviderAttribute`, `UserPoolClientIdentityProvider` (the client provider enum — may already be imported as `UserPoolClientIdentityProviderType`; match whatever the file already uses). Add `SecretValue` to the `aws-cdk-lib` root import (alongside `Duration`, `RemovalPolicy`, etc.).

- [ ] **Step 3: Add the Google IdP construct (before the app client, or add a dependency)**

Add near the UserPool definition:

```ts
const googleIdP = new UserPoolIdentityProviderGoogle(this, 'GoogleIdP', {
  userPool,
  clientId: '290283855365-pqhjtbokk5k7bfccg3phiurskol4u8qs.apps.googleusercontent.com',
  clientSecretValue: SecretValue.ssmSecure('/carlog/google-client-secret'),
  scopes: ['openid', 'email', 'profile'],
  attributeMapping: { email: ProviderAttribute.GOOGLE_EMAIL },
});
```

- [ ] **Step 4: Enable Google on the app client + add the dependency**

In the app client's `supportedIdentityProviders` array, add the Google enum so it reads (match the enum name already used in the file — `UserPoolClientIdentityProvider.GOOGLE` for the L2 `UserPoolClient`):

```ts
supportedIdentityProviders: [
  UserPoolClientIdentityProvider.COGNITO,
  UserPoolClientIdentityProvider.GOOGLE,
],
```

Then after the client construct is defined, add:

```ts
<appClientVar>.node.addDependency(googleIdP);
```

(so CloudFormation creates the IdP before updating the client to reference it — otherwise the deploy fails with "identity provider Google does not exist").

- [ ] **Step 5: Synth and verify (secret must NOT appear literally)**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk typecheck && AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth > /tmp/g-synth.txt`
Then:
```bash
grep -c 'AWS::Cognito::UserPoolIdentityProvider' /tmp/g-synth.txt   # expect >=1
grep -c 'Google' /tmp/g-synth.txt                                    # expect >=1 (IdP + client provider)
grep -c 'ssm-secure\|/carlog/google-client-secret' /tmp/g-synth.txt  # expect >=1 (dynamic ref present)
grep -c 'GOCSPX' /tmp/g-synth.txt                                    # expect 0 (literal secret ABSENT)
```
Expected: typecheck passes; synth succeeds; IdP + Google present; the SSM dynamic reference present; **no literal secret** (`GOCSPX` count 0).

**If `SecretValue.ssmSecure` is rejected by `clientSecretValue`'s type in this CDK version:** fall back — add a `clientSecret` string prop fed from a CDK context value, and change the deploy command (documented in Task 5) to `--context googleClientSecret=$(aws ssm get-parameter --name /carlog/google-client-secret --with-decryption --query Parameter.Value --output text)`, reading it in the stack via `this.node.tryGetContext('googleClientSecret')`. Never hardcode. Note in the report which path was used.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(cdk): add Cognito Google identity provider (secret via SSM) and enable on app client"
```

---

### Task 2: Amplify OAuth config

**Files:**
- Modify: `apps/web/src/auth/amplify.ts`

**Interfaces:**
- Consumes: `VITE_COGNITO_DOMAIN`, `VITE_REDIRECT_URI`, `VITE_LOGOUT_URI` (already emitted by deploy-web.sh; present in `.env.production` at build).
- Produces: an Amplify config that includes `loginWith.oauth` so `signInWithRedirect({provider:'Google'})` works.

- [ ] **Step 1: Rewrite `apps/web/src/auth/amplify.ts` to add the oauth block**

The current file configures only `Auth.Cognito.userPoolId/userPoolClientId`. Add the `loginWith.oauth` block. `VITE_COGNITO_DOMAIN` is a full URL (`https://carlog-....amazoncognito.com`) — Amplify's `domain` wants the host only, so strip the scheme. `VITE_REDIRECT_URI` is a single URL (`https://.../callback`); Amplify wants arrays. Derive the localhost variants for dev, or just pass the single deployed values (they differ per build via env). Use:

```ts
import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { defaultStorage } from 'aws-amplify/utils';

const authority = import.meta.env.VITE_COGNITO_AUTHORITY as string;
const userPoolId = authority.split('/').pop() ?? '';
const domainUrl = (import.meta.env.VITE_COGNITO_DOMAIN as string) ?? '';
const domainHost = domainUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
const redirectSignIn = (import.meta.env.VITE_REDIRECT_URI as string) ?? '';
const redirectSignOut = (import.meta.env.VITE_LOGOUT_URI as string) ?? '';

export function configureAmplify(): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
        loginWith: {
          oauth: {
            domain: domainHost,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [redirectSignIn],
            redirectSignOut: [redirectSignOut],
            responseType: 'code',
          },
        },
      },
    },
  });
  // Persist tokens in localStorage so sessions survive reload/restart.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
}
```

Note: `loginWith.oauth` lives INSIDE `Auth.Cognito` in Amplify v6 (not at the top level). The `region`/`void region` line is dropped (was unused).

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS. (Note: `.env` from `.env.example` has empty VITE_COGNITO_DOMAIN etc. — build must still succeed with empty strings; the values are real at deploy.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/auth/amplify.ts
git commit -m "feat(web): add Amplify OAuth config for Google federated sign-in"
```

---

### Task 3: GoogleSignInButton + Login/SignUp + i18n

**Files:**
- Create: `apps/web/src/components/ui/GoogleSignInButton.tsx`
- Modify: `apps/web/src/routes/auth/Login.tsx`, `apps/web/src/routes/auth/SignUp.tsx`
- Modify: `apps/web/src/i18n/locales/en/auth.json`, `apps/web/src/i18n/locales/uk/auth.json`

**Interfaces:**
- Consumes: `signInWithRedirect` from `aws-amplify/auth`; `useTranslation`.
- Produces: `GoogleSignInButton()` component.

- [ ] **Step 1: Add i18n keys to `apps/web/src/i18n/locales/en/auth.json`**

Add (keep existing keys): `"continueWithGoogle": "Continue with Google"`, `"orDivider": "or"`, and inside the existing `errors` object add `"federation": "Google sign-in failed. Please try again."`.

- [ ] **Step 2: Add the same keys to `apps/web/src/i18n/locales/uk/auth.json`**

`"continueWithGoogle": "Продовжити з Google"`, `"orDivider": "або"`, and in `errors`: `"federation": "Не вдалося увійти через Google. Спробуйте ще раз."`.

- [ ] **Step 3: Create `apps/web/src/components/ui/GoogleSignInButton.tsx`**

```tsx
import { Button, SvgIcon } from '@mui/material';
import { signInWithRedirect } from 'aws-amplify/auth';
import { useTranslation } from 'react-i18next';

function GoogleIcon() {
  return (
    <SvgIcon viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </SvgIcon>
  );
}

export function GoogleSignInButton() {
  const { t } = useTranslation(['auth']);
  const onClick = () => { void signInWithRedirect({ provider: 'Google' }); };
  return (
    <Button variant="outlined" fullWidth startIcon={<GoogleIcon />} onClick={onClick}>
      {t('auth:continueWithGoogle')}
    </Button>
  );
}
```

- [ ] **Step 4: Add the button + divider to `apps/web/src/routes/auth/Login.tsx`**

Import `GoogleSignInButton` and MUI `Divider`. Inside the `AuthLayout`, BEFORE the `<form>`, add:

```tsx
        <GoogleSignInButton />
        <Divider>{t('auth:orDivider')}</Divider>
```

(The Login component already has `t` from `useTranslation(['auth'])` and renders inside a `Stack`; place these as the first two children so they sit above the email/password form.)

- [ ] **Step 5: Add the button + divider to `apps/web/src/routes/auth/SignUp.tsx`**

Same as Step 4: import `GoogleSignInButton` + `Divider`, render `<GoogleSignInButton />` then `<Divider>{t('auth:orDivider')}</Divider>` as the first children above the form.

- [ ] **Step 6: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/GoogleSignInButton.tsx apps/web/src/routes/auth/Login.tsx apps/web/src/routes/auth/SignUp.tsx apps/web/src/i18n/locales/en/auth.json apps/web/src/i18n/locales/uk/auth.json
git commit -m "feat(web): add Continue with Google button to Login and SignUp"
```

---

### Task 4: Callback route + Hub listener + routing

**Files:**
- Create: `apps/web/src/routes/Callback.tsx`
- Modify: `apps/web/src/auth/index.tsx`, `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `useAuth` (existing), `Hub` from `aws-amplify/utils`, `getCurrentUser`/`fetchAuthSession` (already imported in auth/index.tsx).
- Produces: `Callback` route component; a Hub listener in `AuthProvider`.

- [ ] **Step 1: Create `apps/web/src/routes/Callback.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser } from 'aws-amplify/auth';
import { useAuth } from '../auth';

export function Callback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Amplify processes the OAuth redirect on load. Listen for completion, and also
    // poll getCurrentUser as a fallback in case the Hub event fired before mount.
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') {
        void refresh().then(() => navigate('/', { replace: true }));
      } else if (payload.event === 'signInWithRedirect_failure') {
        setFailed(true);
      }
    });
    void getCurrentUser()
      .then(() => refresh().then(() => navigate('/', { replace: true })))
      .catch(() => { /* not signed in yet; wait for Hub or show failure below */ });
    return () => stop();
  }, [navigate, refresh]);

  useEffect(() => {
    if (failed) navigate('/login', { replace: true });
  }, [failed, navigate]);

  return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
}
```

- [ ] **Step 2: Add a Hub listener to `AuthProvider` in `apps/web/src/auth/index.tsx`**

The AuthProvider already has `refresh` (useCallback) and a mount `useEffect`. Add a second `useEffect` that subscribes to the Hub so a federated sign-in anywhere refreshes session state:

```tsx
useEffect(() => {
  const stop = Hub.listen('auth', ({ payload }) => {
    if (payload.event === 'signInWithRedirect' || payload.event === 'signedIn' || payload.event === 'signedOut') {
      void refresh();
    }
  });
  return () => stop();
}, [refresh]);
```

Add the import at the top: `import { Hub } from 'aws-amplify/utils';`.

- [ ] **Step 3: Register the public `/callback` route in `apps/web/src/main.tsx`**

Add the import (with the other route imports):

```ts
import { Callback } from './routes/Callback';
```

Add the route inside `<Routes>`, alongside the other public routes (before the guarded `/`):

```tsx
              <Route path="/callback" element={<Callback />} />
```

- [ ] **Step 4: Typecheck + lint + build + tests**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build && pnpm --filter @carlog/web test`
Expected: all PASS. Confirm the SW guard: `grep -c 'execute-api' apps/web/dist/sw.js` → `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/Callback.tsx apps/web/src/auth/index.tsx apps/web/src/main.tsx
git commit -m "feat(web): add federated /callback route and Hub listener for Google sign-in"
```

---

### Task 5: Full verification + deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Confirm user prerequisites are done**

Verify the SSM parameter exists (needed by the CDK deploy):
Run: `AWS_PROFILE=yevhenii aws ssm get-parameter --name /carlog/google-client-secret --with-decryption --query 'Parameter.Type' --output text`
Expected: `SecureString`. If "ParameterNotFound", STOP — the user must run the `put-parameter` step (and rotate the secret + add the Google Console redirect URI) before deploying. Report this as blocked-on-user, not a failure.

- [ ] **Step 2: Run all repo gates**

Run: `pnpm turbo run typecheck lint test`
Expected: all packages PASS.

- [ ] **Step 3: Deploy backend (adds the Google IdP)**

Run: `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never`
(If Task 1 used the context fallback: append `--context googleClientSecret=$(AWS_PROFILE=yevhenii aws ssm get-parameter --name /carlog/google-client-secret --with-decryption --query Parameter.Value --output text)`.)
Expected: deploys; the Google IdP is created and enabled on the client.

- [ ] **Step 4: Deploy web**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: builds, syncs, invalidates. (This also ships the already-merged password show/hide + requirement hints.)

- [ ] **Step 5: Automated live checks**

```bash
BASE=https://dkn291e7rr9st.cloudfront.net
# App + the reintroduced /callback route serve
curl -s -o /dev/null -w "/ -> %{http_code}\n" "$BASE/"
curl -s -o /dev/null -w "/callback -> %{http_code}\n" "$BASE/callback"
# Cognito authorize endpoint accepts Google as an idp (redirects, not errors):
curl -s -o /dev/null -w "authorize?idp=Google -> %{http_code}\n" \
  "https://carlog-898836755334.auth.us-east-1.amazoncognito.com/oauth2/authorize?identity_provider=Google&client_id=3ud7k7q094uhuetdu0htkpgg99&response_type=code&scope=openid+email+profile&redirect_uri=https://dkn291e7rr9st.cloudfront.net/callback"
# SW still excludes API
curl -s "$BASE/sw.js" | grep -c execute-api | sed 's/^/sw execute-api (expect 0): /'
```
Expected: `/` and `/callback` → 200; the authorize URL → 302 (redirect to Google, NOT a 400 "identity provider does not exist" — a 400 means the IdP/console wiring is off); sw execute-api → 0.

- [ ] **Step 6: Interactive live smoke test (definition of done — needs a browser)**

1. Open the app → Login shows "Continue with Google" above the form + an "or" divider.
2. Click it → redirected to Google → authenticate → returns via Cognito → lands signed-in on the garage.
3. Reload → still signed in (localStorage tokens).
4. Garage loads and "add a car" works (API accepts the federated user's token).
5. Sign out → back to `/login`, session cleared.
6. Existing email/password login still works; toggle EN⇄UK → button + divider translate.
7. Password show/hide toggle + requirement hints are visible on Login/SignUp (shipped in this deploy).

Expected: all pass. If Google sign-in errors, use the devops agent's diagnosis loop — the #1 cause is a redirect-URI mismatch across three places: Google Console Authorized redirect URIs (must have the Cognito `/oauth2/idpresponse`), the Cognito app client callback URLs (`/callback`), and the Amplify `oauth.redirectSignIn` (`/callback`). Report the exact mismatch; do not claim done until the round-trip works.

---

## Self-Review Notes

- **Spec coverage:** prerequisites → Task 5 Step 1 gate; CDK Google IdP + client enable + dependency → Task 1; Amplify oauth config → Task 2; button + Login/SignUp + i18n → Task 3; /callback + Hub + route → Task 4; verify + deploy + live smoke → Task 5. All spec layers mapped.
- **Secret safety:** `SecretValue.ssmSecure` in Task 1 with an explicit synth check (`GOCSPX` count 0) proving the literal secret never enters the template; documented fallback (context param) if the CDK prop rejects it — never hardcode either way.
- **No SRP-flow change:** Tasks touch only the oauth config, the button, the callback, and routing; the email/password `signIn`/`signUp`/etc. in auth/index.tsx are untouched.
- **Reintroduced /callback:** the OIDC-era Callback was deleted in the earlier auth swap; Task 4 adds an Amplify-native one (public route). No collision — no other route/file references the old one.
- **Env vars:** verified all needed `VITE_*` are already emitted by deploy-web.sh; no deploy-script/.env change (Task 2 consumes them).
- **Type consistency:** `GoogleSignInButton` (T3) consumed by Login/SignUp (T3); `Callback` (T4) uses `useAuth().refresh` (exists in auth/index.tsx); Hub events `signInWithRedirect`/`signInWithRedirect_failure` used consistently in T4 Callback + AuthProvider.
- **Live-verification honesty:** Task 5 gates the deploy on the SSM param existing (blocked-on-user if absent) and explicitly does NOT claim done until the interactive Google round-trip works; the authorize-endpoint curl catches IdP-wiring errors before the browser test.
- **Deferred/known:** account-linking (same email via password + Google) is out of scope per the spec; Cognito auto-creates the federated user on first sign-in.
