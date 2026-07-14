import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { defaultStorage } from 'aws-amplify/utils';

// VITE_COGNITO_AUTHORITY looks like https://cognito-idp.<region>.amazonaws.com/<poolId>
const authority = import.meta.env.VITE_COGNITO_AUTHORITY as string;
const userPoolId = authority.split('/').pop() ?? '';

// VITE_COGNITO_DOMAIN is emitted by deploy-web.sh as a full URL
// (https://carlog-<account>.auth.<region>.amazoncognito.com). Amplify wants the
// host only, so strip the scheme and any trailing slash.
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
  // Persist tokens in localStorage so sessions survive reload/restart (defaultStorage is localStorage).
  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
}
