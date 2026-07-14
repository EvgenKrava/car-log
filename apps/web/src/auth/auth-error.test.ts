import { describe, expect, it } from 'vitest';
import { authErrorKey } from './auth-error';

describe('authErrorKey', () => {
  it('maps NotAuthorizedException to invalidCredentials', () => {
    expect(authErrorKey({ name: 'NotAuthorizedException' })).toBe('auth:errors.invalidCredentials');
  });
  it('maps UserNotConfirmedException to notConfirmed', () => {
    expect(authErrorKey({ name: 'UserNotConfirmedException' })).toBe('auth:errors.notConfirmed');
  });
  it('maps UsernameExistsException to userExists', () => {
    expect(authErrorKey({ name: 'UsernameExistsException' })).toBe('auth:errors.userExists');
  });
  it('maps CodeMismatchException to badCode', () => {
    expect(authErrorKey({ name: 'CodeMismatchException' })).toBe('auth:errors.badCode');
  });
  it('falls back to generic for unknown', () => {
    expect(authErrorKey({ name: 'WhateverError' })).toBe('auth:errors.generic');
    expect(authErrorKey(null)).toBe('auth:errors.generic');
  });
});
