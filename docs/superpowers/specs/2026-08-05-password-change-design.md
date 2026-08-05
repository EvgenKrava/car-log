# Password Change in User Profile

**Date:** 2026-08-05
**Status:** Approved

## Goal

Let a native (email/password) user change their password from the Profile page. Google-federated
users have no Cognito password, so the entry point must not render for them — hidden, not erroring.

## Non-negotiable context (from the existing codebase)

- Auth is Cognito via **Amplify** with an in-app email/password form plus Google federation
  (`apps/web/src/auth/`). Amplify stores tokens in localStorage; `AuthProvider.refresh()`
  already reads both ID- and access-token payloads (it unions `cognito:groups` across them).
- **Never touch Cognito admin APIs or `update-user-pool-client`** — a previous attempt wiped
  prod Google login. This feature is client-only: Amplify's `updatePassword({ oldPassword,
  newPassword })` acts on the user's own session. No backend route, no CDK change, no IAM.
- Existing reusable pieces (use, don't duplicate):
  - `PasswordField` (`apps/web/src/components/ui/PasswordField.tsx`) — visibility toggle.
  - `checkPassword` (`apps/web/src/lib/password-policy.ts`) — Cognito default policy checks;
    SignUp/ResetPassword already render a checklist from it.
  - `Modal` (`apps/web/src/components/ui/Modal.tsx`) — the app's dialog primitive.
  - `authErrorKey` (`apps/web/src/auth/auth-error.ts`) — Cognito error-name → i18n key map.
- Profile page (`apps/web/src/routes/Profile.tsx`) is card-based with `SettingRow` /
  `SectionTitle` primitives; the account card already shows the email + sign-out.

## Federation detection

Cognito sets an `identities` array on the **ID token** payload for federated users; native
users have no such claim. In `AuthProvider.refresh()`:

```ts
const federated = Boolean(session.tokens?.idToken?.payload.identities);
```

Expose `isFederated: boolean` on `AuthValue` (default `false`; reset to `false` on every
unauthenticated/sign-out path, exactly like `groups`). Chosen over `getCurrentUser().signInDetails`
(absence-based, fragile across Amplify versions) and over try-and-map-the-error (dead-end UX).

## UI

**Entry point:** a "Change password" `SettingRow` in the Profile account card, rendered only
when `!isFederated`. Activating it opens the dialog.

**`ChangePasswordDialog`** (`apps/web/src/components/ChangePasswordDialog.tsx`):

- Fields: current password, new password — both `PasswordField`, `autoComplete`
  `current-password` / `new-password`. No "repeat new password" field: the visibility toggle
  covers typo risk, matching SignUp's single-field pattern.
- Live policy checklist under the new-password field, same rendering as SignUp
  (driven by `checkPassword`).
- Save disabled until `allMet` and the current-password field is non-empty. Busy state on
  the Save button while the call runs; fields disabled while busy.
- On success: close the dialog, show a success snackbar, clear both fields. The session
  stays valid — Cognito does not revoke tokens on a self-service password change — so no
  re-login and no token refresh needed.
- On error: message from `authErrorKey`, with ONE dialog-local override: in this context
  `NotAuthorizedException` means "the current password is wrong", so the dialog maps that
  name to `auth:errors.wrongCurrentPassword` before falling back to `authErrorKey`.
  `LimitExceededException` (Cognito rate limit on repeated attempts) is already mapped.
  The error renders as an `Alert` inside the dialog; the dialog stays open with the new
  password preserved and the current-password field cleared.
- Cancel/dismiss resets all state.

## i18n

New keys in the `auth` namespace, en + uk, key sets symmetric:
`changePassword` (row label + dialog title), `currentPassword`, `newPassword`,
`errors.wrongCurrentPassword`, `passwordChanged` (snackbar). Reuse the existing policy-checklist
keys SignUp uses — do not duplicate them.

## Testing

- No web component harness exists (established project fact). Gates: `pnpm turbo run build
  lint typecheck` must pass.
- If the `isFederated` derivation is extracted as a pure helper (a one-liner over a token
  payload), give it a unit test beside `token-refresh.test.ts`; otherwise the auth provider
  change is covered by typecheck + manual verification.
- Manual verification (user): change the password on an email account and re-login with the
  new one; confirm the row is absent for a Google account; confirm a wrong current password
  shows the specific error, not the generic one.

## Out of scope

- Password change/set for federated users (no Cognito password exists).
- "Sign out other devices" / global sign-out on change.
- Email change, account deletion, MFA.
- Backend/API/CDK changes of any kind.

## Decisions taken (confirmed 2026-08-05)

- Placement: **dialog from Profile** (not inline section, not dedicated route).
- Federation detection: **`identities` claim on the ID token**, exposed as `AuthValue.isFederated`.
- Client-only via Amplify `updatePassword`; Cognito admin paths are prohibited in this repo.
