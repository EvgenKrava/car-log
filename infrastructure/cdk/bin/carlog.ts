import { App } from 'aws-cdk-lib';
import { CarLogStack } from '../lib/carlog-stack';

const app = new App();
new CarLogStack(app, 'CarLogStack', {
  env: { region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' },
});
