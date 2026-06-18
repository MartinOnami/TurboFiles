/**
 * The TurboFiles logo mark: a document with a folded corner sitting in a folder
 * pocket, in the brand indigo -> lavender gradient. Rendered inline so it works
 * under the app's strict CSP (no external image fetch). Keep this in sync with
 * website/assets/logo.svg and src-tauri/icons (regenerate icons with
 * `npm run tauri -- icon website/assets/logo.svg`).
 */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="tfDoc" x1="22" y1="8" x2="44" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5360ec" />
          <stop offset="1" stopColor="#4049d8" />
        </linearGradient>
        <linearGradient id="tfPocket" x1="32" y1="22" x2="32" y2="47" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5b67ea" />
          <stop offset="1" stopColor="#e9ebfb" />
        </linearGradient>
      </defs>
      <path d="M23 8H37L45 16V31a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3Z" fill="url(#tfDoc)" />
      <path d="M37 8L45 16H37Z" fill="#c3c8f6" />
      <path d="M15 23H49a3 3 0 0 1 3 3v14a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5V26a3 3 0 0 1 3-3Z" fill="url(#tfPocket)" />
    </svg>
  );
}
