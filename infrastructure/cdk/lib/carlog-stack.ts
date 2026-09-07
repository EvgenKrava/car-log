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
import { Rule, Schedule, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import type { Construct } from 'constructs';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

type CarLogStackProps = StackProps & {
  // Resolved from SSM SecureString parameters at synth time in bin/carlog.ts. Both must be
  // literal values at deploy: CloudFormation does not support ssm-secure dynamic references
  // in Cognito IdP ProviderDetails or Lambda environment variables.
  googleClientSecret: string;
  // Same mechanism (SSM SecureString resolved at synth, passed as literal props) — VAPID
  // keys for the notify worker's web-push sender.
  vapidPublicKey: string;
  vapidPrivateKey: string;
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
        // Chat attachments live as long as their session (7-day DynamoDB TTL) — expire to match.
        { prefix: 'chat/', expiration: Duration.days(7) },
      ],
    });

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
        // VAPID keys for the notify worker's web-push sender, resolved from SSM
        // SecureString at synth time (see bin/carlog.ts): CloudFormation rejects ssm-secure
        // dynamic references in Lambda environment variables.
        VAPID_PUBLIC_KEY: props.vapidPublicKey,
        VAPID_PRIVATE_KEY: props.vapidPrivateKey,
        VAPID_SUBJECT: 'mailto:admin@carlog.app',
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
      // NodejsFunction externalizes `@aws-sdk/*` by default (they're assumed present in the
      // Lambda Node runtime), but `@aws-sdk/client-transcribe-streaming` is NOT bundled into
      // nodejs20.x — without this it would be missing from the deployed asset entirely, and
      // the handler's top-level import would throw Runtime.ImportModuleError on cold start,
      // taking down every route, not just transcription. `web-push` is a plain npm package
      // esbuild bundles by default, but it is listed here too and verified empirically in
      // the synthed asset (Task 4) — the same class of incident, not worth risking twice.
      bundling: { format: undefined, nodeModules: ['@aws-sdk/client-transcribe-streaming', 'web-push'] },
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
    // Transcribe streaming has no resource-level scoping. Action name to be
    // live-verified at deploy (Task 4) — some SDK versions expose it differently.
    fn.addToRolePolicy(new PolicyStatement({ actions: ['transcribe:StartStreamTranscription'], resources: ['*'] }));
    // Bedrock chat/extraction (BedrockLlmProvider) — SigV4 via this role, no bearer token.
    // Keep the model id here in sync with BEDROCK_MODEL_ID's default in
    // apps/api/src/bedrock-llm-provider.ts. The `us.` cross-region inference profile needs
    // both its own ARN (in this stack's region) AND the underlying foundation-model ARN,
    // which has no account segment and can route to any US region — hence the wildcard.
    fn.addToRolePolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
      ],
    }));

    const authorizer = new HttpJwtAuthorizer('JwtAuthorizer', userPool.userPoolProviderUrl, {
      jwtAudience: [client.userPoolClientId],
    });

    // scopePermissionToRoute: false — one Lambda (fn) backs ~30 routes on this
    // HTTP API via a single shared integration. The default (true) creates one
    // narrowly-scoped AWS::Lambda::Permission statement per route, which hit
    // Lambda's 20480-byte resource-policy cap once the push-subscription routes
    // were added (47 statements, 20054 bytes -> 20711/20713 on CREATE_FAILED).
    // false collapses this to a single wildcard permission scoped to this API's
    // ID (execute-api:{apiId}/*/*) — still API-scoped, not account-wide; per-route
    // auth (JWT authorizer vs public) is unaffected since that's enforced by the
    // route's authorizer config, not by this permission.
    const integration = new HttpLambdaIntegration('CarsIntegration', fn, { scopePermissionToRoute: false });
    httpApi.addRoutes({ path: '/cars', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/from-scan', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/{proofId}', methods: [HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders/{reminderId}', methods: [HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/reminders/{reminderId}/complete', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/sessions', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/sessions/{sid}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/sessions/{sid}/messages', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/sessions/{sid}/actions/{aid}/confirm', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/sessions/{sid}/actions/{aid}/decline', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/attachments/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/transcribe', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/extract', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/car', methods: [HttpMethod.POST], integration, authorizer });
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
    httpApi.addRoutes({ path: '/cars/{id}/sharing', methods: [HttpMethod.PUT], integration, authorizer });
    httpApi.addRoutes({ path: '/push/subscription', methods: [HttpMethod.POST, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/public/cars/{carId}', methods: [HttpMethod.GET], integration }); // NO authorizer — public

    // Rate limiting: throttle the default stage so no client can flood the API.
    // 20 req/s steady with a 40-request burst is ample for the MVP and bounds cost.
    const defaultStage = httpApi.defaultStage!.node.defaultChild as CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: 20,
      throttlingBurstLimit: 40,
    };

    // Daily notify job: same self-invoke pattern as the import worker (Lambda invoked
    // directly, bypassing API Gateway) — EventBridge supplies the discriminant payload the
    // handler switches on. 07:00 UTC, once a day.
    new Rule(this, 'DailyNotify', {
      schedule: Schedule.cron({ minute: '0', hour: '7' }),
      targets: [new LambdaFunction(fn, { event: RuleTargetInput.fromObject({ jobType: 'notify' }) })],
    });

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
    new CfnOutput(this, 'VapidPublicKey', { value: props.vapidPublicKey });
  }
}
