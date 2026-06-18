# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories
("Report a vulnerability") or by emailing **security@xfusion.io**. Do not open a
public issue for vulnerabilities. We aim to acknowledge within 3 business days.

## Security model

TurboFiles handles credentials and remote file access, so security is a first-class
concern.

### Credentials & secrets
- **Passwords and key passphrases are stored in the OS keychain** (`keyring`
  crate): macOS Keychain, Windows Credential Manager, Linux Secret Service.
- **Secrets are never written** to the SQLite database, to logs, or to disk in
  plain text, and are **never returned to the frontend**.
- Error messages are constructed to avoid leaking secret material.

### Transport
- **SFTP** runs over SSH; host-key handling follows the `ssh2`/libssh2 defaults.
- **FTPS** uses explicit TLS via native-tls. Plain **FTP is unencrypted** — the UI
  surfaces the protocol clearly so users make an informed choice.

### Application sandboxing
- The Tauri **Content-Security-Policy** restricts the webview to `'self'`
  (see `src-tauri/tauri.conf.json` and `index.html`).
- The frontend can only call the explicitly allow-listed Tauri commands; there is
  no arbitrary shell or filesystem bridge exposed to the webview.
- Tauri **capabilities** (`src-tauri/capabilities/main.json`) scope plugin
  permissions to the minimum required.

### Supply chain
- `cargo audit` and `npm audit` run in CI (and weekly) — see
  `.github/workflows/security.yml`.
- **CodeQL** static analysis runs on every push/PR.
- **Dependabot** keeps npm, cargo, and GitHub Actions dependencies patched.

### Build integrity
- Release binaries are built in CI and support **code signing / notarization**
  (macOS) and Tauri's updater signing keys (secrets configured in repo settings).

## Supported versions

During the `0.x` series, only the latest minor release receives security fixes.
