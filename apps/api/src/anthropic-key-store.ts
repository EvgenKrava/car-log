import {
  DeleteParameterCommand, GetParameterCommand, ParameterNotFound, PutParameterCommand, type SSMClient,
} from '@aws-sdk/client-ssm';

// Where the Claude API key lives. The key never goes into DynamoDB, the Lambda
// environment, logs, or any API response.
export interface AnthropicKeyStore {
  get(): Promise<string | null>;
  put(key: string): Promise<void>;
  remove(): Promise<void>;
}

// SSM Parameter Store SecureString, standard tier (free), encrypted with the AWS-managed
// aws/ssm KMS key. CloudFormation can't create SecureStrings, so the API creates the
// parameter on the first save; the stack only grants this function access to its name.
export class SsmAnthropicKeyStore implements AnthropicKeyStore {
  constructor(private readonly ssm: SSMClient, private readonly name: string) {}

  async get(): Promise<string | null> {
    try {
      const res = await this.ssm.send(new GetParameterCommand({ Name: this.name, WithDecryption: true }));
      return res.Parameter?.Value ?? null;
    } catch (err) {
      if (err instanceof ParameterNotFound) return null;
      throw err;
    }
  }

  async put(key: string): Promise<void> {
    await this.ssm.send(new PutParameterCommand({
      Name: this.name,
      Value: key,
      Type: 'SecureString',
      Tier: 'Standard',
      Overwrite: true,
      Description: 'CarLog Claude API key, set from the admin AI settings page',
    }));
  }

  async remove(): Promise<void> {
    try {
      await this.ssm.send(new DeleteParameterCommand({ Name: this.name }));
    } catch (err) {
      if (!(err instanceof ParameterNotFound)) throw err;
    }
  }
}
