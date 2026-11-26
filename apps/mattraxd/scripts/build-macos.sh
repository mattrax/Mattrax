#!/bin/sh
# Build the Mattrax macOS agent from the Rust sources and (when signing
# credentials are present) sign and notarize the installer.
#
# Artifact: apps/mattraxd/build/mattraxd-<version>.pkg
#
# Required for a signed, installable package:
#   DEVELOPER_ID_APPLICATION  "Developer ID Application: ..."
#   DEVELOPER_ID_INSTALLER    "Developer ID Installer: ..."
#   NOTARY_PROFILE            notarytool keychain profile
#
# Optional:
#   MATTRAX_MATTRAXD_VERSION  override the embedded version (default: Cargo.toml)
#   MATTRAX_MATTRAXD_TARGETS  space-separated rust targets to build, for example
#                             "aarch64-apple-darwin x86_64-apple-darwin". More
#                             than one is lipo'd into a universal binary.
#
# Without credentials the script still produces an unsigned pkg for local
# testing; Gatekeeper will refuse to install it on another Mac.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${MATTRAX_MATTRAXD_VERSION:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n 1)"
fi
# pkgbuild requires a CFBundleVersion-shaped version; a nightly's
# "1.1.0-nightly.20261120" is packaged as "1.1.0" while the binary keeps the
# full version for the updater.
PKG_VERSION="$(printf '%s' "$VERSION" | sed 's/[^0-9.].*$//')"

# Do not embed resource-fork AppleDouble files in the package payload.
export COPYFILE_DISABLE=1

BUILD="$ROOT/build"
STAGE="$BUILD/stage"
PAYLOAD="$STAGE/root"
SCRIPTS="$STAGE/scripts"

rm -rf "$STAGE" "$BUILD/mattraxd-$VERSION.pkg" "$BUILD/mattraxd"
mkdir -p "$PAYLOAD/usr/local/libexec" "$PAYLOAD/Library/LaunchDaemons" "$SCRIPTS"

echo "Building mattraxd $VERSION"
export MATTRAXD_VERSION="$VERSION"

if [ -n "${MATTRAX_MATTRAXD_TARGETS:-}" ]; then
  for target in $MATTRAX_MATTRAXD_TARGETS; do
    echo "  cargo build --release --target $target"
    cargo build --release --locked --target "$target"
    set -- "$@" "$ROOT/target/$target/release/mattraxd"
  done

  if [ "$#" -gt 1 ]; then
    echo "Creating a universal binary"
    lipo -create -output "$BUILD/mattraxd" "$@"
    lipo -archs "$BUILD/mattraxd"
  else
    cp "$1" "$BUILD/mattraxd"
  fi
else
  cargo build --release --locked
  cp "$ROOT/target/release/mattraxd" "$BUILD/mattraxd"
fi

chmod 0755 "$BUILD/mattraxd"

if [ -n "${DEVELOPER_ID_APPLICATION:-}" ]; then
  echo "Signing the agent binary"
  codesign --force --options runtime --timestamp \
    --sign "$DEVELOPER_ID_APPLICATION" "$BUILD/mattraxd"
fi

install -m 0755 "$BUILD/mattraxd" "$PAYLOAD/usr/local/libexec/mattraxd"
install -m 0644 "$ROOT/macos/Resources/com.mattrax.mattraxd.plist" \
  "$PAYLOAD/Library/LaunchDaemons/com.mattrax.mattraxd.plist"

# Best effort: strip quarantine/finder metadata before packaging. macOS can
# still record com.apple.provenance in AppleDouble entries; that is expected.
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$PAYLOAD" 2>/dev/null || true
fi

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
  --identifier com.mattrax.mattraxd --version "$PKG_VERSION" \
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
echo "Bare binary for the updater: $BUILD/mattraxd"
