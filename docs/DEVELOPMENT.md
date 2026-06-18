# Development Guide

## Prerequisites
- **Node** 20+ and npm.
- **Rust** stable (`rustup`), plus the Tauri v2 system dependencies for your OS:
  https://tauri.app/start/prerequisites/
- Optional: **Docker** for protocol test servers.

## Setup
```bash
npm install
npm run tauri:dev      # desktop app with hot reload
# or, UI only in a browser (uses demo data, no backend):
npm run dev
```

## Project layout
```
src/                 React UI (components, store, lib bridge, theme)
src-tauri/src/       Rust backend (commands, protocols, transfer, storage, state)
tests/               Frontend tests (Vitest)
src-tauri/tests/     Rust integration tests
docs/                Specs, architecture, API, roadmap
docker/              Build image + test servers
.github/workflows/   CI, security, release
scripts/             bump-version.sh
```

## Common scripts
```bash
npm run lint          # ESLint (zero warnings)
npm run typecheck     # tsc --noEmit
npm run format        # Prettier write
npm test              # Vitest
npm run test:coverage # Vitest + v8 coverage

# In src-tauri/
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

## Protocol test servers
```bash
docker compose -f docker/docker-compose.test.yml up -d
# SFTP localhost:2222, FTP localhost:21, FTPS localhost:2121 - testuser/testpass
```

## Conventions
- TypeScript types in `src/lib/types.ts` must stay in sync with Rust serde models
  in `src-tauri/src/models.rs` (camelCase on the wire).
- New Tauri command → register in `lib.rs`, wrap in `src/lib/api.ts`, document in
  `docs/API.md`.
- Conventional Commits (see CONTRIBUTING.md).

## Working in a loop (Codex / agents)
The repo is structured so an agent can iterate milestone-by-milestone:
1. Read `docs/ROADMAP.md` and pick the next milestone.
2. Implement it; keep `RemoteFs`/command boundaries intact.
3. Run the quality gates above; fix failures.
4. Update `docs/FEATURE_PARITY.md` and `CHANGELOG.md`.
5. Commit with a Conventional Commit message.

Keep each loop bounded to one milestone rather than "reach full parity" in one
run - see the README and ROADMAP for why.
