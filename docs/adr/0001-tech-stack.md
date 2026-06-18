# ADR-0001: Tech stack — Tauri + React + Rust

- Status: Accepted
- Date: 2026-06-13

## Context
We need a cross-platform desktop file-transfer client that is fast, low-memory,
and has a modern, themeable UI, while keeping protocol/transfer logic robust and
testable.

## Options considered
1. **Electron + React + Node** — fastest to build, huge ecosystem, but large app
   size and high memory; transfer logic in Node is workable but less efficient.
2. **Tauri + React + Rust** — small binaries, low memory, Rust backend ideal for
   streaming and concurrency; cost is a steeper backend learning curve.
3. **Qt + C++/Rust** — excellent performance, but slower UI iteration and a
   heavier toolchain.

## Decision
Adopt **Tauri 2 + React/TypeScript + Rust**. Keep the UI purely presentational
and put all connections, streaming, and the transfer queue in Rust behind a
`RemoteFs` trait.

## Consequences
- ➕ Small footprint, low memory, fast UI iteration, clean FE/BE separation.
- ➕ Rust crates (`ssh2`, `suppaftp`, `rusqlite`, `keyring`) cover our needs.
- ➖ Two toolchains (Node + Rust) and Tauri system deps to manage in CI.
- ➖ `ssh2`/`suppaftp` are blocking → we run them on `spawn_blocking`.
