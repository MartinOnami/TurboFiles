use crate::error::{Error, Result};
use crate::models::{DirEntry, EntryKind};

/// List a local directory. Used for the left-hand pane.
#[tauri::command]
pub fn list_local(path: String) -> Result<Vec<DirEntry>> {
    let mut entries = Vec::new();
    for dirent in std::fs::read_dir(&path)? {
        let dirent = match dirent {
            Ok(d) => d,
            Err(_) => continue,
        };
        let lmeta = match std::fs::symlink_metadata(dirent.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let kind = if lmeta.file_type().is_symlink() {
            EntryKind::Symlink
        } else if lmeta.is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::File
        };
        let meta = std::fs::metadata(dirent.path()).unwrap_or(lmeta);
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| format_mtime(d.as_secs()));
        entries.push(DirEntry {
            name: dirent.file_name().to_string_lossy().into_owned(),
            path: dirent.path().to_string_lossy().into_owned(),
            kind,
            size: meta.len(),
            modified,
            permissions: None,
            owner: None,
        });
    }
    entries.sort_by(|a, b| {
        let da = if matches!(a.kind, EntryKind::Directory) {
            0
        } else {
            1
        };
        let db = if matches!(b.kind, EntryKind::Directory) {
            0
        } else {
            1
        };
        (da, a.name.to_lowercase()).cmp(&(db, b.name.to_lowercase()))
    });
    Ok(entries)
}

/// The current user's home directory, used as the default local root.
#[tauri::command]
pub fn home_dir() -> Result<String> {
    #[cfg(target_os = "macos")]
    if let Ok(user) = std::env::var("USER") {
        if !user.is_empty() {
            let p = std::path::PathBuf::from("/Users").join(&user);
            if p.is_dir() {
                return Ok(p.to_string_lossy().into_owned());
            }
        }
    }
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| Error::Invalid("home directory not found".into()))
}

/// Read a private key file from disk and return its PEM contents.
#[tauri::command]
pub fn read_key_file(path: String) -> Result<String> {
    Ok(std::fs::read_to_string(&path)?)
}

/// Delete a local file or directory tree.
#[tauri::command]
pub fn delete_local(path: String) -> Result<()> {
    let meta = std::fs::symlink_metadata(&path)?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        std::fs::remove_dir_all(&path)?;
    } else {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// Rename / move a local path.
#[tauri::command]
pub fn rename_local(from: String, to: String) -> Result<()> {
    std::fs::rename(&from, &to)?;
    Ok(())
}

/// Create a local directory (and all missing parents).
#[tauri::command]
pub fn mkdir_local(path: String) -> Result<()> {
    std::fs::create_dir_all(&path)?;
    Ok(())
}

/// Open the system file manager and select the given path (macOS: Finder; no-op elsewhere).
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| Error::Remote(e.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = &path;
    Ok(())
}

/// Open a local path with the OS default application ("Open with…").
#[tauri::command]
pub fn open_path(path: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&path).spawn();

    result.map(|_| ()).map_err(|e| Error::Remote(e.to_string()))
}

/// Open `path` with a specific application chosen by the user (the "Open With…"
/// flow). On macOS `app` is an application name or `.app` bundle path; elsewhere
/// it is the path to an executable.
#[tauri::command]
pub fn open_with(path: String, app: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .args(["-a", &app, &path])
        .spawn();
    #[cfg(not(target_os = "macos"))]
    let result = std::process::Command::new(&app).arg(&path).spawn();

    result.map(|_| ()).map_err(|e| Error::Remote(e.to_string()))
}

/// Keep the system awake while transfers run (or release the hold).
///
/// macOS uses a background `caffeinate -i` process; Linux uses `systemd-inhibit`.
/// On platforms without a helper this is a no-op. The handle lives in app state
/// so toggling off (or quitting) terminates it.
#[tauri::command]
pub fn set_prevent_sleep(
    active: bool,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<()> {
    let mut guard = state.sleep_guard.lock();
    // Always clear any existing hold first.
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
    if active {
        #[cfg(target_os = "macos")]
        let spawned = std::process::Command::new("caffeinate").arg("-i").spawn();
        #[cfg(all(unix, not(target_os = "macos")))]
        let spawned = std::process::Command::new("systemd-inhibit")
            .args([
                "--what=idle:sleep",
                "--why=TurboFiles transfer",
                "sleep",
                "infinity",
            ])
            .spawn();
        #[cfg(not(unix))]
        let spawned: std::io::Result<std::process::Child> = Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "prevent-sleep is not supported on this platform",
        ));

        // A missing helper shouldn't fail the transfer flow — just skip the hold.
        if let Ok(child) = spawned {
            *guard = Some(child);
        }
    }
    Ok(())
}

/// Diagnostic info for the Debug settings page: app version, OS, and key paths.
#[tauri::command]
pub fn debug_info(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<std::collections::BTreeMap<String, String>> {
    let mut info = std::collections::BTreeMap::new();
    info.insert("version".into(), env!("CARGO_PKG_VERSION").to_string());
    info.insert("os".into(), std::env::consts::OS.to_string());
    info.insert("arch".into(), std::env::consts::ARCH.to_string());
    info.insert(
        "tempDir".into(),
        std::env::temp_dir().to_string_lossy().into_owned(),
    );
    info.insert(
        "activeSessions".into(),
        state.sessions.lock().len().to_string(),
    );
    info.insert(
        "logToFile".into(),
        state.log_file.lock().is_some().to_string(),
    );
    Ok(info)
}

/// Format a Unix timestamp as "Jun 13 09:42" — matches the SFTP remote format.
fn format_mtime(secs: u64) -> String {
    use time::OffsetDateTime;
    const MON: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    OffsetDateTime::from_unix_timestamp(secs as i64)
        .map(|dt| {
            let m = (dt.month() as u8).saturating_sub(1) as usize;
            format!(
                "{} {:2} {:02}:{:02}",
                MON.get(m).copied().unwrap_or("?"),
                dt.day(),
                dt.hour(),
                dt.minute()
            )
        })
        .unwrap_or_default()
}
