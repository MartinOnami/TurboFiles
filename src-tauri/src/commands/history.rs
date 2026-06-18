//! Commands for the durable log and transfer history (see `storage::history`).

use tauri::State;

use crate::error::Result;
use crate::models::{LogEntry, Transfer};
use crate::state::AppState;

/// Maximum number of recent rows loaded into the UI at startup. The database
/// retains everything; this only bounds what is hydrated into memory.
const LOAD_LIMIT: u32 = 2000;

#[tauri::command]
pub fn append_log(entry: LogEntry, state: State<'_, AppState>) -> Result<()> {
    // Mirror to the on-disk log file when enabled (best-effort; never fails the call).
    if let Some(file) = state.log_file.lock().as_mut() {
        use std::io::Write;
        let scope = entry.scope.as_deref().unwrap_or("-");
        let _ = writeln!(
            file,
            "{} [{}] ({}) {}",
            entry.timestamp, entry.level, scope, entry.message
        );
    }
    state.history.append_log(&entry)
}

/// Enable or disable mirroring log lines to a file on disk. Passing an empty
/// path (or `None`) closes the file and stops logging.
#[tauri::command]
pub fn set_log_file(path: Option<String>, state: State<'_, AppState>) -> Result<()> {
    let mut guard = state.log_file.lock();
    match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&p)?;
            *guard = Some(file);
        }
        None => *guard = None,
    }
    Ok(())
}

#[tauri::command]
pub fn list_logs(state: State<'_, AppState>) -> Result<Vec<LogEntry>> {
    state.history.list_logs(LOAD_LIMIT)
}

#[tauri::command]
pub fn clear_logs(state: State<'_, AppState>) -> Result<()> {
    state.history.clear_logs()
}

#[tauri::command]
pub fn record_transfer(
    transfer: Transfer,
    finished_at: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state.history.record_transfer(&transfer, &finished_at)
}

#[tauri::command]
pub fn list_transfer_history(state: State<'_, AppState>) -> Result<Vec<Transfer>> {
    state.history.list_transfers(LOAD_LIMIT)
}

#[tauri::command]
pub fn clear_transfer_history(state: State<'_, AppState>) -> Result<()> {
    state.history.clear_transfers()
}
