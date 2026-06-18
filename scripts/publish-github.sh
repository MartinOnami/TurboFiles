#!/usr/bin/env bash
#
# One-command publisher for TurboFiles.
#
#   bash scripts/publish-github.sh
#
# It logs you into GitHub (browser, once), then does EVERYTHING else for you:
#   1. creates  github.com/MartinOnami/TurboFiles  (public) and pushes `main`
#   2. enables GitHub Pages (GitHub Actions source) so the website deploys
#   3. tags v0.1.0 to kick off the cross-platform installer builds (release.yml)
#
# Re-runnable: each step is skipped if it's already done.
set -euo pipefail

REPO="MartinOnami/TurboFiles"
DESC="A fast, modern desktop SFTP/FTP/FTPS client (Tauri + React + Rust)."
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

command -v gh >/dev/null || { echo "GitHub CLI (gh) not found. Install: brew install gh"; exit 1; }

# 1. Authenticate (browser). Needs repo + workflow scopes to push the CI files.
if ! gh auth status >/dev/null 2>&1; then
  say "Logging you into GitHub (a browser window / one-time code will appear)…"
  gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
else
  echo "✓ Already authenticated with GitHub."
fi
gh auth setup-git >/dev/null 2>&1 || true

# 2. Create the repo + push main (skip if it already exists).
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "✓ Repo $REPO already exists."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
  say "Pushing main…"
  git push -u origin main
else
  say "Creating $REPO and pushing main…"
  gh repo create "$REPO" --public --source=. --remote=origin --push --description "$DESC"
fi

# 3. Enable GitHub Pages with the GitHub Actions builder (deploys website/).
say "Enabling GitHub Pages (Actions source)…"
if gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$REPO/pages" -f "build_type=workflow" >/dev/null 2>&1 || true
  echo "✓ Pages already enabled."
else
  gh api -X POST "repos/$REPO/pages" -f "build_type=workflow" >/dev/null 2>&1 \
    && echo "✓ Pages enabled." \
    || echo "! Could not auto-enable Pages - set Settings → Pages → Source = GitHub Actions manually."
fi

# 4. Tag v0.1.0 → triggers release.yml to build macOS/Windows/Linux installers.
if git rev-parse "v0.1.0" >/dev/null 2>&1 || gh release view "v0.1.0" --repo "$REPO" >/dev/null 2>&1; then
  echo "✓ v0.1.0 already tagged/released."
else
  say "Tagging v0.1.0 to build installers…"
  git tag v0.1.0
  git push origin v0.1.0
fi

OWNER="${REPO%%/*}"; NAME="${REPO##*/}"
OWNER_LC="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')"
printf '\n\033[1;32m✓ Done.\033[0m TurboFiles is published.\n'
cat <<EOF

Watch it come together here:

  Repository   https://github.com/$REPO
  Actions      https://github.com/$REPO/actions     (Pages deploy + installer builds)
  Website      https://$OWNER_LC.github.io/$NAME/   (live ~1 min after the Pages job)
  Releases     https://github.com/$REPO/releases    (a DRAFT appears - open it and click Publish)

The installer builds take a few minutes. Once you Publish the draft release, the
website's Download buttons and the app's "Update available" check light up
automatically - no further edits needed.
EOF
