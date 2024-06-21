# TODO: Remove this once the proper updater and CI is implemented.
# Deploy an update to Mattrax.

set -e

shopt -s expand_aliases

export HASH=$(git rev-parse HEAD)
export CLOUDFLARE_ACCOUNT_ID="f02b3ef168fe64129e9941b4fb2e4dc1"

# cargo zigbuild --release --target aarch64-unknown-linux-musl -p mattrax

wrangler r2 object put "static/mattrax/$HASH/aarch64-unknown-linux" --file=target/aarch64-unknown-linux-musl/release/mattrax --cache-control "public, max-age=31536000, immutable"
echo "$HASH" | wrangler r2 object put "static/nightly" --pipe

curl -v "https://mdm.mattrax.app/internal/deploy?secret=$(cat .github/secret)"
