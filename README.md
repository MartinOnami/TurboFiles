# TurboFiles

A modern, fast SFTP / FTP / FTPS client with a FileZilla-style dual-pane
interface — built with **Tauri 2**, **React + TypeScript**, and a **Rust**
transfer engine. Light and dark themes included.

[![CI](https://github.com/MartinOnami/TurboFiles/actions/workflows/ci.yml/badge.svg)](https://github.com/MartinOnami/TurboFiles/actions/workflows/ci.yml)
[![Security](https://github.com/MartinOnami/TurboFiles/actions/workflows/security.yml/badge.svg)](https://github.com/MartinOnami/TurboFiles/actions/workflows/security.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

> Status: early MVP scaffold. SFTP is the most complete protocol; FTP/FTPS are
> functional but maturing. See [`docs/FEATURE_PARITY.md`](docs/FEATURE_PARITY.md).

## Why

FileZilla is fast but its UI is dated. TurboFiles keeps the proven dual-pane layout
and pushes all heavy lifting (connections, streaming, the transfer queue) into a
Rust backend, while the UI stays a clean React app. The result is a small, low-
memory desktop app that's pleasant to use.

## Features

- **Protocols:** SFTP (password + key auth), FTP, FTPS (explicit TLS).
- **Dual-pane** local ↔ remote browsing with double-click transfers.
- **Transfer queue** with live progress, speed, ETA, pause/resume/cancel.
- **Site Manager** backed by SQLite; **secrets stored in the OS keychain**.
- **Dark & light themes** that follow your system preference.
- **Cross-platform:** macOS, Windows, Linux.

## Quick start

```bash
# Prerequisites: Node 20+, Rust (stable), and the Tauri system deps for your OS.
npm install
npm run tauri:dev      # launches the desktop app in dev mode
```

Build installers for your platform:

```bash
npm run tauri:build
```

New to the app? Read the **[How-To guide](HOWTO.md)**.
Want to contribute or understand the internals? See
**[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)** and
**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Documentation

| Doc | What it covers |
| --- | --- |
| [HOWTO.md](HOWTO.md) | End-user guide: connect, browse, transfer, save sites |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, scripts, conventions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit together |
| [docs/API.md](docs/API.md) | Tauri command + event reference |
| [docs/SPEC.md](docs/SPEC.md) | Product spec and requirements |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones toward FileZilla parity |
| [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md) | Feature-by-feature status vs FileZilla |
| [docs/ACCEPTANCE_TESTS.md](docs/ACCEPTANCE_TESTS.md) | Acceptance criteria / test matrix |
| [SECURITY.md](SECURITY.md) | Security model and reporting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, commit style, releases |

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri 2 |
| Frontend | React 18, TypeScript, Vite, Tailwind, Zustand, TanStack Query |
| Backend | Rust (async Tokio + `spawn_blocking` for protocol I/O) |
| Protocols | `ssh2` (SFTP), `suppaftp` (FTP/FTPS) |
| Storage | SQLite (`rusqlite`), OS keychain (`keyring`) |

## License

MIT — see [LICENSE](LICENSE).
