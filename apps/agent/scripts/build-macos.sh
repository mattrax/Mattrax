#!/bin/sh
# Build the Mattrax macOS agent and (when signing credentials are present)
# sign and notarize the installer.
#
# Artifact: apps/agent/build/MattraxAgent-<version>.pkg
#
# Required for a signed, installable package:
#   DEVELOPER_ID_APPLICATION  "Developer ID Application: ..."
#   DEVELOPER_ID_INSTALLER    "Developer ID Installer: ..."
#   NOTARY_PROFILE            notarytool keychain profile
#
# Without them the script still produces an unsigned pkg for local testing;
# Gatekeeper will refuse to install it on another Mac.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${MATTRAX_AGENT_VERSION:-1.0.0}"
BUILD="$ROOT/build"
STAGE="$BUILD/stage"
PAYLOAD="$STAGE/root"
SCRIPTS="$STAGE/scripts"

rm -rf "$STAGE" "$BUILD/MattraxAgent-$VERSION.pkg"
mkdir -p "$PAYLOAD/usr/local/libexec" "$PAYLOAD/Library/LaunchDaemons" "$SCRIPTS"

echo "Building mattrax-agent $VERSION"
swiftc -O -whole-module-optimization \
  -o "$BUILD/mattrax-agent" \
  "$ROOT/macos/Sources/MattraxAgent/main.swift"

if [ -n "${DEVELOPER_ID_APPLICATION:-}" ]; then
  echo "Signing the agent binary"
  codesign --force --options runtime --timestamp \
    --sign "$DEVELOPER_ID_APPLICATION" "$BUILD/mattrax-agent"
fi

install -m 0755 "$BUILD/mattrax-agent" "$PAYLOAD/usr/local/libexec/mattrax-agent"
install -m 0644 "$ROOT/macos/Resources/com.mattrax.agent.plist" \
  "$PAYLOAD/Library/LaunchDaemons/com.mattrax.agent.plist"

cat > "$SCRIPTS/postinstall" <<'POSTINSTALL'
#!/bin/sh
set -eu
mkdir -p /var/lib/mattrax
touch /var/log/mattrax-agent.log
chmod 0600 /var/log/mattrax-agent.log
/bin/launchctl bootout system /Library/LaunchDaemons/com.mattrax.agent.plist 2>/dev/null || true
/bin/launchctl bootstrap system /Library/LaunchDaemons/com.mattrax.agent.plist
/bin/launchctl enable system/com.mattrax.agent
exit 0
POSTINSTALL
chmod 0755 "$SCRIPTS/postinstall"

pkgbuild --root "$PAYLOAD" --scripts "$SCRIPTS" \
  --identifier com.mattrax.agent --version "$VERSION" \
  --install-location / "$BUILD/MattraxAgent-$VERSION.pkg"

if [ -n "${DEVELOPER_ID_INSTALLER:-}" ]; then
  echo "Signing the installer"
  SIGNED="$BUILD/MattraxAgent-$VERSION-signed.pkg"
  productsign --sign "$DEVELOPER_ID_INSTALLER" \
    "$BUILD/MattraxAgent-$VERSION.pkg" "$SIGNED"
  mv "$SIGNED" "$BUILD/MattraxAgent-$VERSION.pkg"

  if [ -n "${NOTARY_PROFILE:-}" ]; then
    echo "Submitting for notarization"
    xcrun notarytool submit "$BUILD/MattraxAgent-$VERSION.pkg" \
      --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$BUILD/MattraxAgent-$VERSION.pkg"
  fi
fi

echo "Built $BUILD/MattraxAgent-$VERSION.pkg"
