export interface PasswordPolicyCheck {
  minLength: boolean;
  upper: boolean;
  lower: boolean;
  number: boolean;
  symbol: boolean;
  allMet: boolean;
}

/**
 * Checks a password against Cognito default policy:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one symbol
 */
export function checkPassword(password: string): PasswordPolicyCheck {
  const minLength = password.length >= 8;
  const upper = /[A-Z]/.test(password);
  const lower = /[a-z]/.test(password);
  const number = /[0-9]/.test(password);
  const symbol = /[^A-Za-z0-9]/.test(password);

  return {
    minLength,
    upper,
    lower,
    number,
    symbol,
    allMet: minLength && upper && lower && number && symbol,
  };
}
