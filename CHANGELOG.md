# Changelog

All notable changes to TurboFiles are documented here.
This project adheres to [Semantic Versioning](https://semver.org) and [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]
### Branding & identity
- Renamed the app to **TurboFiles** (bundle id `io.xfusion.turbofiles`), authored by
  **Martin Onami** under the **xFusion** organization (xfusion.io). New logo (a
  document in a folder pocket, indigo gradient) applied to the desktop/taskbar icon,
  the in-app banner, the onboarding mockup, and the website favicon. All
  repository links point at `github.com/MartinOnami/TurboFiles`.

### Updates & version info
- **Update available**: the app checks GitHub for a newer release on launch (proxied
  through Rust so the CSP stays locked) and shows an "Update available" button in the
  top bar that opens the download page.
- **Settings → Changelog**: a new in-app changelog view (this file), and **Settings →
  About** now shows the current version with a "Check for updates" button and status.

### Packaging & distribution
- Hardened the cross-platform bundle config: real publisher/homepage/copyright and a
  bundled `LICENSE`, macOS `minimumSystemVersion` + hardened-runtime
  **entitlements** (`src-tauri/entitlements.plist`: network client/server + login
  keychain), a per-user Windows NSIS installer, and a Debian section. Fixed the
  placeholder repository URLs in `Cargo.toml`/`package.json`.
- New [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) explaining the OS-level prompts
  (keychain, macOS folder/TCC, network) — the app needs no custom permission wizard
  and stays usable if you decline (sites can be saved without a stored password).
- Self-hosting: `scripts/collect-bundles.sh` gathers every platform's installer with
  `SHA256SUMS.txt` + a `latest.json` manifest, and `docs/INSTALL.md` documents
  uploading them to your own server.

### Website
- New `website/` — a dependency-free landing page (hero, features, hi-fi HTML/CSS
  recreations of the dual-pane UI / Ask-TurboFiles chat / Site Manager modal, OS-aware
  download buttons driven by `latest.json`, dark-mode aware) you can drop on any
  static host.

### Features
- Connection: configurable minimum TLS version for FTPS (default 1.2).
- SFTP: optional zlib compression and SSH-agent authentication (`SSH_AUTH_SOCK`).
- FTP: keep-alive (periodic `NOOP`) and a global default transfer mode.
- Proxy: SOCKS4 support alongside SOCKS5 and HTTP CONNECT.
- Transfers: configurable illegal-filename-character filtering on download,
  SFTP space preallocation, and speed-limit burst tolerance.
- Transfers: concurrent transfers per session via a connection pool, with a
  global "max simultaneous transfers" setting and a per-site connection limit.
- Site Manager: per-site server time offset (applied to SFTP listing times),
  filename-charset preference, and "bypass proxy" for direct connections.
- Interface: date/time format, message-log position, on-startup behaviour,
  momentary transfer speed, prevent-system-sleep during transfers, and F5 force-refresh.
- File editing: open a remote file in an editor and auto re-upload on each save,
  with a configurable default editor and per-filetype editor associations.
- FTP: transfer type (Auto/ASCII/Binary) with extension-based classification in Auto mode.
- FTP: directory-listing parsers now auto-detect Unix, Windows/DOS (IIS), and OpenVMS formats.
- FTP: "USER user@host" legacy proxy support (plain FTP).
- Misc: log-to-file, directory-comparison size threshold, column-click sorting in
  file lists, a Debug info page, and a "Check for updates" link.
- i18n scaffolding: a language setting with a `t()` lookup and English/Spanish
  starter dictionaries (Settings UI localised; broader coverage is incremental).
- First-run onboarding: a polished three-step, split-screen flow (copy + dot
  pagination + Next/Done on the left; a gradient hero with a stylized TurboFiles app
  mockup on the right, with per-step accents for security and the assistant), plus
  a "Do not show this again" option and close. Cross-platform installers for
  macOS/Linux/Windows are documented in `docs/INSTALL.md`.

### Added
- **Ask TurboFiles** — an optional BYOK natural-language assistant. Add your own
  Anthropic or OpenAI-compatible API key (stored in the OS keychain; the call is
  proxied through Rust so the key never touches the web layer). It can navigate,
  read logs/listings/transfers automatically, and perform moves/deletes/renames
  after you approve each one. Tool calls work for both providers.
- Assistant model selection: pick a model with a "Load models" picker (fetches the
  provider's model list) and **run fully local** — with the API key optional for
  local/keyless servers.
- Assistant providers are now listed separately — Anthropic, OpenAI, DeepSeek,
  Moonshot (Kimi), Groq, OpenRouter, Ollama (local), LM Studio (local), and a
  Custom OpenAI-compatible option. Each keeps its own key in the keychain and
  prefills its base URL + default model.
- Assistant can **add a saved site from pasted credentials** (password optional —
  saved without a stored secret, you're asked at connect time), after you confirm.
- Assistant can **delete a saved site by name** (`delete_site`) after you confirm —
  it disconnects any live session for that site first and only removes the saved
  entry (never touches files on the server).
- Assistant can **connect to a saved site by name** (and list your sites), so you
  can say "connect to <site>" and then act on it in the same conversation.
- Assistant can **open/navigate the remote or local pane** to a folder ("open the
  wp-content folder") — it now actually moves the on-screen view, not just reads it.
- Assistant can **read remote files** and run a **WordPress security audit**
  (`wordpress_audit`): detects core/plugin/theme versions and flags exposed or
  over-permissive files (world-readable wp-config.php, debug.log, .env, backups),
  then reasons about known vulnerabilities (heuristic, not a CVE scanner).
- Assistant: **attach files in the chat** via the paperclip (they're staged as
  chips, not uploaded) — then tell the assistant where to put them and it uploads
  there after you confirm. `connect_site` is now idempotent so it no longer opens
  a duplicate tab for an already-connected site.
- Assistant model picker is now a real **dropdown**, auto-populated from the
  provider's model list (and re-fetched on demand) so you can't mistype an id.

### Changed
- "Open With…": right-click a file (local or remote) to choose which application
  opens it; the choice is remembered per file type and offered next time.
- Removed a dead `confirmOverwrite` setting and other unused fields flagged in review.

### Fixed
- Connecting a saved site with **no stored password** now prompts for it (with an
  optional "remember in keychain") and retries on auth failure, instead of just
  failing — for both clicking a site and the assistant's `connect_site`.
- The assistant's `connect_site` now reports the **actual** outcome/reason
  (auth failed, cancelled, cert/host-key) instead of "could not establish… check
  the logs" and then guessing from unrelated log lines.
- The assistant's `add_site` now saves the **default remote path** when provided.
- Clicking an **already-connected** site in the Site Manager now focuses its
  existing tab instead of opening a duplicate connection/tab (matches the
  assistant's behaviour).

### Assistant security & UX
- Modern chat composer: the attach (paperclip) and send buttons now sit inside the
  rounded input field, like contemporary chat apps; the input **auto-grows** with
  content up to ~3 lines (then scrolls).
- **Chain of thought**: the assistant's reasoning and tool steps are shown in one
  card per turn — steps stay collapsed by default (click to expand), with a tiny
  bold **Successful**/**Failed** status and the final reply folded underneath to
  keep it compact. Assistant text renders basic markdown (**bold**, `code`).
- Assistant can **disconnect** the current session (new `disconnect_site` tool).
- Fixed the connection bar overlapping (Host/Port labels) when the assistant panel
  is open — the bar now scrolls horizontally and labels no longer wrap.
- Hardened the assistant against prompt injection and misuse: the system prompt
  treats tool results / file contents / filenames as untrusted data (never
  instructions), forbids acting on embedded commands, and avoids echoing secrets;
  all writes remain confirmation-gated. Tool arguments are validated before
  execution (types, enums, control chars, lengths, port ranges), and the LLM proxy
  rejects non-http(s) endpoints.

### Security & fixes (post-audit)
- **Security:** reject path-traversal/absolute-path names in server directory
  listings during downloads — a malicious FTP/FTPS server can no longer write
  outside the chosen download directory (now enforced unconditionally, not just
  when the filename filter is on).
- **Security:** FTPS "minimum TLS 1.3" now fails with a clear error instead of
  silently negotiating TLS 1.2 (native-tls cannot enforce a 1.3 floor).
- **Fix:** connection-pool connections that are in flight when a session
  disconnects are now closed on release instead of leaking as zombie sessions;
  the pool stops minting once closed.
- **Fix:** FTP resume forces binary representation (ASCII + byte-offset resume
  could corrupt files).
- **Fix:** transfers run under `catch_unwind` so a protocol panic can't leak a
  pooled connection or wedge the session's queue.

## [0.1.0] - 2026-06-13
### Features
- Initial scaffold: Tauri 2 + React 18 + TypeScript + Rust backend.
- FileZilla-style dual-pane UI with dark and light themes.
- SFTP connect / list / upload / download (MVP).
- FTP and FTPS protocol adapters (initial implementation).
- Transfer queue with live progress events streamed from Rust.
- SQLite-backed Site Manager; secrets stored in the OS keychain.

### CI/CD
- GitHub Actions for lint, test, security audit, and multi-OS release bundling.
- Dockerised dev environment and docker-compose test servers.
