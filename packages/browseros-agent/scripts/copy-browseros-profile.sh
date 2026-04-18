#!/usr/bin/env bash
#
# Copy a BrowserOS profile into a seed directory suitable for passing
# as --user-data-dir to a child Chromium instance (e.g. the VL collector).
#
# Usage:
#   .scripts/copy-browseros-profile.sh <profile-name> <dest-dir>
#
# Example:
#   .scripts/copy-browseros-profile.sh Work /tmp/vl-seed-profile
#
# Result: <dest-dir>/Default/<profile files>  plus a stub Local State.
#
# Requires: jq, macOS (uses APFS clone via `cp -c`).

set -euo pipefail

PROFILE_NAME="${1:-}"
DEST_DIR="${2:-}"

if [[ -z "$PROFILE_NAME" || -z "$DEST_DIR" ]]; then
  echo "usage: $0 <profile-name> <dest-dir>" >&2
  exit 1
fi

SRC_ROOT="$HOME/Library/Application Support/BrowserOS"
LOCAL_STATE="$SRC_ROOT/Local State"

if [[ ! -f "$LOCAL_STATE" ]]; then
  echo "error: BrowserOS Local State not found at: $LOCAL_STATE" >&2
  exit 1
fi

if pgrep -qf "BrowserOS.app/Contents/MacOS/BrowserOS"; then
  echo "error: BrowserOS is running. Quit it first so the profile SQLite files aren't mid-write." >&2
  exit 1
fi

PROFILE_FOLDER=$(
  jq -r --arg name "$PROFILE_NAME" \
    '.profile.info_cache | to_entries[] | select(.value.name == $name) | .key' \
    "$LOCAL_STATE"
)

if [[ -z "$PROFILE_FOLDER" ]]; then
  echo "error: no profile named '$PROFILE_NAME' found. Available profiles:" >&2
  jq -r '.profile.info_cache | to_entries | map("  \(.key)\t\(.value.name)") | .[]' \
    "$LOCAL_STATE" >&2
  exit 1
fi

SRC_PROFILE="$SRC_ROOT/$PROFILE_FOLDER"
if [[ ! -d "$SRC_PROFILE" ]]; then
  echo "error: profile directory missing on disk: $SRC_PROFILE" >&2
  exit 1
fi

echo "source: $SRC_PROFILE  (name: $PROFILE_NAME)"
echo "dest:   $DEST_DIR/Default"

if [[ -e "$DEST_DIR" ]]; then
  echo "error: $DEST_DIR already exists. Remove it or pick a new path." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

# APFS clone is O(1) and uses no extra disk space until files diverge.
cp -c -R "$SRC_PROFILE" "$DEST_DIR/Default"

# Strip singleton locks from the source instance.
rm -f \
  "$DEST_DIR/Default/SingletonLock" \
  "$DEST_DIR/Default/SingletonSocket" \
  "$DEST_DIR/Default/SingletonCookie"

# Minimal Local State so Chrome doesn't complain on first launch.
echo '{}' > "$DEST_DIR/Local State"

BYTES=$(du -sh "$DEST_DIR" | awk '{print $1}')
echo "done: $BYTES at $DEST_DIR"
echo
echo "next:"
echo "  launch Chromium with --user-data-dir=$DEST_DIR"
echo "  (and drop --use-mock-keychain so encrypted cookies decrypt)"
