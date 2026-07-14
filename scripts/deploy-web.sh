#!/usr/bin/env bash
set -euo pipefail
export AWS_PROFILE=yevhenii
STACK=CarLogStack
out() { aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

API_URL=$(out ApiUrl)
POOL_ID=$(out UserPoolId)
CLIENT_ID=$(out UserPoolClientId)
COGNITO_DOMAIN=$(out CognitoDomain)
BUCKET=$(out WebBucketName)
DIST_ID=$(out DistributionId)
WEB_URL=$(out WebUrl)

cat > apps/web/.env.production <<EOF
VITE_API_URL=$API_URL
VITE_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/$POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_REDIRECT_URI=$WEB_URL/callback
VITE_LOGOUT_URI=$WEB_URL
EOF

# Reconcile Cognito callback/logout URLs to the live CloudFront URL.
# Preserve whatever social identity providers actually exist on the pool
# (provider names are case-sensitive, e.g. "Google") plus COGNITO.
IDP_NAMES=$(aws cognito-idp list-identity-providers --user-pool-id "$POOL_ID" \
  --query "Providers[].ProviderName" --output text)
aws cognito-idp update-user-pool-client --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --callback-urls "$WEB_URL/callback" "http://localhost:5173/callback" \
  --logout-urls "$WEB_URL" "http://localhost:5173" \
  --allowed-o-auth-flows code --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --supported-identity-providers COGNITO $IDP_NAMES >/dev/null

pnpm --filter @carlog/web build
aws s3 sync apps/web/dist "s3://$BUCKET" --delete
# The service worker and manifest must never be edge-cached, or clients get stuck
# on a stale SW. Re-upload them with no-cache (hashed assets/* stay long-cached).
aws s3 cp apps/web/dist/sw.js "s3://$BUCKET/sw.js" \
  --cache-control "no-cache" --content-type "application/javascript"
aws s3 cp apps/web/dist/manifest.webmanifest "s3://$BUCKET/manifest.webmanifest" \
  --cache-control "no-cache" --content-type "application/manifest+json"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "Deployed web to $WEB_URL"
