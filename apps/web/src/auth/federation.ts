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
