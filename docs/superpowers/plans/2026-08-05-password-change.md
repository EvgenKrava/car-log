# Password Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native (email/password) users change their password from a Profile dialog via Amplify `updatePassword`; the entry point never renders for Google-federated users.

**Architecture:** Client-only. `AuthProvider.refresh()` derives `isFederated` from the ID token's `identities` claim and exposes it on `AuthValue`. A `ChangePasswordDialog` reuses `PasswordField`, the `checkPassword` policy checklist (extracted into a shared component), and the app `Modal`. No backend route, no CDK change.

**Tech Stack:** React + TypeScript (strict), MUI, `aws-amplify/auth` `updatePassword`, react-i18next, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-05-password-change-design.md` is authoritative.
- **NEVER call Cognito admin APIs or `update-user-pool-client`** — a previous attempt wiped prod Google login. Client-side `updatePassword({ oldPassword, newPassword })` only.
- Strict TypeScript, **never `any`** (eslint error). MUI only. i18n keys in BOTH `en` and `uk` `auth.json`, key sets symmetric.
- Reuse, don't duplicate: `PasswordField`, `checkPassword`, `Modal`, `authErrorKey`, and SignUp's existing checklist i18n keys (`pwMinLength`, `pwUpper`, `pwLower`, `pwNumber`, `pwSymbol`).
- No TODO/stubs. Trailing newline at EOF. Conventional commits; **no** `Co-Authored-By`/"Generated with" trailers.
- Gates: `pnpm turbo run build lint typecheck test` green before each task's final commit.
- Work directly on `main` is NOT allowed — branch `feat/password-change`.

---

## File Structure

- `apps/web/src/auth/federation.ts` (create) — pure `isFederatedPayload` helper + its test file.
- `apps/web/src/auth/index.tsx` (modify) — `isFederated` on `AuthValue`.
- `apps/web/src/components/ui/PasswordChecklist.tsx` (create) — the 5-row policy checklist extracted from SignUp (SignUp is refactored to use it; the dialog reuses it).
- `apps/web/src/components/ChangePasswordDialog.tsx` (create) — the dialog.
- `apps/web/src/routes/Profile.tsx` (modify) — "Change password" row gated on `!isFederated`.
- `apps/web/src/routes/auth/SignUp.tsx` (modify) — swap inline checklist for the shared component.
- `apps/web/src/i18n/locales/{en,uk}/auth.json` (modify) — 5 new keys each.

---

### Task 1: `isFederated` on AuthValue

**Files:**
- Create: `apps/web/src/auth/federation.ts`
- Create: `apps/web/src/auth/federation.test.ts`
- Modify: `apps/web/src/auth/index.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isFederatedPayload(payload: Record<string, unknown> | undefined): boolean`; `AuthValue.isFederated: boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/auth/federation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isFederatedPayload } from './federation';

describe('isFederatedPayload', () => {
  it('is true when the ID token carries an identities claim (Google sign-in)', () => {
    expect(isFederatedPayload({ identities: [{ providerName: 'Google' }] })).toBe(true);
    // Cognito serializes identities as a JSON string in some token versions.
    expect(isFederatedPayload({ identities: '[{"providerName":"Google"}]' })).toBe(true);
  });

  it('is false for native users and absent sessions', () => {
    expect(isFederatedPayload({ sub: 'abc', email: 'a@b.c' })).toBe(false);
    expect(isFederatedPayload(undefined)).toBe(false);
    expect(isFederatedPayload({})).toBe(false);
  });

  it('is false for an empty identities array', () => {
    expect(isFederatedPayload({ identities: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/web test src/auth/federation.test.ts`
Expected: FAIL — cannot resolve `./federation`.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/auth/federation.ts`:

```ts
// Cognito sets an `identities` claim on the ID token for federated (Google) sign-ins;
// native email/password users never have it. Some token versions serialize it as a JSON
// string rather than an array, so treat any non-empty value as federated. Federated
// users have no Cognito password, so the password-change entry point hides on this.
export function isFederatedPayload(payload: Record<string, unknown> | undefined): boolean {
  const identities = payload?.identities;
  if (identities === undefined || identities === null) return false;
  if (Array.isArray(identities)) return identities.length > 0;
  if (typeof identities === 'string') return identities.length > 2; // '[]' is not federated
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/web test src/auth/federation.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Expose it on AuthValue**

In `apps/web/src/auth/index.tsx`:

1. Add the import: `import { isFederatedPayload } from './federation';`
2. Add to the `AuthValue` type, after `groups: string[];`:

```ts
  // True for federated (Google) identities, which have no Cognito password.
  isFederated: boolean;
```

3. Add state next to `groups`:

```ts
  const [isFederated, setIsFederated] = useState(false);
```

4. In `refresh()`, inside the `if (token)` branch, after the `setGroups([...merged]);` line:

```ts
        setIsFederated(isFederatedPayload(session.tokens?.idToken?.payload as Record<string, unknown> | undefined));
```

The Amplify payload type is a `JwtPayload` indexable object; the cast to
`Record<string, unknown>` widens it for the helper without `any`.

5. Reset it to `false` in BOTH unauthenticated paths of `refresh()` (the `else` branch and
   the `catch` branch), next to the existing `setGroups([]);` calls, and in `signOut`
   (next to `setGroups([]);` there too).
6. Add `isFederated` to the `value` memo object AND its dependency array.

- [ ] **Step 6: Gates**

Run: `pnpm turbo run lint typecheck test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/auth/federation.ts apps/web/src/auth/federation.test.ts apps/web/src/auth/index.tsx
git commit -m "feat(web): expose isFederated on the auth context"
```

---

### Task 2: Shared PasswordChecklist + ChangePasswordDialog + i18n

**Files:**
- Create: `apps/web/src/components/ui/PasswordChecklist.tsx`
- Create: `apps/web/src/components/ChangePasswordDialog.tsx`
- Modify: `apps/web/src/routes/auth/SignUp.tsx` (swap inline checklist for the component)
- Modify: `apps/web/src/i18n/locales/en/auth.json`, `apps/web/src/i18n/locales/uk/auth.json`

**Interfaces:**
- Consumes: `checkPassword` (`../lib/password-policy`), `PasswordField`, `Modal`, `authErrorKey`, `updatePassword` from `aws-amplify/auth`, `isFederated` NOT needed here (Task 3 gates rendering).
- Produces: `<PasswordChecklist password={string} />`; `<ChangePasswordDialog open onClose={() => void} />` (self-contained: owns its fields, busy state, error, and success snackbar).

- [ ] **Step 1: Add the i18n keys**

`apps/web/src/i18n/locales/en/auth.json` — add at the top level:

```json
  "changePassword": "Change password",
  "currentPassword": "Current password",
  "newPassword": "New password",
  "passwordChanged": "Password changed."
```

and inside the existing `"errors"` object:

```json
    "wrongCurrentPassword": "The current password is incorrect."
```

`apps/web/src/i18n/locales/uk/auth.json` — same keys:

```json
  "changePassword": "Змінити пароль",
  "currentPassword": "Поточний пароль",
  "newPassword": "Новий пароль",
  "passwordChanged": "Пароль змінено."
```

```json
    "wrongCurrentPassword": "Поточний пароль неправильний."
```

Keep both files' key sets symmetric.

- [ ] **Step 2: Extract the checklist component**

Create `apps/web/src/components/ui/PasswordChecklist.tsx` — the exact rendering SignUp uses
today (read `SignUp.tsx:45-70` first and mirror its markup):

```tsx
import { Box } from '@mui/material';
import { CheckCircle, Circle } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { checkPassword } from '../../lib/password-policy';

// The live Cognito-policy checklist shown under a new-password field. Extracted from
// SignUp so the change-password dialog renders the identical affordance.
export function PasswordChecklist({ password }: { password: string }) {
  const { t } = useTranslation(['auth']);
  const pw = checkPassword(password);
  const rows: { met: boolean; key: string }[] = [
    { met: pw.minLength, key: 'auth:pwMinLength' },
    { met: pw.upper, key: 'auth:pwUpper' },
    { met: pw.lower, key: 'auth:pwLower' },
    { met: pw.number, key: 'auth:pwNumber' },
    { met: pw.symbol, key: 'auth:pwSymbol' },
  ];
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, fontSize: 13, color: 'text.secondary', display: 'grid', gap: 0.25 }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {r.met ? <CheckCircle fontSize="inherit" color="success" /> : <Circle fontSize="inherit" />}
          <span>{t(r.key)}</span>
        </li>
      ))}
    </Box>
  );
}
```

If SignUp's actual wrapper styles differ from the `sx` above, match SignUp — the visual
result must be identical to today's SignUp checklist.

- [ ] **Step 3: Refactor SignUp to use it**

In `apps/web/src/routes/auth/SignUp.tsx`: replace the inline `<li>` checklist block with
`<PasswordChecklist password={password} />`, add the import, and remove now-unused imports
(`CheckCircle`, `Circle`, `checkPassword` — BUT keep `checkPassword` if SignUp still uses
`pwCheck.allMet` for its own submit gating; in that case only the JSX moves). Behavior must
not change.

- [ ] **Step 4: Build the dialog**

Create `apps/web/src/components/ChangePasswordDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Snackbar, Stack } from '@mui/material';
import { updatePassword } from 'aws-amplify/auth';
import { Modal } from './ui/Modal';
import { PasswordField } from './ui/PasswordField';
import { PasswordChecklist } from './ui/PasswordChecklist';
import { checkPassword } from '../lib/password-policy';
import { authErrorKey } from '../auth/auth-error';

type Props = { open: boolean; onClose: () => void };

// In THIS dialog a NotAuthorizedException means the current password was wrong —
// map it to the specific message before falling back to the shared table.
function changePasswordErrorKey(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAuthorizedException') return 'auth:errors.wrongCurrentPassword';
  return authErrorKey(err);
}

// Self-service password change via Amplify on the user's own session. No backend,
// no admin API. Cognito does not revoke tokens on this call, so the session stays valid.
export function ChangePasswordDialog({ open, onClose }: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSave = !busy && current !== '' && checkPassword(next).allMet;

  const reset = () => { setCurrent(''); setNext(''); setErrorKey(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await updatePassword({ oldPassword: current, newPassword: next });
      setDone(true);
      close();
    } catch (err) {
      setErrorKey(changePasswordErrorKey(err));
      // Keep the (valid) new password; the wrong current password is what needs retyping.
      setCurrent('');
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open} onClose={busy ? undefined : close} title={t('auth:changePassword')}
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        actions={<Button type="submit" variant="contained" disabled={!canSave}>{t('common:save')}</Button>}
      >
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {errorKey ? <Alert severity="error">{t(errorKey)}</Alert> : null}
          <PasswordField label={t('auth:currentPassword')} value={current}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" fullWidth />
          <PasswordField label={t('auth:newPassword')} value={next}
            onChange={(e) => setNext(e.target.value)} autoComplete="new-password" fullWidth />
          <PasswordChecklist password={next} />
        </Stack>
      </Modal>
      <Snackbar open={done} autoHideDuration={4000} onClose={() => setDone(false)}
        message={t('auth:passwordChanged')} />
    </>
  );
}
```

Check `common:save` exists in both locales (it does — the rename-chat modal uses it).
While `busy`, `onClose` is `undefined`, which per `Modal`'s contract locks backdrop/Esc/swipe
dismissal — the in-flight call cannot be orphaned. Note the fields are not
explicitly disabled while busy: the locked modal plus the disabled Save cover the flow.

- [ ] **Step 5: Gates**

Run: `pnpm turbo run lint typecheck build test`
Expected: green (SignUp refactor compiles, web tests incl. federation + password-policy pass).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/PasswordChecklist.tsx apps/web/src/components/ChangePasswordDialog.tsx apps/web/src/routes/auth/SignUp.tsx apps/web/src/i18n/locales/en/auth.json apps/web/src/i18n/locales/uk/auth.json
git commit -m "feat(web): change-password dialog with shared policy checklist"
```

---

### Task 3: Profile wiring, gates, deploy

**Files:**
- Modify: `apps/web/src/routes/Profile.tsx`

**Interfaces:**
- Consumes: `ChangePasswordDialog` (Task 2), `AuthValue.isFederated` (Task 1), Profile's existing `SettingRow`.

- [ ] **Step 1: Wire the row**

In `apps/web/src/routes/Profile.tsx`:

1. Imports: `LockOutlinedIcon` from `@mui/icons-material/LockOutlined`, `ChangePasswordDialog` from `../components/ChangePasswordDialog`, and `useState` if not present.
2. Pull `isFederated` from `useAuth()` alongside `email, signOut`.
3. State: `const [pwOpen, setPwOpen] = useState(false);`
4. In the account card, above the sign-out row, add (gated):

```tsx
          {!isFederated && (
            <SettingRow
              label={t('auth:changePassword')}
              control={
                <Button variant="outlined" size="small" startIcon={<LockOutlinedIcon sx={{ fontSize: 18 }} />}
                  onClick={() => setPwOpen(true)}>
                  {t('auth:changePassword')}
                </Button>
              }
            />
          )}
```

Match the surrounding rows' control style — read the sign-out row first; if it uses a
plain `Button` variant, mirror it exactly rather than the snippet above.

5. Add the `auth` namespace to Profile's `useTranslation` array: `useTranslation(['common', 'auth'])`.
6. Render the dialog once, after the cards: `<ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />`.

- [ ] **Step 2: All gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: fully green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/Profile.tsx
git commit -m "feat(web): change-password entry on Profile, hidden for federated users"
```

- [ ] **Step 4: Merge and deploy web**

Web-only change — no CDK deploy needed:

```bash
git checkout main && git merge --no-ff feat/password-change -m "feat: password change in user profile"
./scripts/deploy-web.sh
```

Expected: build + S3 sync + CloudFront invalidation complete.

- [ ] **Step 5: Manual verification (user)**

1. Email account: Profile shows "Change password"; wrong current password → the specific
   error; correct flow → snackbar, then sign out and back in with the NEW password.
2. Google account: the row is absent.

---

## Notes for the implementer

- The dialog deliberately has no "repeat new password" field (spec decision — visibility
  toggle covers typos, matching SignUp's pattern with a single new-password entry point).
- Do not add a backend route, do not touch `infrastructure/`, do not touch Cognito config.
- `updatePassword` import must come from `aws-amplify/auth` (same module the auth provider
  already imports from).