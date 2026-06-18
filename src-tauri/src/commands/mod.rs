//! Tauri command handlers - the IPC surface exposed to the frontend.
//!
//! Each submodule groups related commands. The full contract is in docs/API.md.
//! Blocking protocol I/O is offloaded with `spawn_blocking` so the async runtime
//! is never blocked.

pub mod agent;
pub mod connection;
pub mod fs_local;
pub mod history;
pub mod sites;
pub mod transfer;
pub mod update;
