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
VAPID_PUB=$(out VapidPublicKey)

cat > apps/web/.env.production <<EOF
VITE_API_URL=$API_URL
VITE_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/$POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_REDIRECT_URI=$WEB_URL/callback
VITE_LOGOUT_URI=$WEB_URL
VITE_VAPID_PUBLIC_KEY=$VAPID_PUB
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

pnpm --filter @carlog/site build
pnpm --filter @carlog/web build

# The site owns index.html, uk/, privacy/, terms/, og-*.png, robots.txt, sitemap-*.xml;
# the app owns app.html, assets/, sw.js, registerSW.js, manifest.webmanifest, icons/.
# Refuse to deploy if a path exists in both — the later copy would silently win.
DUP=$(comm -12 <(cd apps/site/dist && find . -type f | sort) <(cd apps/web/dist && find . -type f | sort))
if [ -n "$DUP" ]; then echo "Path collision between site and web builds:"; echo "$DUP"; exit 1; fi

STAGE=$(mktemp -d)
cp -R apps/site/dist/. "$STAGE"
cp -R apps/web/dist/. "$STAGE"
aws s3 sync "$STAGE" "s3://$BUCKET" --delete
# HTML, the service worker and the manifest must never be edge- or browser-cached, or
# clients get stuck on a stale shell / SW. Hashed assets/* and _astro/* stay long-cached.
# Re-upload HTML with no-cache; SW and manifest need explicit content types that the CLI can't guess.
aws s3 cp "$STAGE" "s3://$BUCKET" --recursive --exclude "*" --include "*.html" --cache-control "no-cache"
aws s3 cp "$STAGE/sw.js" "s3://$BUCKET/sw.js" --cache-control "no-cache" --content-type "application/javascript"
aws s3 cp "$STAGE/manifest.webmanifest" "s3://$BUCKET/manifest.webmanifest" --cache-control "no-cache" --content-type "application/manifest+json"
rm -rf "$STAGE"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "Deployed site + web to $WEB_URL"
