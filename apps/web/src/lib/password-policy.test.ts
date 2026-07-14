import { describe, it, expect } from 'vitest';
import { checkPassword } from './password-policy';

describe('checkPassword', () => {
  it('should fail all checks for empty password', () => {
    const result = checkPassword('');
    expect(result.minLength).toBe(false);
    expect(result.upper).toBe(false);
    expect(result.lower).toBe(false);
    expect(result.number).toBe(false);
    expect(result.symbol).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('should fail specific checks for weak password', () => {
    const result = checkPassword('weak');
    expect(result.minLength).toBe(false);
    expect(result.upper).toBe(false);
    expect(result.lower).toBe(true);
    expect(result.number).toBe(false);
    expect(result.symbol).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('should pass minLength and lower but fail others for "password"', () => {
    const result = checkPassword('password');
    expect(result.minLength).toBe(true);
    expect(result.upper).toBe(false);
    expect(result.lower).toBe(true);
    expect(result.number).toBe(false);
    expect(result.symbol).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('should pass all checks for strong password', () => {
    const result = checkPassword('StrongP@ss1');
    expect(result.minLength).toBe(true);
    expect(result.upper).toBe(true);
    expect(result.lower).toBe(true);
    expect(result.number).toBe(true);
    expect(result.symbol).toBe(true);
    expect(result.allMet).toBe(true);
  });

  it('should recognize various symbols', () => {
    expect(checkPassword('Abcdef1!').symbol).toBe(true);
    expect(checkPassword('Abcdef1@').symbol).toBe(true);
    expect(checkPassword('Abcdef1#').symbol).toBe(true);
    expect(checkPassword('Abcdef1$').symbol).toBe(true);
    expect(checkPassword('Abcdef1%').symbol).toBe(true);
  });

  it('should meet exactly 8 chars for minLength', () => {
    expect(checkPassword('Abc12@x').minLength).toBe(false);
    expect(checkPassword('Abc12@xy').minLength).toBe(true);
  });
});
