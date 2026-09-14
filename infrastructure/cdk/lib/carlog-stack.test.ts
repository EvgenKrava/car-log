import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CarLogStack, WEB_DOMAIN, WEB_ORIGIN } from './carlog-stack';

// Bundling is skipped via context so the test never shells out to esbuild/pnpm.
// HostedZone.fromLookup returns a dummy zone when no cdk.context.json entry exists.
function synth(): Template {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new CarLogStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    googleClientSecret: 'g', vapidPublicKey: 'pub', vapidPrivateKey: 'priv',
  });
  return Template.fromStack(stack);
}

describe('CarLogStack', () => {
  const t = synth();

  it('serves the web on the custom domain with an ACM cert', () => {
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: [WEB_DOMAIN],
        ViewerCertificate: Match.objectLike({ SslSupportMethod: 'sni-only' }),
      }),
    });
    t.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: WEB_DOMAIN, ValidationMethod: 'DNS' });
    t.resourceCountIs('AWS::Route53::RecordSet', 2); // A + AAAA alias
  });

  it('attaches a security-headers policy to the default behaviour', () => {
    t.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000, IncludeSubdomains: true, Override: true }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
        }),
      }),
    });
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ResponseHeadersPolicyId: Match.anyValue() }),
      }),
    });
  });

  it('locks API CORS to the web origin + localhost', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowOrigins: [WEB_ORIGIN, 'http://localhost:5173'] }),
    });
  });

  it('locks photos-bucket CORS to the web origin + localhost and allows POST', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: { CorsRules: [Match.objectLike({
        AllowedOrigins: [WEB_ORIGIN, 'http://localhost:5173'],
        AllowedMethods: ['PUT', 'POST', 'GET'],
      })] },
    });
  });

  it("scopes self-invoke to this stack's CarsFn", () => {
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({
          Action: 'lambda:InvokeFunction',
          // Concrete env in the test → the ARN renders as a literal string, not Fn::Join.
          Resource: 'arn:aws:lambda:us-east-1:123456789012:function:TestStack-CarsFn*',
        })]),
      }),
    });
  });

  it('registers the pool client callback on the custom origin', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: [`${WEB_ORIGIN}/callback`, 'http://localhost:5173/callback'],
      LogoutURLs: [WEB_ORIGIN, 'http://localhost:5173'],
    });
  });

  it('exposes DELETE /me behind the JWT authorizer', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'DELETE /me',
      AuthorizationType: 'JWT',
    });
  });
});
