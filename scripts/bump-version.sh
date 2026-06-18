#!/usr/bin/env bash
# Bump the version across all manifests and (optionally) tag the release.
# Usage: ./scripts/bump-version.sh 0.2.0
set -euo pipefail

VERSION="${1:?usage: bump-version.sh <semver>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "$VERSION" > "$ROOT/VERSION"

# package.json
node -e "const f='$ROOT/package.json';const p=require(f);p.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"

# tauri.conf.json
node -e "const f='$ROOT/src-tauri/tauri.conf.json';const p=require(f);p.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"

# Cargo.toml (first `version =` line, i.e. the one under [package]).
# Use perl for portability — BSD/macOS sed doesn't support the GNU `0,/re/` range.
V="$VERSION" perl -i -pe 'if (!$done && /^version = ".*"/) { s/^version = ".*"/version = "$ENV{V}"/; $done = 1 }' "$ROOT/src-tauri/Cargo.toml"

# Frontend APP_VERSION constant (shown in Settings, used for the update check).
sed -i.bak "s/export const APP_VERSION = \".*\"/export const APP_VERSION = \"$VERSION\"/" "$ROOT/src/lib/appInfo.ts"
rm -f "$ROOT/src/lib/appInfo.ts.bak"

# Regenerate changelog if git-cliff is available.
if command -v git-cliff >/dev/null 2>&1; then
  git-cliff --tag "v$VERSION" -o "$ROOT/CHANGELOG.md"
fi

echo "Bumped to $VERSION. Review changes, then:"
echo "  git commit -am \"chore(release): v$VERSION\" && git tag v$VERSION && git push --follow-tags"
