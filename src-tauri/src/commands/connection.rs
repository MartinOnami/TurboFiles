use std::sync::Arc;

use parking_lot::Mutex;
use tauri::State;
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::models::{ConnectionRequest, DirEntry, LogonType, Session};
use crate::protocols;
use crate::state::{AppState, SessionEntry};
use crate::storage::keychain;

/// Connect with reconnection retries. Retries only transient *connection*
/// failures (never auth or certificate-trust errors, which won't fix themselves
/// and could lock an account). Runs on a blocking thread.
fn connect_with_retry(req: &ConnectionRequest) -> Result<Box<dyn crate::protocols::RemoteFs>> {
    let retries = req.retries.unwrap_or(0);
    let delay = std::time::Duration::from_secs(req.retry_delay_secs.unwrap_or(5));
    let mut attempt = 0u32;
    loop {
        match protocols::connect(req) {
            Ok(c) => return Ok(c),
            Err(e @ (Error::Auth(_) | Error::CertUntrusted(_) | Error::Invalid(_))) => {
                return Err(e)
            }
            Err(e) => {
                if attempt >= retries {
                    return Err(e);
                }
                attempt += 1;
                std::thread::sleep(delay);
            }
        }
    }
}

/// How often the keep-alive heartbeat pings an idle control connection.
const KEEPALIVE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

/// Spawn a background thread that periodically sends a protocol keep-alive
/// (FTP `NOOP`) so an idle control connection isn't dropped by the server. It
/// skips ticks while a transfer holds the lock and exits once the session is
/// dropped (the `Weak` upgrade fails).
fn spawn_keepalive(client: &Arc<Mutex<Box<dyn crate::protocols::RemoteFs>>>) {
    let weak = Arc::downgrade(client);
    std::thread::spawn(move || loop {
        std::thread::sleep(KEEPALIVE_INTERVAL);
        match weak.upgrade() {
            None => break,
            Some(strong) => {
                if let Some(mut guard) = strong.try_lock() {
                    let _ = guard.keep_alive();
                }
            }
        }
    });
}

/// Open a connection and register a session. Returns the session handle.
#[tauri::command]
pub async fn connect(req: ConnectionRequest, state: State<'_, AppState>) -> Result<Session> {
    let hostport = format!("{}:{}", req.host, req.port);
    let known = state.sites.known_host(&hostport)?;
    let mut build_req = req.clone();
    build_req.known_host_key = known.clone();
    // The resolved request (with host key + credentials) is reused by the pool
    // to mint extra transfer connections; it lives in memory only.
    let pool_req = build_req.clone();
    let client = tauri::async_runtime::spawn_blocking(move || connect_with_retry(&build_req))
        .await
        .map_err(|e| Error::Connection(e.to_string()))??;

    let shared = Arc::new(Mutex::new(client));
    if req.ftp_keep_alive == Some(true) {
        spawn_keepalive(&shared);
    }
    let pool = crate::transfer::ConnectionPool::new(
        pool_req,
        req.max_concurrent.unwrap_or(1) as usize,
        shared.clone(),
    );
    // Trust-on-first-use: remember a host key we hadn't seen before.
    if known.is_none() {
        if let Some(fp) = shared.lock().host_key_fingerprint() {
            let _ = state.sites.set_known_host(&hostport, &fp);
        }
    }
    let cwd = {
        let c = shared.clone();
        tauri::async_runtime::spawn_blocking(move || c.lock().cwd())
            .await
            .map_err(|e| Error::Remote(e.to_string()))??
    };

    let meta = Session {
        id: Uuid::new_v4().to_string(),
        protocol: req.protocol,
        host: req.host,
        username: req.username,
        cwd,
    };
    state.sessions.lock().insert(
        meta.id.clone(),
        SessionEntry {
            meta: meta.clone(),
            client: shared,
            pool,
        },
    );
    Ok(meta)
}

/// Forget a remembered SSH host key so the next connect re-trusts the current
/// key (used to accept a legitimately-rotated server key after a mismatch).
#[tauri::command]
pub fn forget_host_key(host: String, port: u16, state: State<'_, AppState>) -> Result<()> {
    state.sites.forget_known_host(&format!("{host}:{port}"))
}

/// Close and drop a session.
#[tauri::command]
pub async fn disconnect(session_id: String, state: State<'_, AppState>) -> Result<()> {
    let entry = state.sessions.lock().remove(&session_id);
    if let Some(entry) = entry {
        // Closes the interactive connection and every pooled transfer connection.
        let _ = tauri::async_runtime::spawn_blocking(move || entry.pool.disconnect_all()).await;
    }
    Ok(())
}

/// Connect to a saved site using its stored credentials.
///
/// `accept_invalid_cert` lets the caller override the site's stored trust flag
/// for this attempt (used by the "trust this certificate?" retry flow). When it
/// is `Some(true)` and the site wasn't already trusting the cert, the choice is
/// persisted so future connections don't re-prompt.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // mirrors the frontend connect form / settings 1:1
pub async fn connect_site(
    site_id: String,
    accept_invalid_cert: Option<bool>,
    timeout_secs: Option<u64>,
    retries: Option<u32>,
    retry_delay_secs: Option<u64>,
    proxy: Option<crate::models::ProxyConfig>,
    min_tls_version: Option<String>,
    sftp_compression: Option<bool>,
    use_agent: Option<bool>,
    ftp_keep_alive: Option<bool>,
    ftp_mode: Option<crate::models::FtpMode>,
    preallocate: Option<bool>,
    max_concurrent: Option<u32>,
    ftp_data_type: Option<String>,
    ftp_proxy_host: Option<String>,
    ftp_proxy_port: Option<u16>,
    // One-shot password/passphrase supplied at connect time (e.g. when the site has
    // no stored secret). Takes precedence over the keychain value; not persisted.
    password_override: Option<String>,
    state: State<'_, AppState>,
) -> Result<Session> {
    let site = state
        .sites
        .get(&site_id)?
        .ok_or_else(|| Error::Invalid(format!("site {site_id} not found")))?;

    let trust_cert = accept_invalid_cert.unwrap_or(false) || site.accept_invalid_cert == Some(true);
    // Persist a newly-granted trust decision so we don't prompt again next time.
    if accept_invalid_cert == Some(true) && site.accept_invalid_cert != Some(true) {
        let mut updated = site.clone();
        updated.accept_invalid_cert = Some(true);
        let _ = state.sites.upsert(updated);
    }

    // Treat empty-string secrets the same as absent (saved without a secret).
    // For Key logon the stored secret is the key *passphrase*; otherwise it's the
    // password. An explicit one-shot override (entered at connect time) wins.
    let secret = password_override
        .filter(|s| !s.is_empty())
        .or(keychain::get_secret(&site_id)?)
        .filter(|s| !s.is_empty());

    let (password, private_key, passphrase) = if site.logon_type == LogonType::Key {
        let path = site.private_key_path.clone().ok_or_else(|| {
            Error::Invalid("this site uses key auth but has no key file path saved".into())
        })?;
        let key = std::fs::read_to_string(&path)
            .map_err(|e| Error::Invalid(format!("could not read key file {path}: {e}")))?;
        (None, Some(key), secret)
    } else {
        (secret, None, None)
    };

    let req = ConnectionRequest {
        protocol: site.protocol,
        host: site.host.clone(),
        port: site.port,
        username: site.username.clone(),
        logon_type: site.logon_type,
        password,
        private_key,
        passphrase,
        ftp_encryption: site.ftp_encryption,
        accept_invalid_cert: Some(trust_cert),
        timeout_secs,
        retries,
        retry_delay_secs,
        // The site's explicit Active/Passive choice wins; otherwise fall back to
        // the caller's global default transfer mode.
        ftp_mode: match site.ftp_mode {
            Some(crate::models::FtpMode::Default) | None => ftp_mode,
            explicit => explicit,
        },
        // A site flagged "bypass proxy" connects directly regardless of the
        // caller's global proxy.
        proxy: if site.bypass_proxy == Some(true) {
            None
        } else {
            proxy
        },
        known_host_key: None,
        min_tls_version,
        sftp_compression,
        use_agent,
        ftp_keep_alive,
        preallocate,
        // A per-site connection limit (when set) caps the global default.
        max_concurrent: match (site.connection_limit, max_concurrent) {
            (Some(site_max), Some(global)) => Some(site_max.min(global)),
            (Some(site_max), None) => Some(site_max),
            (None, global) => global,
        },
        time_offset_minutes: site.timezone_offset_minutes,
        encoding: site.encoding.clone(),
        ftp_data_type,
        ftp_proxy_host,
        ftp_proxy_port,
    };
    let keep_alive = req.ftp_keep_alive == Some(true);
    let pool_max = req.max_concurrent.unwrap_or(1) as usize;
    let hostport = format!("{}:{}", req.host, req.port);
    let known = state.sites.known_host(&hostport)?;
    let mut req = req;
    req.known_host_key = known.clone();
    let pool_req = req.clone();
    let client = tauri::async_runtime::spawn_blocking(move || connect_with_retry(&req))
        .await
        .map_err(|e| Error::Connection(e.to_string()))??;
    let shared = Arc::new(Mutex::new(client));
    if keep_alive {
        spawn_keepalive(&shared);
    }
    let pool = crate::transfer::ConnectionPool::new(pool_req, pool_max, shared.clone());
    if known.is_none() {
        if let Some(fp) = shared.lock().host_key_fingerprint() {
            let _ = state.sites.set_known_host(&hostport, &fp);
        }
    }
    let cwd = {
        let c = shared.clone();
        tauri::async_runtime::spawn_blocking(move || c.lock().cwd())
            .await
            .map_err(|e| Error::Remote(e.to_string()))??
    };
    let meta = Session {
        id: Uuid::new_v4().to_string(),
        protocol: site.protocol,
        host: site.host,
        username: site.username,
        cwd,
    };
    state.sessions.lock().insert(
        meta.id.clone(),
        SessionEntry {
            meta: meta.clone(),
            client: shared,
            pool,
        },
    );
    Ok(meta)
}

/// Download a remote file to a temp directory and return the local path, so the
/// frontend can open it with the OS default application ("Open with…").
#[tauri::command]
pub async fn download_to_temp(
    session_id: String,
    remote_path: String,
    state: State<'_, AppState>,
) -> Result<String> {
    let client = state
        .client(&session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.clone()))?;
    let name = std::path::Path::new(&remote_path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let dir = std::env::temp_dir().join("turbofiles-open");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(&name);
    let dest_for_blocking = dest.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut noop = |_: u64, _: u64| true;
        client
            .lock()
            .download(&remote_path, &dest_for_blocking, false, &mut noop)
    })
    .await
    .map_err(|e| Error::Remote(e.to_string()))??;
    Ok(dest.to_string_lossy().into_owned())
}

/// Read a (small) remote text file and return up to `max_bytes` of its content as
/// UTF-8 (lossy). Intended for config/version/log inspection by the assistant —
/// the returned text is capped at 1 MiB.
#[tauri::command]
pub async fn read_remote_text(
    session_id: String,
    path: String,
    max_bytes: Option<u64>,
    state: State<'_, AppState>,
) -> Result<String> {
    let client = state
        .client(&session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.clone()))?;
    let cap = max_bytes.unwrap_or(65_536).min(1_048_576) as usize;
    let dir = std::env::temp_dir().join("turbofiles-read");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("{}.tmp", Uuid::new_v4()));
    let dest_for_blocking = dest.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut noop = |_: u64, _: u64| true;
        client
            .lock()
            .download(&path, &dest_for_blocking, false, &mut noop)
    })
    .await
    .map_err(|e| Error::Remote(e.to_string()))??;
    let bytes = std::fs::read(&dest)?;
    let _ = std::fs::remove_file(&dest);
    let slice = &bytes[..bytes.len().min(cap)];
    Ok(String::from_utf8_lossy(slice).into_owned())
}

/// Download a remote file to a temp dir, open it for editing, and watch it: each
/// time the local copy is saved (its mtime advances) the change is re-uploaded
/// to the remote. Returns the temp path. The watcher stops when the session
/// closes or after a long idle period.
///
/// `editor` is an optional editor command/app to open the file with; when absent
/// the OS default application is used.
#[tauri::command]
pub async fn start_file_edit(
    session_id: String,
    remote_path: String,
    editor: Option<String>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String> {
    use tauri::{Emitter, Manager};

    let client = state
        .client(&session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.clone()))?;
    let name = std::path::Path::new(&remote_path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let dir = std::env::temp_dir().join("turbofiles-edit");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(&name);

    let dl_client = client.clone();
    let dl_dest = dest.clone();
    let dl_remote = remote_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut noop = |_: u64, _: u64| true;
        dl_client
            .lock()
            .download(&dl_remote, &dl_dest, false, &mut noop)
    })
    .await
    .map_err(|e| Error::Remote(e.to_string()))??;

    // Open with the chosen editor, or the OS default app.
    open_for_edit(&dest, editor.as_deref())?;

    // Watch for saves and re-upload. Bounded so a forgotten file can't watch
    // forever (FileZilla similarly stops watching eventually).
    let baseline = file_mtime(&dest);
    let watch_dest = dest.clone();
    let watch_remote = remote_path.clone();
    std::thread::spawn(move || {
        let mut last = baseline;
        // ~2 hours at a 2s poll interval.
        for _ in 0..3600 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            let Some(client) = state.client(&session_id) else {
                return; // session gone — stop watching
            };
            let current = file_mtime(&watch_dest);
            if current > last {
                last = current;
                let res = {
                    let mut noop = |_: u64, _: u64| true;
                    client
                        .lock()
                        .upload(&watch_dest, &watch_remote, false, &mut noop)
                };
                match res {
                    Ok(()) => {
                        let _ = app.emit("editor://reuploaded", watch_remote.clone());
                    }
                    Err(e) => {
                        let _ = app.emit("editor://error", format!("{watch_remote}: {e}"));
                    }
                }
            }
        }
    });

    Ok(dest.to_string_lossy().into_owned())
}

/// Most-recent-modification time of a file as seconds since the epoch (0 if unknown).
fn file_mtime(path: &std::path::Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Open a file for editing with the given editor command, or the OS default.
fn open_for_edit(path: &std::path::Path, editor: Option<&str>) -> Result<()> {
    let path_str = path.to_string_lossy().into_owned();
    let spawn = match editor.filter(|e| !e.trim().is_empty()) {
        Some(ed) => {
            #[cfg(target_os = "macos")]
            {
                // `open -a <App> <file>` launches the named application.
                std::process::Command::new("open")
                    .args(["-a", ed, &path_str])
                    .spawn()
            }
            #[cfg(not(target_os = "macos"))]
            {
                std::process::Command::new(ed).arg(&path_str).spawn()
            }
        }
        None => {
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open").arg(&path_str).spawn()
            }
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("cmd")
                    .args(["/C", "start", "", &path_str])
                    .spawn()
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                std::process::Command::new("xdg-open")
                    .arg(&path_str)
                    .spawn()
            }
        }
    };
    spawn.map(|_| ()).map_err(|e| Error::Remote(e.to_string()))
}

/// List a remote directory.
#[tauri::command]
pub async fn list_remote(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<DirEntry>> {
    let client = state
        .client(&session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.clone()))?;
    tauri::async_runtime::spawn_blocking(move || client.lock().list(&path))
        .await
        .map_err(|e| Error::Remote(e.to_string()))?
}

/// Delete a file or empty directory on the remote.
#[tauri::command]
pub async fn delete_remote(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let client = state
        .client(&session_id)
        .ok_or(Error::SessionNotFound(session_id))?;
    tauri::async_runtime::spawn_blocking(move || client.lock().delete(&path))
        .await
        .map_err(|e| Error::Remote(e.to_string()))?
}

/// Rename / move a remote path.
#[tauri::command]
pub async fn rename_remote(
    session_id: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let client = state
        .client(&session_id)
        .ok_or(Error::SessionNotFound(session_id))?;
    tauri::async_runtime::spawn_blocking(move || client.lock().rename(&from, &to))
        .await
        .map_err(|e| Error::Remote(e.to_string()))?
}

/// Create a remote directory.
#[tauri::command]
pub async fn mkdir_remote(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let client = state
        .client(&session_id)
        .ok_or(Error::SessionNotFound(session_id))?;
    tauri::async_runtime::spawn_blocking(move || client.lock().mkdir(&path))
        .await
        .map_err(|e| Error::Remote(e.to_string()))?
}
