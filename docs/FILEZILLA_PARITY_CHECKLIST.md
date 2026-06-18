# FileZilla Parity Checklist

The working checklist toward full FileZilla feature parity (modern UI, secure
architecture). Worked one item at a time; check off as each lands with tests.
Legend: `[x]` done · `[~]` partial · `[ ]` todo.

## Connection & protocols
- [x] SFTP — password auth
- [x] SFTP — private-key auth with native file picker
- [x] FTP — plain
- [x] FTPS — explicit ("if available" + "require")
- [x] FTPS — implicit (port 990)
- [x] Certificate trust dialog (accept / remember per site)
- [x] Connection timeout (configurable)
- [x] Reconnection: max retries + delay between attempts
- [x] Minimum allowed TLS version (FTPS floor 1.0–1.2; 1.3 rejected with a clear
  error since native-tls cannot enforce a 1.3 floor)
- [ ] Use system trust store toggle
- [x] FTP transfer mode: Active (per site)
- [x] FTP transfer mode: Passive (per site)
- [ ] FTP active-mode IP + local port range — blocked: `suppaftp` binds `0.0.0.0:0`
  with no hook to override the advertised IP or restrict the local port range
- [x] FTP keep-alive (periodic NOOP on idle control connection)
- [x] FTP transfer mode: global default (applied when site uses "Default")
- [x] Generic proxy — SOCKS4 + SOCKS5 + HTTP CONNECT (global, with auth)
- [x] SFTP host-key verification (trust-on-first-use + mismatch block) — **security**
- [~] FTP proxy — "USER user@host" style implemented (plain FTP); SITE/OPEN/custom
  variants not supported (`suppaftp` login can't inject pre-login proxy commands)
- [x] Per-site "bypass proxy"
- [x] SFTP agent support (SSH_AUTH_SOCK) — tried before password/key when enabled
- [ ] SFTP multiple keys (global key list)
- [x] SFTP compression (zlib, opt-in)

## Site Manager — Advanced tab
- [x] Default local directory (per site) — auto-opens on connect
- [x] Default remote directory (per site) — auto-opens on connect (falls back to cwd)
- [~] Server type listing parsers — Unix, Windows/DOS (IIS), and OpenVMS auto-detected;
  MVS and rarer mainframe formats not yet covered
- [x] Synchronized browsing
- [x] Directory comparison
- [x] Adjust server time offset (per site; applied to SFTP listing times)

## Transfers
- [x] Recursive folder upload/download
- [x] Per-session FIFO queue + scheduler
- [x] Pause / resume
- [x] Mid-stream cancel
- [x] File-exists action dialog (overwrite / rename / keep both / skip)
- [x] Durable transfer history
- [x] Resume interrupted transfers (offset restart) — Resume button in conflict dialog
- [x] Default file-exists action setting (per upload/download: ask/overwrite/resume/rename/skip)
- [x] Concurrent transfers config (per-session connection pool)
- [x] Speed limits (download / upload KiB/s) + burst tolerance
- [x] Per-site connection limit (caps the global default)
- [x] Preallocate space before download (SFTP; known size)
- [x] Invalid-character filtering in filenames (configurable + replacement char);
  path-traversal/absolute names always rejected on download — **security**
- [x] FTP transfer type (Auto/ASCII/Binary) + filetype classification (resume forces binary)

## Interface
- [x] Dark / light theme
- [x] Show hidden files
- [x] Bookmarks
- [x] Multi-session tabs + per-tab menu
- [x] Drag & drop between panes
- [x] Reveal in Finder (local)
- [x] Drag & drop from OS (Finder → app) — uploads to the active remote dir
- [x] Swap local / remote panes
- [x] Message-log position (above / below the file panes)
- [x] Date/time format (short / locale / ISO)
- [x] Filesize format (binary / decimal)
- [x] File-list sorting mode + case sensitivity
- [x] Configurable double-click action (files / dirs)
- [x] Column-click sorting in file lists (Name / Size / Modified, toggle direction)
- [x] Filename filter (substring; files only)
- [x] Force refresh (F5) — re-fetches both panes
- [x] Momentary (instantaneous) transfer speed
- [x] Prevent system sleep during transfers (macOS caffeinate / Linux systemd-inhibit)
- [~] On-startup behaviour — setting stored; opens the connection menu (tab restore
  not yet persisted)

## File editing
- [x] Open file with OS default app ("Open with…") — local direct, remote via temp download
- [x] Watch the opened file & auto re-upload on change (poll-based; logs each re-upload)
- [x] Default editor + filetype → editor associations

## Charset
- [~] Filename charset (Autodetect / Force UTF-8) — per-site preference stored;
  ssh2/suppaftp already decode as UTF-8, so custom-codepage transcoding is not
  yet supported

## Security & storage
- [x] Secrets in OS keychain (vs FileZilla plaintext/master-password)
- [x] SFTP host-key verification (TOFU; blocks key-change MITM)
- [x] Proxy password kept in memory only (never written to disk)
- [x] Durable logs (SQLite) + per-site filtering
- [ ] Split FTPS cert-trust from hostname check (LOW, audit nit)
- [x] Log to file (mirror log lines to a chosen path)
- [ ] Master-password equivalent already covered by keychain (n/a)

## Misc
- [x] Import FileZilla `sitemanager.xml` (Site Manager → import icon)
- [x] Directory-comparison size threshold
- [x] Debug page (version / OS / paths / session count)
- [~] Check for updates — opens the releases page (no in-app auto-download)
- [~] Language / i18n — scaffolding in place (locale setting + `t()` lookup +
  English/Spanish starter dictionaries; full string coverage is incremental)
