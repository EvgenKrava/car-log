import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { defaultStorage } from 'aws-amplify/utils';

// VITE_COGNITO_AUTHORITY looks like https://cognito-idp.<region>.amazonaws.com/<poolId>
const authority = import.meta.env.VITE_COGNITO_AUTHORITY as string;
const region = authority.split('.')[1] ?? 'us-east-1';
const userPoolId = authority.split('/').pop() ?? '';

export function configureAmplify(): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
      },
    },
  });
  // Persist tokens in localStorage so sessions survive reload/restart (defaultStorage is localStorage).
  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
  void region; // region is embedded in userPoolId; kept for clarity/debugging
}
