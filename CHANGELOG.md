# Changelog

All notable changes to TurboFiles are documented here.
This project adheres to [Semantic Versioning](https://semver.org) and [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]
### Changed
- Transfer queue / Logs: the bottom panels now show only currently-connected
  sessions and clear when a session disconnects. The full history stays in the
  Logs and Transfer-queue top tabs (opened from the sidebar).
### Added
- File editing: when a file you opened from the remote is saved, TurboFiles now
  asks to confirm uploading the new version back to the server (like FileZilla),
  then queues the upload (with progress and retry) instead of uploading silently.
  A new "Confirm before uploading edits" toggle in Settings -> File editing
  controls it (on by default; turn off for silent auto-upload).
- Assistant: a redesigned welcome screen, plus chat history - start a new chat
  and revisit past conversations from the panel header (kept on this device).
- Assistant: opening a remote folder now matches names case- and separator-
  insensitively, so "Support Custom" opens "support-custom" on the first try.
### Fixed
- File editing: re-uploaded edits now appear in the transfer queue with their
  correct name and remote path (the queued transfer was not registered, so it
  showed as a blank row).
- File editing: edits are detected by content, not just modification time, so
  opening or closing a file without changing it no longer triggers an upload.
  Each opened file also uses a unique temp file (per remote path) and a single
  watcher, so re-opening a file, or editing two files that share a name, no
  longer causes repeated prompts or uploads to the wrong remote path / filename.
- Assistant: `connect_site` no longer fails with "site not found" right after the
  assistant creates a site with `add_site`. The connect handler now reads the
  live site list instead of a stale render snapshot.

## [0.1.5] - 2026-06-20
### Changed
- Updater: after an update is downloaded and installed, TurboFiles now asks
  whether to "Restart now" or do it "Later" instead of relaunching on its own.
  If you choose Later, the update applies the next time you restart.

## [0.1.4] - 2026-06-20
### Fixed
- Site Manager: the top-bar "+" -> "New connection..." action now opens the
  new-site editor instead of just clearing the active tab.
### Changed
- Site Manager: the FileZilla import button now uses a cloud-upload icon.

## [0.1.3] - 2026-06-18
### Changed
- Settings → Changelog is now a collapsible accordion (the current release is
  expanded) so the history is easy to scan without clutter.
### Fixed
- Simplified the macOS `.dmg` installer window (removed the custom background).

## [0.1.2] - 2026-06-18
### Added
- Update in-app: the "Update available" button and Settings → About now download,
  install, and relaunch the new version from inside the app (cryptographically
  signed updates) instead of opening the browser.

## [0.1.1] - 2026-06-18
### Added
- Ask TurboFiles: optional BYOK assistant (Anthropic / OpenAI-compatible; key in the
  OS keychain, proxied through Rust). Navigates panes, reads logs/listings/transfers,
  and performs moves/deletes/renames/uploads after per-action approval.
- Assistant providers: Anthropic, OpenAI, DeepSeek, Moonshot, Groq, OpenRouter,
  Ollama, LM Studio, and custom OpenAI-compatible - with a model dropdown
  auto-populated from each provider (local/keyless servers supported).
- Assistant site actions: add, delete, connect, disconnect, and list saved sites by
  name; attach files in chat; and run a heuristic WordPress security audit.
- In-app update check: an "Update available" button when a newer GitHub release
  exists, plus Settings → About ("Check for updates") and Settings → Changelog.
- FTPS configurable minimum TLS version; SFTP zlib compression and SSH-agent auth.
- FTP keep-alive, transfer type (Auto/ASCII/Binary), and listing parsers that
  auto-detect Unix, Windows/DOS (IIS), and OpenVMS formats.
- Concurrent transfers per session with a global max and per-site limit, SFTP space
  preallocation, illegal-filename filtering, and speed-limit burst tolerance.
- Site Manager: per-site server time offset, filename-charset preference, bypass-proxy.
- Open a remote file in an external editor and auto re-upload on each save.
- Proxy: SOCKS4 alongside SOCKS5/HTTP CONNECT, plus legacy "USER user@host" FTP proxy.
- Interface: date/time format, message-log position, startup behaviour,
  prevent-system-sleep during transfers, column-click sorting, and F5 force-refresh.
- i18n scaffolding (English/Spanish) and a three-step first-run onboarding flow.

### Changed
- "Open With…": choose the app per file type; the choice is remembered.

### Fixed
- Saved sites with no stored password now prompt (optionally remembering in the
  keychain) and retry on auth failure instead of failing outright.
- connect_site reports the real outcome (auth/cert/host-key/cancelled).
- Clicking an already-connected site focuses its tab instead of duplicating it.

### Security
- Reject path-traversal / absolute-path names in server listings during downloads.
- FTPS "minimum TLS 1.3" fails with a clear error instead of silently using 1.2.
- Transfers run under `catch_unwind`; pooled connections close on disconnect.
- Assistant hardened against prompt injection: untrusted tool/file data, validated
  tool arguments, confirmation-gated writes, and an http(s)-only LLM proxy.

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
