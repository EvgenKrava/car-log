const MAP: Record<string, string> = {
  NotAuthorizedException: 'auth:errors.invalidCredentials',
  UserNotConfirmedException: 'auth:errors.notConfirmed',
  UserNotFoundException: 'auth:errors.invalidCredentials',
  UsernameExistsException: 'auth:errors.userExists',
  CodeMismatchException: 'auth:errors.badCode',
  ExpiredCodeException: 'auth:errors.expiredCode',
  InvalidPasswordException: 'auth:errors.weakPassword',
  LimitExceededException: 'auth:errors.limitExceeded',
};

export function authErrorKey(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name) : '';
  return MAP[name] ?? 'auth:errors.generic';
}
