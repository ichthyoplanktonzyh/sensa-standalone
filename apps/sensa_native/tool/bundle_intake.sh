#!/bin/sh
set -eu

# Build the bounded CLI as a separate, independently launchable browser/Agent tool.
# The Flutter app copies it after explicit folder selection; it never spawns it.
SENSA_REPO_ROOT=$(cd "$PROJECT_DIR/../../.." && pwd)
SENSA_CARGO_BIN=${CARGO_HOME:-$HOME/.cargo}/bin/cargo
SENSA_HELPER_PROFILE=debug
SENSA_RELEASE_FLAG=
if [ "$CONFIGURATION" = Release ]; then
  SENSA_HELPER_PROFILE=release
  SENSA_RELEASE_FLAG=--release
fi
for SENSA_ARCH in $ARCHS; do
  case "$SENSA_ARCH" in
    arm64) SENSA_RUST_TARGET=aarch64-apple-darwin ;;
    x86_64) SENSA_RUST_TARGET=x86_64-apple-darwin ;;
    *) echo "Unsupported intake helper architecture: $SENSA_ARCH" >&2; exit 1 ;;
  esac
  "$SENSA_CARGO_BIN" build --target-dir "$SENSA_REPO_ROOT/target" --manifest-path "$SENSA_REPO_ROOT/Cargo.toml" --locked \
    -p sensa-library --bin sensa-intake --target "$SENSA_RUST_TARGET" $SENSA_RELEASE_FLAG
done
SENSA_HELPER_DEST="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH/MacOS/sensa-intake"
mkdir -p "$(dirname "$SENSA_HELPER_DEST")"
# Xcode's architecture names are fixed values; use positional arguments to keep paths quoted.
set --
for SENSA_ARCH in $ARCHS; do
  case "$SENSA_ARCH" in
    arm64) SENSA_RUST_TARGET=aarch64-apple-darwin ;;
    x86_64) SENSA_RUST_TARGET=x86_64-apple-darwin ;;
  esac
  set -- "$@" "$SENSA_REPO_ROOT/target/$SENSA_RUST_TARGET/$SENSA_HELPER_PROFILE/sensa-intake"
done
/usr/bin/lipo -create "$@" -output "$SENSA_HELPER_DEST"
/bin/chmod 755 "$SENSA_HELPER_DEST"
/usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY:--}" "$SENSA_HELPER_DEST"
