import { execFileSync } from 'node:child_process';
import { App } from 'aws-cdk-lib';
import { CarLogStack } from '../lib/carlog-stack';

const region = process.env.CDK_DEFAULT_REGION ?? 'us-east-1';

// CloudFormation `{{resolve:ssm-secure:...}}` dynamic references are NOT supported in
// Lambda environment variables or Cognito UserPoolIdentityProvider ProviderDetails
// (the changeset is rejected with "SSM Secure reference is not supported in: ..."). Both
// consumers need the plaintext at deploy: the Cognito IdP because Cognito stores the
// client secret itself, and the Lambda because the Anthropic Bedrock SDK reads the bearer
// token from a plain env var at runtime. So we resolve the two SecureString parameters at
// synth time via the AWS CLI (the deploy already runs under AWS_PROFILE=yevhenii) and pass
// the literal values into the stack. Values are never written to the repo.
function readSecureParam(name: string): string {
  const value = execFileSync(
    'aws',
    [
      'ssm', 'get-parameter',
      '--name', name,
      '--with-decryption',
      '--region', region,
      '--query', 'Parameter.Value',
      '--output', 'text',
    ],
    { encoding: 'utf8' },
  ).trim();
  if (!value) {
    throw new Error(`SSM SecureString ${name} resolved to an empty value at synth time`);
  }
  return value;
}

const app = new App();
new CarLogStack(app, 'CarLogStack', {
  env: { region },
  googleClientSecret: readSecureParam('/carlog/google-client-secret'),
  bedrockBearerToken: readSecureParam('/carlog/bedrock-bearer-token'),
});
