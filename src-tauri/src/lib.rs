//! TurboFiles library crate. `run()` builds and launches the Tauri application.
//!
//! Module map:
//! - [`commands`] - the IPC surface (Tauri commands).
//! - [`protocols`] - SFTP/FTP/FTPS adapters behind the `RemoteFs` trait.
//! - [`transfer`] - queue, pause/cancel control, and worker threads.
//! - [`storage`] - SQLite site store and OS-keychain secret storage.
//! - [`state`] - shared application state managed by Tauri.

pub mod commands;
pub mod error;
pub mod models;
pub mod protocols;
pub mod state;
pub mod storage;
pub mod transfer;
pub mod util;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

/// One-time data migration for the GoWP rebrand. Renaming the bundle identifier
/// (io.xfusion.turbofiles -> com.gowp.turbofiles) moves Tauri's app-data dir, so
/// on first launch under the new identifier we copy the previous dir's databases
/// (saved sites and history, plus any WAL/SHM sidecars) into the new location.
/// Best-effort: any failure is logged and the app continues with a fresh store.
fn migrate_legacy_data_dir(data_dir: &std::path::Path) {
    if data_dir.join("turbofiles.sqlite").exists() {
        return; // already migrated, or this install already has data
    }
    let legacy_dir = data_dir.with_file_name("io.xfusion.turbofiles");
    if !legacy_dir.join("turbofiles.sqlite").exists() {
        return; // no previous install to migrate from
    }
    if let Err(e) = std::fs::create_dir_all(data_dir) {
        tracing::warn!("data-dir migration: cannot create {data_dir:?}: {e}");
        return;
    }
    // Copy both databases plus any WAL/SHM sidecars that may hold uncheckpointed
    // writes, so the copy is consistent even if the old app exited with a WAL.
    for name in [
        "turbofiles.sqlite",
        "turbofiles.sqlite-wal",
        "turbofiles.sqlite-shm",
        "turbofiles-history.sqlite",
        "turbofiles-history.sqlite-wal",
        "turbofiles-history.sqlite-shm",
    ] {
        let src = legacy_dir.join(name);
        if src.exists() {
            if let Err(e) = std::fs::copy(&src, data_dir.join(name)) {
                tracing::warn!("data-dir migration: copying {name} failed: {e}");
            }
        }
    }
    tracing::info!("migrated app data from {legacy_dir:?} to {data_dir:?}");
}

/// Build and run the application. Called from `main.rs`.
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // In-app self-update: the updater verifies a signed `latest.json` and the
        // process plugin relaunches the app after the new version is installed.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = match std::env::var("TURBOFILES_DB_PATH") {
                Ok(p) => std::path::PathBuf::from(p),
                Err(_) => {
                    migrate_legacy_data_dir(&data_dir);
                    data_dir.join("turbofiles.sqlite")
                }
            };
            let state = state::AppState::new(db_path)?;
            app.manage(state);

            // Set the window icon from the bundled PNG so the dock/taskbar
            // shows the correct icon even in dev/debug builds.
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                // Decode the PNG at compile time and embed raw RGBA bytes.
                let _ = window.set_icon(
                    app.default_window_icon()
                        .cloned()
                        .unwrap_or_else(|| tauri::image::Image::new_owned(vec![0u8; 4], 1, 1)),
                );
            }

            tracing::info!("TurboFiles started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::connect_site,
            commands::connection::forget_host_key,
            commands::connection::disconnect,
            commands::connection::list_remote,
            commands::connection::download_to_temp,
            commands::connection::read_remote_text,
            commands::connection::start_file_edit,
            commands::connection::is_file_being_edited,
            commands::connection::delete_remote,
            commands::connection::rename_remote,
            commands::connection::mkdir_remote,
            commands::fs_local::list_local,
            commands::fs_local::home_dir,
            commands::fs_local::read_key_file,
            commands::fs_local::delete_local,
            commands::fs_local::rename_local,
            commands::fs_local::mkdir_local,
            commands::fs_local::reveal_in_finder,
            commands::fs_local::open_path,
            commands::fs_local::open_with,
            commands::fs_local::set_prevent_sleep,
            commands::fs_local::debug_info,
            commands::transfer::enqueue_upload,
            commands::transfer::enqueue_download,
            commands::transfer::pause_transfer,
            commands::transfer::resume_transfer,
            commands::transfer::cancel_transfer,
            commands::transfer::set_speed_limits,
            commands::transfer::list_transfers,
            commands::sites::list_sites,
            commands::sites::save_site,
            commands::sites::delete_site,
            commands::history::append_log,
            commands::history::list_logs,
            commands::history::clear_logs,
            commands::history::set_log_file,
            commands::history::record_transfer,
            commands::history::list_transfer_history,
            commands::history::clear_transfer_history,
            commands::agent::llm_set_key,
            commands::agent::llm_has_key,
            commands::agent::llm_clear_key,
            commands::agent::llm_proxy,
            commands::agent::llm_list_models,
            commands::update::check_latest_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TurboFiles");
}

fn init_tracing() {
    let filter =
        EnvFilter::try_from_env("TURBOFILES_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

#[cfg(test)]
mod migration_tests {
    use super::migrate_legacy_data_dir;
    use std::fs;

    #[test]
    fn copies_legacy_databases_into_new_dir() {
        let base = tempfile::tempdir().unwrap();
        let legacy = base.path().join("io.xfusion.turbofiles");
        let new_dir = base.path().join("com.gowp.turbofiles");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("turbofiles.sqlite"), b"sites").unwrap();
        fs::write(legacy.join("turbofiles-history.sqlite"), b"history").unwrap();

        migrate_legacy_data_dir(&new_dir);

        assert_eq!(
            fs::read(new_dir.join("turbofiles.sqlite")).unwrap(),
            b"sites"
        );
        assert_eq!(
            fs::read(new_dir.join("turbofiles-history.sqlite")).unwrap(),
            b"history"
        );
    }

    #[test]
    fn does_not_overwrite_existing_data() {
        let base = tempfile::tempdir().unwrap();
        let legacy = base.path().join("io.xfusion.turbofiles");
        let new_dir = base.path().join("com.gowp.turbofiles");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(legacy.join("turbofiles.sqlite"), b"old").unwrap();
        fs::write(new_dir.join("turbofiles.sqlite"), b"current").unwrap();

        migrate_legacy_data_dir(&new_dir);

        assert_eq!(
            fs::read(new_dir.join("turbofiles.sqlite")).unwrap(),
            b"current"
        );
    }
}
