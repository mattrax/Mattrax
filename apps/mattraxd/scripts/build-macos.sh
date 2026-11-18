#!/bin/sh
# Build the Mattrax macOS agent and (when signing credentials are present)
# sign and notarize the installer.
#
# Artifact: apps/mattraxd/build/mattraxd-<version>.pkg
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
VERSION="${MATTRAX_MATTRAXD_VERSION:-1.0.0}"
BUILD="$ROOT/build"
STAGE="$BUILD/stage"
PAYLOAD="$STAGE/root"
SCRIPTS="$STAGE/scripts"

rm -rf "$STAGE" "$BUILD/mattraxd-$VERSION.pkg"
mkdir -p "$PAYLOAD/usr/local/libexec" "$PAYLOAD/Library/LaunchDaemons" "$SCRIPTS"

echo "Building mattraxd $VERSION"
swiftc -O -whole-module-optimization \
  -o "$BUILD/mattraxd" \
  "$ROOT/macos/Sources/mattraxd/main.swift"

if [ -n "${DEVELOPER_ID_APPLICATION:-}" ]; then
  echo "Signing the agent binary"
  codesign --force --options runtime --timestamp \
    --sign "$DEVELOPER_ID_APPLICATION" "$BUILD/mattraxd"
fi

install -m 0755 "$BUILD/mattraxd" "$PAYLOAD/usr/local/libexec/mattraxd"
install -m 0644 "$ROOT/macos/Resources/com.mattrax.mattraxd.plist" \
  "$PAYLOAD/Library/LaunchDaemons/com.mattrax.mattraxd.plist"

cat > "$SCRIPTS/postinstall" <<'POSTINSTALL'
#!/bin/sh
set -eu
mkdir -p /var/lib/mattrax
touch /var/log/mattraxd.log
chmod 0600 /var/log/mattraxd.log
/bin/launchctl bootout system /Library/LaunchDaemons/com.mattrax.mattraxd.plist 2>/dev/null || true
/bin/launchctl bootstrap system /Library/LaunchDaemons/com.mattrax.mattraxd.plist
/bin/launchctl enable system/com.mattrax.mattraxd
exit 0
POSTINSTALL
chmod 0755 "$SCRIPTS/postinstall"

pkgbuild --root "$PAYLOAD" --scripts "$SCRIPTS" \
  --identifier com.mattrax.mattraxd --version "$VERSION" \
  --install-location / "$BUILD/mattraxd-$VERSION.pkg"

if [ -n "${DEVELOPER_ID_INSTALLER:-}" ]; then
  echo "Signing the installer"
  SIGNED="$BUILD/mattraxd-$VERSION-signed.pkg"
  productsign --sign "$DEVELOPER_ID_INSTALLER" \
    "$BUILD/mattraxd-$VERSION.pkg" "$SIGNED"
  mv "$SIGNED" "$BUILD/mattraxd-$VERSION.pkg"

  if [ -n "${NOTARY_PROFILE:-}" ]; then
    echo "Submitting for notarization"
    xcrun notarytool submit "$BUILD/mattraxd-$VERSION.pkg" \
      --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$BUILD/mattraxd-$VERSION.pkg"
  fi
fi

echo "Built $BUILD/mattraxd-$VERSION.pkg"
