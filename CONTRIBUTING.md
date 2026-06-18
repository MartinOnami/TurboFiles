# Contributing to TurboFiles

Thanks for helping build TurboFiles! This doc covers workflow, conventions, and
releases. For environment setup, see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Workflow

1. Fork & branch from `main` (`feat/...`, `fix/...`).
2. Make your change with tests and docs.
3. Ensure all checks pass locally (below).
4. Open a PR using the template; keep PRs focused.

## Local checks (must pass)

```bash
# Frontend
npm run format:check
npm run lint
npm run typecheck
npm test

# Backend (from src-tauri/)
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

## Commit messages — Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org). The changelog
and version bumps are derived from them.

```
feat(transfer): add resume support for interrupted SFTP downloads
fix(ftp): handle servers that omit the group column in LIST
docs(howto): clarify FTPS certificate troubleshooting
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `chore`,
`sec`.

## Versioning & releases

TurboFiles follows [Semantic Versioning](https://semver.org).

```bash
./scripts/bump-version.sh 0.2.0   # updates VERSION, package.json, Cargo.toml, tauri.conf.json
git commit -am "chore(release): v0.2.0"
git tag v0.2.0
git push --follow-tags             # triggers the Release workflow
```

The Release workflow builds signed bundles for macOS/Windows/Linux and drafts a
GitHub Release with auto-generated notes.

## Adding a protocol

1. Create `src-tauri/src/protocols/<name>.rs` implementing the `RemoteFs` trait.
2. Add a `Protocol` variant and a match arm in `protocols::connect`.
3. Add unit tests and update `docs/FEATURE_PARITY.md`.

## Code of conduct

Be respectful and constructive. Harassment is not tolerated.
