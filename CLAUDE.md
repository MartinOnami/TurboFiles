# CLAUDE.md — Agent guide for TurboFiles

Context for AI agents (and humans) working in this repo. Read this first.

## What this is
A Tauri 2 desktop SFTP/FTP/FTPS client. React/TypeScript UI (`src/`), Rust
backend (`src-tauri/src/`). The UI is presentational; **all network/filesystem
logic lives in Rust**.

## Golden rules
- Keep protocol logic behind the `RemoteFs` trait (`src-tauri/src/protocols`).
- UI components stay presentational; state in Zustand (`src/store`), backend
  calls only through `src/lib/api.ts`.
- TS types (`src/lib/types.ts`) must match Rust serde models
  (`src-tauri/src/models.rs`) — camelCase on the wire.
- **Never** store secrets in SQLite/logs/frontend. Secrets → OS keychain only.
- Every new command: register in `lib.rs`, wrap in `api.ts`, document in
  `docs/API.md`, add a test.

## Build & test (must pass before commit)
```bash
npm run lint && npm run typecheck && npm test
cd src-tauri && cargo fmt --all --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```

## How to extend
- New protocol → new module in `protocols/` + arm in `protocols::connect` + tests.
- Work milestone-by-milestone from `docs/ROADMAP.md`; update
  `docs/FEATURE_PARITY.md` and `CHANGELOG.md` after each.

## Conventions
- Conventional Commits (`feat:`, `fix:`, `docs:`, …).
- SemVer; bump via `scripts/bump-version.sh`.

## Key files
- `src-tauri/src/lib.rs` — app wiring + command registration.
- `src-tauri/src/protocols/traits.rs` — the `RemoteFs` contract.
- `src-tauri/src/transfer/worker.rs` — transfer execution + progress events.
- `src/App.tsx` — top-level UI composition.
- `docs/ARCHITECTURE.md` — the big picture.
