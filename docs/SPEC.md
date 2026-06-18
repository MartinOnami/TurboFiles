# TurboFiles - Product Spec

## Vision
A modern, fast, cross-platform file-transfer client that matches FileZilla's
proven workflow with a clean, themeable UI and a high-performance Rust core.

## Goals
- Reliable SFTP, FTP, and FTPS transfers.
- Familiar dual-pane local/remote workflow.
- Transfer queue with progress, pause/resume/cancel.
- Secure credential storage (OS keychain).
- Small footprint and low memory use.
- Light and dark themes.

## Non-goals (initial)
- Server-to-server (FXP) transfers.
- Built-in text/file editing.
- Cloud storage backends (S3, etc.) - possible future work.

## Personas
- **Web developer** deploying a static site over SFTP.
- **Sysadmin** moving backups across FTP/FTPS.
- **Designer** uploading assets without a CLI.

## Functional requirements
1. Connect via SFTP (password or key), FTP, FTPS (explicit TLS).
2. Browse local and remote directories; navigate into/out of folders.
3. Upload/download files via double-click or transfer buttons.
4. Queue multiple transfers; show progress, speed, ETA; pause/resume/cancel.
5. Save/edit/delete sites; reconnect from the Site Manager.
6. Store secrets in the OS keychain.
7. Toggle and persist theme.
8. Show a connection/transfer log.

## Non-functional requirements
- **Performance:** UI stays responsive during large transfers.
- **Security:** see [SECURITY.md](../SECURITY.md).
- **Portability:** macOS, Windows, Linux from one codebase.
- **Quality:** lint/type/test gates in CI; documented public API.

## Success metrics
- Cold start < 1s; idle memory materially below an equivalent Electron build.
- A first-time user can connect and upload a file without docs.
