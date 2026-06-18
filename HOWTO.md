# TurboFiles — How-To Guide

This guide walks you through everyday tasks in TurboFiles. No prior FileZilla
experience needed.

## 1. Install & launch

Download the installer for your platform from the
[Releases](https://github.com/MartinOnami/TurboFiles/releases) page, or build it
yourself (see the [README](README.md)). Launch **TurboFiles** like any desktop app.

## 2. Connect to a server

The connection bar runs across the top of the window.

1. **Protocol** — pick `SFTP`, `FTP`, or `FTPS`. The port auto-fills (22 for SFTP,
   21 for FTP/FTPS); change it if your server differs.
2. **Host** — e.g. `sftp.example.com`.
3. **Username** and **Password**. For SFTP key auth, leave the password blank and
   save a site with a private key (see §5).
4. Click **Connect**.

When connected, the right-hand **Remote site** pane fills with the server's files
and the status bar shows a green lock.

## 3. Browse files

- The **left pane** is your computer (Local site); the **right pane** is the
  server (Remote site).
- **Double-click a folder** to open it. Use the **▲** button or the `..` row to go
  up a level.
- Each pane's footer shows how many folders and files are listed and their total
  size.

## 4. Transfer files

- **Upload:** double-click a file in the Local pane, or select it and press the
  **→** arrow.
- **Download:** double-click a file in the Remote pane, or press the **←** arrow.
- Watch progress in the **Transfer Queue** at the bottom: percentage, speed, and
  size. Use the **pause/resume** and **cancel** buttons per row.

## 5. Save a site (Site Manager)

Saving a site stores its settings so you can reconnect in one click. Your
**password is stored securely in your operating system's keychain** (macOS
Keychain, Windows Credential Manager, or the Linux Secret Service) — never in
plain text and never in the app's database.

Saved sites appear in the left **Site Manager** sidebar.

## 6. Switch theme

Click the **sun/moon** icon in the top-right to toggle **light / dark** mode.
TurboFiles remembers your choice and otherwise follows your system setting.

## 7. Read the logs

The **Logs** tab (next to Transfer Queue) shows a timestamped record of
connections, listings, and transfers — useful when something doesn't work.

## Troubleshooting

| Symptom | Try this |
| --- | --- |
| "Authentication failed" | Re-check username/password; for SFTP keys confirm the key and passphrase. |
| Connection times out | Verify host/port and that the server is reachable / not firewalled. |
| FTPS certificate error | The server's TLS certificate may be self-signed or expired. |
| Listing looks wrong on FTP | Some servers use non-Unix `LIST` formats; see FEATURE_PARITY.md. |

Still stuck? Open an issue with the relevant log lines (redact any secrets).
