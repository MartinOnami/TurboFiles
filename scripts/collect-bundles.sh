#!/usr/bin/env bash
#
# collect-bundles.sh — gather the installers Tauri just built into one upload-ready
# folder, with SHA-256 checksums and a latest.json manifest, for self-hosting on
# your own website. Run it after `npm run tauri:build` (per OS, or over downloaded
# CI artifacts). Safe to run on macOS, Linux, or Windows (Git Bash).
#
# Usage:
#   scripts/collect-bundles.sh [BUNDLE_DIR] [OUT_DIR]
#     BUNDLE_DIR  default: src-tauri/target/release/bundle
#     OUT_DIR     default: release-uploads
#
set -euo pipefail

BUNDLE_DIR="${1:-src-tauri/target/release/bundle}"
OUT_ROOT="${2:-release-uploads}"

# Read the version from tauri.conf.json without needing jq.
VERSION="$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/')"
if [ -z "${VERSION}" ]; then
  echo "error: could not read version from src-tauri/tauri.conf.json" >&2
  exit 1
fi

OUT_DIR="${OUT_ROOT}/${VERSION}"
mkdir -p "${OUT_DIR}"

if [ ! -d "${BUNDLE_DIR}" ]; then
  echo "error: bundle dir not found: ${BUNDLE_DIR} (run 'npm run tauri:build' first)" >&2
  exit 1
fi

echo "→ collecting installers for v${VERSION} from ${BUNDLE_DIR}"

# Copy every installer artifact (ignore intermediate .app/ dirs — we ship the dmg).
found=0
while IFS= read -r -d '' f; do
  cp -f "${f}" "${OUT_DIR}/"
  echo "  + $(basename "${f}")"
  found=$((found + 1))
done < <(find "${BUNDLE_DIR}" -type f \
  \( -name '*.dmg' -o -name '*.app.tar.gz' \
     -o -name '*-setup.exe' -o -name '*.msi' \
     -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) -print0)

if [ "${found}" -eq 0 ]; then
  echo "error: no installers found under ${BUNDLE_DIR}" >&2
  exit 1
fi

# Checksums (prefer shasum, fall back to sha256sum).
echo "→ writing SHA256SUMS.txt"
(
  cd "${OUT_DIR}"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 ./* > SHA256SUMS.txt 2>/dev/null || true
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./* > SHA256SUMS.txt 2>/dev/null || true
  fi
  # Don't checksum the checksum file itself.
  grep -v 'SHA256SUMS.txt' SHA256SUMS.txt > .tmp && mv .tmp SHA256SUMS.txt || true
)

# A tiny manifest the landing page can fetch to wire up download buttons.
echo "→ writing latest.json"
mac="$(cd "${OUT_DIR}" && ls *.dmg 2>/dev/null | head -1 || true)"
win="$(cd "${OUT_DIR}" && ls *-setup.exe 2>/dev/null | head -1 || ls *.msi 2>/dev/null | head -1 || true)"
lin="$(cd "${OUT_DIR}" && ls *.AppImage 2>/dev/null | head -1 || true)"
deb="$(cd "${OUT_DIR}" && ls *.deb 2>/dev/null | head -1 || true)"
rpm="$(cd "${OUT_DIR}" && ls *.rpm 2>/dev/null | head -1 || true)"

cat > "${OUT_DIR}/latest.json" <<JSON
{
  "version": "${VERSION}",
  "files": {
    "macos": "${mac}",
    "windows": "${win}",
    "linux_appimage": "${lin}",
    "linux_deb": "${deb}",
    "linux_rpm": "${rpm}"
  }
}
JSON

echo
echo "✓ ready to upload: ${OUT_DIR}"
echo "  upload e.g.:  rsync -avz ${OUT_DIR}/ user@server:/var/www/turbofiles/download/${VERSION}/"
