#!/usr/bin/env bash
# Builds and deploys CarLog: API bundle → Terraform → web app → S3 + CloudFront.
#   scripts/deploy.sh          everything
#   scripts/deploy.sh web      only the web app (infra unchanged)
set -euo pipefail
export AWS_PROFILE=yevhenii
cd "$(dirname "$0")/.."
TF="terraform -chdir=infra/main"

if [ "${1:-all}" != "web" ]; then
  pnpm --filter @carlog/api bundle
  $TF apply
fi

out() { $TF output -raw "$1"; }
WEB_URL=$(out web_url)
cat > apps/web/.env.production <<ENV
VITE_API_URL=$(out api_url)
VITE_COGNITO_AUTHORITY=$(out issuer)
VITE_COGNITO_CLIENT_ID=$(out client_id)
VITE_COGNITO_DOMAIN=https://auth.onlytools.click
VITE_REDIRECT_URI=$WEB_URL/callback
VITE_LOGOUT_URI=$WEB_URL/
VITE_VAPID_PUBLIC_KEY=$(out vapid_public_key)
ENV

pnpm --filter @carlog/web build
BUCKET=$(out web_bucket)
DIST=apps/web/dist
aws s3 sync "$DIST" "s3://$BUCKET" --delete
# HTML, the service worker and the manifest must never be cached, or clients get stuck on a
# stale shell. Hashed assets/* stay long-cached.
aws s3 cp "$DIST" "s3://$BUCKET" --recursive --exclude "*" --include "*.html" --cache-control "no-cache"
aws s3 cp "$DIST/sw.js" "s3://$BUCKET/sw.js" --cache-control "no-cache" --content-type "application/javascript"
aws s3 cp "$DIST/manifest.webmanifest" "s3://$BUCKET/manifest.webmanifest" --cache-control "no-cache" --content-type "application/manifest+json"
aws cloudfront create-invalidation --distribution-id "$(out distribution_id)" --paths "/*" >/dev/null
echo "Deployed to $WEB_URL"
