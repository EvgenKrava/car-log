import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CfnOutput, Duration, RemovalPolicy, Stack, type StackProps,
} from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import {
  AccountRecovery, OAuthScope, UserPool, UserPoolClient, UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import { HttpApi, CorsHttpMethod, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Distribution, PriceClass, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import type { Construct } from 'constructs';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

export class CarLogStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, 'CarLogTable', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
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

    // Web origin known after distribution is created; use placeholder callback that we
    // reconcile post-deploy via CLI, plus localhost for dev.
    const client = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:5173/callback'],
        logoutUrls: ['http://localhost:5173'],
      },
    });

    const fn = new NodejsFunction(this, 'CarsFn', {
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirnameLocal, '../../../apps/api/src/handler.ts'),
      handler: 'handler',
      environment: { TABLE_NAME: table.tableName },
      timeout: Duration.seconds(10),
      // Cost: 256 MB is the price/performance sweet spot for this CRUD workload.
      memorySize: 256,
      // Cost + rate limiting: cap concurrent executions so a traffic spike (or abuse)
      // cannot run away with compute spend or overwhelm DynamoDB.
      reservedConcurrentExecutions: 10,
      logRetention: RetentionDays.ONE_WEEK,
      bundling: { format: undefined },
    });
    table.grantReadWriteData(fn);

    const authorizer = new HttpJwtAuthorizer('JwtAuthorizer', userPool.userPoolProviderUrl, {
      jwtAudience: [client.userPoolClientId],
    });

    const httpApi = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });
    const integration = new HttpLambdaIntegration('CarsIntegration', fn);
    httpApi.addRoutes({ path: '/cars', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });

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
