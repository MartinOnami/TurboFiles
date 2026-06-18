// Single source of truth for app identity in the frontend.
// APP_VERSION is kept in sync with package.json / tauri.conf.json by
// scripts/bump-version.sh.
export const APP_VERSION = "0.1.2";

/** GitHub "owner/name" used for update checks and release links. */
export const GITHUB_REPO = "MartinOnami/TurboFiles";
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;

/**
 * Compare two dotted numeric versions. Returns true if `latest` is strictly
 * newer than `current` (e.g. isNewerVersion("0.2.0", "0.1.3") === true).
 * Non-numeric/pre-release suffixes are ignored for the comparison.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((n) => parseInt(n, 10))
      .filter((n) => !Number.isNaN(n));
  const a = parse(latest);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
