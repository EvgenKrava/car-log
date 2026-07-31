import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, type StackProps,
} from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  AccountRecovery, OAuthScope, ProviderAttribute, UserPool, UserPoolClient,
  UserPoolClientIdentityProvider, UserPoolIdentityProviderGoogle,
} from 'aws-cdk-lib/aws-cognito';
import { HttpApi, CorsHttpMethod, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Distribution, PriceClass, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import type { Construct } from 'constructs';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

type CarLogStackProps = StackProps & {
  // Resolved from SSM SecureString parameters at synth time in bin/carlog.ts. Both must be
  // literal values at deploy: CloudFormation does not support ssm-secure dynamic references
  // in Cognito IdP ProviderDetails or Lambda environment variables.
  googleClientSecret: string;
  bedrockBearerToken: string;
};

export class CarLogStack extends Stack {
  constructor(scope: Construct, id: string, props: CarLogStackProps) {
    super(scope, id, props);

    const table = new Table(this, 'CarLogTable', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    const userPool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `carlog-${this.account}` },
    });

    // Google federated sign-in. The client id is non-secret; the client secret is
    // resolved from SSM SecureString at synth time (see bin/carlog.ts) and passed in as a
    // literal — CloudFormation rejects ssm-secure dynamic references in Cognito IdP
    // ProviderDetails, so the plaintext must reach the template directly.
    const googleIdP = new UserPoolIdentityProviderGoogle(this, 'GoogleIdP', {
      userPool,
      clientId: '290283855365-pqhjtbokk5k7bfccg3phiurskol4u8qs.apps.googleusercontent.com',
      clientSecretValue: SecretValue.unsafePlainText(props.googleClientSecret),
      scopes: ['openid', 'email', 'profile'],
      attributeMapping: { email: ProviderAttribute.GOOGLE_EMAIL },
    });

    // Web origin known after distribution is created; use placeholder callback that we
    // reconcile post-deploy via CLI, plus localhost for dev.
    const client = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false,
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
        UserPoolClientIdentityProvider.GOOGLE,
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:5173/callback'],
        logoutUrls: ['http://localhost:5173'],
      },
    });
    // CloudFormation must create the IdP before updating the client to reference it,
    // otherwise the deploy fails with "identity provider Google does not exist".
    client.node.addDependency(googleIdP);

    const photosBucket = new Bucket(this, 'PhotosBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [{
        allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
        allowedOrigins: ['https://dkn291e7rr9st.cloudfront.net', 'http://localhost:5173'],
        allowedHeaders: ['*'],
        maxAge: 3000,
      }],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        // Uploaded import .txt files are transient job inputs — purge after a day.
        { prefix: 'imports/', expiration: Duration.days(1) },
        { prefix: 'scans/', expiration: Duration.days(1) },
      ],
    });

    // Bedrock runs in a DIFFERENT (Bedrock-enabled) account: the bearer token in
    // /carlog/bedrock-bearer-token is issued BY that account, so the runtime call reaches
    // that account's Bedrock with no cross-account IAM. Its model access may live in a
    // different region than this stack — pass `-c bedrockRegion=<region>` at deploy to set
    // BEDROCK_REGION; when unset, the Lambda falls back to its own AWS_REGION.
    const bedrockRegion = this.node.tryGetContext('bedrockRegion') as string | undefined;

    // Created before the Lambda so its apiId can be passed into the function's environment
    // (used by the admin metrics handler to scope CloudWatch GetMetricData queries to this
    // API). Routes are added further below, once the Lambda integration exists.
    const httpApi = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const fn = new NodejsFunction(this, 'CarsFn', {
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirnameLocal, '../../../apps/api/src/handler.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME: table.tableName,
        PHOTOS_BUCKET: photosBucket.bucketName,
        USER_POOL_ID: userPool.userPoolId,
        API_ID: httpApi.apiId,
        // Bearer token (issued by the Bedrock-enabled account), resolved from SSM
        // SecureString at synth time (see bin/carlog.ts). CloudFormation rejects ssm-secure
        // dynamic references in Lambda env vars, so it must be a literal. Read by
        // AnthropicBedrockMantle; self-identifying, so it reaches that account cross-account.
        AWS_BEARER_TOKEN_BEDROCK: props.bedrockBearerToken,
        // Only set BEDROCK_REGION when a region was passed via context (keeps the env clean
        // otherwise; the adapter falls back to AWS_REGION).
        ...(bedrockRegion ? { BEDROCK_REGION: bedrockRegion } : {}),
      },
      // 300s: detached import-worker invocations (async self-invoke) chunk large files
      // through Bedrock and need minutes. HTTP calls are still bounded by API Gateway's
      // own 30s integration cap regardless of this value.
      timeout: Duration.seconds(300),
      // Cost: 256 MB is the price/performance sweet spot for this CRUD workload.
      memorySize: 256,
      // Note: we intentionally do NOT set reservedConcurrentExecutions. This account's
      // total Lambda concurrency quota is 10, and AWS requires >=10 unreserved, so any
      // reservation is rejected. The account-wide cap of 10 already bounds concurrent
      // compute; API Gateway stage throttling (below) handles request-rate limiting.
      logRetention: RetentionDays.ONE_WEEK,
      bundling: { format: undefined },
    });
    table.grantReadWriteData(fn);
    photosBucket.grantReadWrite(fn);
    // The import worker runs as a detached async invocation of this same function.
    // grantInvoke(fn) self-references and can cycle; a wildcard-scoped policy statement
    // on the role avoids the circular dependency.
    fn.addToRolePolicy(new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:*`],
    }));
    fn.addToRolePolicy(new PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:ListUsersInGroup',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminGetUser',
      ],
      resources: [userPool.userPoolArn],
    }));
    // GetMetricData has no resource-level scoping in IAM — '*' is correct/required.
    fn.addToRolePolicy(new PolicyStatement({ actions: ['cloudwatch:GetMetricData'], resources: ['*'] }));

    const authorizer = new HttpJwtAuthorizer('JwtAuthorizer', userPool.userPoolProviderUrl, {
      jwtAudience: [client.userPoolClientId],
    });

    const integration = new HttpLambdaIntegration('CarsIntegration', fn);
    httpApi.addRoutes({ path: '/cars', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/photos', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/photos/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/photos/{photoId}', methods: [HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/from-scan', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/{proofId}', methods: [HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders/{reminderId}', methods: [HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders/{reminderId}/complete', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/extract', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/jobs', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/jobs/{jobId}', methods: [HttpMethod.GET, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/import/scan/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/scan', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/admin/users', methods: [HttpMethod.GET], integration, authorizer });
    httpApi.addRoutes({ path: '/admin/users/{username}', methods: [HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/admin/users/{username}/admin', methods: [HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/admin/users/{username}/enabled', methods: [HttpMethod.PUT], integration, authorizer });
    httpApi.addRoutes({ path: '/admin/metrics', methods: [HttpMethod.GET], integration, authorizer });

    // Rate limiting: throttle the default stage so no client can flood the API.
    // 20 req/s steady with a 40-request burst is ample for the MVP and bounds cost.
    const defaultStage = httpApi.defaultStage!.node.defaultChild as CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: 20,
      throttlingBurstLimit: 40,
    };

    const webBucket = new Bucket(this, 'WebBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, 'WebDistribution', {
      defaultRootObject: 'index.html',
      // Cost: cheapest price class (North America + Europe edges only).
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'WebBucketName', { value: webBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
