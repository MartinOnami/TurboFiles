use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::models::{EntryKind, Transfer, TransferDirection, TransferStatus};
use crate::protocols::RemoteFs;
use crate::state::AppState;
use crate::transfer::{self, Pending, TransferControl, CANCELLED, PAUSED, RUNNING};

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Join a remote directory path with a child name (remote paths use '/').
fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// One concrete file to transfer, produced by expanding a (possibly directory) request.
struct FilePlan {
    local: String,
    remote: String,
    size: u64,
}

/// Expand a local path into individual file uploads, creating remote dirs as needed.
fn plan_upload(fs: &mut dyn RemoteFs, local: &Path, remote: &str) -> Result<Vec<FilePlan>> {
    let meta = std::fs::symlink_metadata(local)?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        // Ensure the destination directory exists (ignore "already exists").
        let _ = fs.mkdir(remote);
        let mut plans = Vec::new();
        let mut children: Vec<_> = std::fs::read_dir(local)?.flatten().collect();
        children.sort_by_key(|e| e.file_name());
        for child in children {
            let name = child.file_name().to_string_lossy().into_owned();
            let child_remote = join_remote(remote, &name);
            plans.extend(plan_upload(fs, &child.path(), &child_remote)?);
        }
        Ok(plans)
    } else {
        Ok(vec![FilePlan {
            local: local.to_string_lossy().into_owned(),
            remote: remote.to_string(),
            size: meta.len(),
        }])
    }
}

/// Optional rule for replacing illegal characters in server-supplied filenames:
/// `(extra_chars, replacement)`.
type Sanitizer = (String, char);

/// True if `name` is a single, ordinary path component — i.e. safe to join onto
/// a local directory. Rejects `.`, `..`, empty, absolute paths, and anything
/// containing a separator, so a hostile server listing can't traverse out of
/// (or write outside) the chosen download directory.
fn is_safe_component(name: &str) -> bool {
    use std::path::Component;
    let mut comps = std::path::Path::new(name).components();
    matches!(comps.next(), Some(Component::Normal(_))) && comps.next().is_none()
}

/// Expand a remote path into individual file downloads, creating local dirs as needed.
///
/// When `sanitize` is set, server-supplied path components are run through
/// [`crate::util::sanitize_filename`] so a hostile or odd name can't create an
/// illegal local path.
fn plan_download(
    fs: &mut dyn RemoteFs,
    remote: &str,
    local: &Path,
    is_dir: bool,
    sanitize: Option<&Sanitizer>,
) -> Result<Vec<FilePlan>> {
    if is_dir {
        std::fs::create_dir_all(local)?;
        let mut plans = Vec::new();
        for entry in fs.list(remote)? {
            let safe_name = match sanitize {
                Some((extra, repl)) => crate::util::sanitize_filename(&entry.name, extra, *repl),
                None => entry.name.clone(),
            };
            // Drop any server-supplied name that isn't a plain component: a
            // malicious server could otherwise smuggle `..` or an absolute path
            // and have us write outside the download directory. Always enforced,
            // regardless of the (opt-in) character sanitizer.
            if !is_safe_component(&safe_name) {
                continue;
            }
            let child_local = local.join(&safe_name);
            match entry.kind {
                EntryKind::Directory => {
                    plans.extend(plan_download(
                        fs,
                        &entry.path,
                        &child_local,
                        true,
                        sanitize,
                    )?);
                }
                _ => plans.push(FilePlan {
                    local: child_local.to_string_lossy().into_owned(),
                    remote: entry.path,
                    size: entry.size,
                }),
            }
        }
        Ok(plans)
    } else {
        Ok(vec![FilePlan {
            local: local.to_string_lossy().into_owned(),
            remote: remote.to_string(),
            size: 0, // filled in by the worker once the size is known
        }])
    }
}

/// Queue an upload (file or directory tree). Returns every queued transfer.
#[tauri::command]
pub async fn enqueue_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    resume: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<Transfer>> {
    let client = state
        .client(&session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.clone()))?;

    let plan_client = client.clone();
    let plans = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<FilePlan>> {
        let mut guard = plan_client.lock();
        plan_upload(&mut **guard, Path::new(&local_path), &remote_path)
    })
    .await
    .map_err(|e| Error::Remote(e.to_string()))??;

    Ok(enqueue_plans(
        &state,
        &app,
        &session_id,
        plans,
        TransferDirection::Upload,
        resume.unwrap_or(false),
    ))
}

/// Queue a download (file or directory tree). Returns every queued transfer.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // mirrors the download invocation + filename-filter settings
pub async fn enqueue_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    is_directory: bool,
    resume: Option<bool>,
    filename_filter_chars: Option<String>,
    filename_replacement: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<Transfer>> {
    let client = state
        .client(&session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.clone()))?;

    // Build a sanitizer only when the caller opted in (Some chars). The
    // replacement defaults to '_' and falls back to '_' for an empty/odd value.
    let sanitize: Option<Sanitizer> = filename_filter_chars.map(|chars| {
        let repl = filename_replacement
            .and_then(|s| s.chars().next())
            .unwrap_or('_');
        (chars, repl)
    });

    let plan_client = client.clone();
    let plans = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<FilePlan>> {
        let mut guard = plan_client.lock();
        plan_download(
            &mut **guard,
            &remote_path,
            Path::new(&local_path),
            is_directory,
            sanitize.as_ref(),
        )
    })
    .await
    .map_err(|e| Error::Remote(e.to_string()))??;

    Ok(enqueue_plans(
        &state,
        &app,
        &session_id,
        plans,
        TransferDirection::Download,
        resume.unwrap_or(false),
    ))
}

/// Turn a list of file plans into queued transfers and hand them to the scheduler.
fn enqueue_plans(
    state: &AppState,
    app: &AppHandle,
    session_id: &str,
    plans: Vec<FilePlan>,
    direction: TransferDirection,
    resume: bool,
) -> Vec<Transfer> {
    plans
        .into_iter()
        .map(|p| {
            let transfer = Transfer {
                id: Uuid::new_v4().to_string(),
                direction,
                name: file_name(if direction == TransferDirection::Upload {
                    &p.local
                } else {
                    &p.remote
                }),
                local_path: p.local,
                remote_path: p.remote,
                status: TransferStatus::Queued,
                bytes_transferred: 0,
                total_bytes: p.size,
                speed: 0,
                eta_seconds: None,
                error: None,
                scope: None,
                timestamp: Some(crate::util::now_rfc3339()),
                resume,
            };
            register_and_enqueue(state, app, session_id, transfer.clone());
            transfer
        })
        .collect()
}

fn register_and_enqueue(state: &AppState, app: &AppHandle, session_id: &str, transfer: Transfer) {
    let control = Arc::new(TransferControl::default());
    state
        .transfers
        .lock()
        .insert(transfer.id.clone(), transfer.clone());
    state
        .controls
        .lock()
        .insert(transfer.id.clone(), control.clone());
    transfer::enqueue(app, session_id, Pending { transfer, control });
}

/// Set the global download/upload speed caps (in KiB/s; 0 = unlimited). Applies
/// to transfers started after the change.
#[tauri::command]
pub fn set_speed_limits(
    download_kib: u64,
    upload_kib: u64,
    burst_secs: Option<f64>,
    momentary_speed: Option<bool>,
    state: State<'_, AppState>,
) -> Result<()> {
    let mut limits = state.speed_limits.lock();
    limits.download = download_kib.saturating_mul(1024);
    limits.upload = upload_kib.saturating_mul(1024);
    // Clamp to a sane range so a huge value can't defeat the limiter entirely.
    limits.burst_secs = burst_secs.unwrap_or(0.0).clamp(0.0, 30.0);
    limits.momentary_speed = momentary_speed.unwrap_or(false);
    Ok(())
}

#[tauri::command]
pub fn pause_transfer(id: String, state: State<'_, AppState>) -> Result<()> {
    set_control(&state, &id, PAUSED)
}

#[tauri::command]
pub fn resume_transfer(id: String, state: State<'_, AppState>) -> Result<()> {
    set_control(&state, &id, RUNNING)
}

#[tauri::command]
pub fn cancel_transfer(id: String, state: State<'_, AppState>) -> Result<()> {
    set_control(&state, &id, CANCELLED)
}

fn set_control(state: &AppState, id: &str, value: u8) -> Result<()> {
    state
        .controls
        .lock()
        .get(id)
        .ok_or_else(|| Error::TransferNotFound(id.to_string()))?
        .set(value);
    Ok(())
}

/// Return a snapshot of all transfers.
#[tauri::command]
pub fn list_transfers(state: State<'_, AppState>) -> Result<Vec<Transfer>> {
    Ok(state.transfers.lock().values().cloned().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DirEntry;
    use crate::protocols::ProgressFn;

    /// Minimal RemoteFs that records mkdir calls and serves a canned remote tree.
    #[derive(Default)]
    struct MockFs {
        mkdirs: Vec<String>,
        listings: std::collections::HashMap<String, Vec<DirEntry>>,
    }

    impl RemoteFs for MockFs {
        fn cwd(&mut self) -> Result<String> {
            Ok("/".into())
        }
        fn list(&mut self, path: &str) -> Result<Vec<DirEntry>> {
            Ok(self.listings.get(path).cloned().unwrap_or_default())
        }
        fn download(
            &mut self,
            _r: &str,
            _d: &Path,
            _resume: bool,
            _p: &mut ProgressFn,
        ) -> Result<()> {
            Ok(())
        }
        fn upload(
            &mut self,
            _s: &Path,
            _r: &str,
            _resume: bool,
            _p: &mut ProgressFn,
        ) -> Result<()> {
            Ok(())
        }
        fn mkdir(&mut self, path: &str) -> Result<()> {
            self.mkdirs.push(path.to_string());
            Ok(())
        }
    }

    fn dir(name: &str, path: &str) -> DirEntry {
        DirEntry {
            name: name.into(),
            path: path.into(),
            kind: EntryKind::Directory,
            size: 0,
            modified: None,
            permissions: None,
            owner: None,
        }
    }

    fn file(name: &str, path: &str, size: u64) -> DirEntry {
        DirEntry {
            name: name.into(),
            path: path.into(),
            kind: EntryKind::File,
            size,
            modified: None,
            permissions: None,
            owner: None,
        }
    }

    #[test]
    fn plan_upload_expands_directory_tree() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a.txt"), b"aaaa").unwrap();
        std::fs::create_dir(root.path().join("sub")).unwrap();
        std::fs::write(root.path().join("sub/b.txt"), b"bb").unwrap();

        let mut fs = MockFs::default();
        let mut plans = plan_upload(&mut fs, root.path(), "/remote").unwrap();
        plans.sort_by(|a, b| a.remote.cmp(&b.remote));

        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].remote, "/remote/a.txt");
        assert_eq!(plans[0].size, 4);
        assert_eq!(plans[1].remote, "/remote/sub/b.txt");
        assert_eq!(plans[1].size, 2);
        // Both the root and the nested directory must be created remotely.
        assert!(fs.mkdirs.contains(&"/remote".to_string()));
        assert!(fs.mkdirs.contains(&"/remote/sub".to_string()));
    }

    #[test]
    fn plan_upload_single_file_is_one_plan() {
        let root = tempfile::tempdir().unwrap();
        let f = root.path().join("only.bin");
        std::fs::write(&f, b"12345").unwrap();

        let mut fs = MockFs::default();
        let plans = plan_upload(&mut fs, &f, "/remote/only.bin").unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].size, 5);
        assert!(fs.mkdirs.is_empty(), "no mkdir for a single file");
    }

    #[test]
    fn plan_download_expands_remote_tree() {
        let dest = tempfile::tempdir().unwrap();
        let local_root = dest.path().join("site");

        let mut fs = MockFs::default();
        fs.listings.insert(
            "/srv".into(),
            vec![file("a.txt", "/srv/a.txt", 10), dir("sub", "/srv/sub")],
        );
        fs.listings
            .insert("/srv/sub".into(), vec![file("b.txt", "/srv/sub/b.txt", 20)]);

        let mut plans = plan_download(&mut fs, "/srv", &local_root, true, None).unwrap();
        plans.sort_by(|a, b| a.remote.cmp(&b.remote));

        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].remote, "/srv/a.txt");
        assert_eq!(plans[0].size, 10);
        assert_eq!(plans[1].remote, "/srv/sub/b.txt");
        assert_eq!(plans[1].size, 20);
        // Local directories were created.
        assert!(local_root.join("sub").is_dir());
    }

    #[test]
    fn plan_download_rejects_traversal_names() {
        let dest = tempfile::tempdir().unwrap();
        let local_root = dest.path().join("site");

        let mut fs = MockFs::default();
        fs.listings.insert(
            "/srv".into(),
            vec![
                file("../escape.txt", "/srv/../escape.txt", 1),
                file("/etc/evil", "/srv//etc/evil", 1),
                file("..", "/srv/..", 1),
                file("ok.txt", "/srv/ok.txt", 5),
            ],
        );

        // No sanitizer configured — the traversal guard must still apply.
        let plans = plan_download(&mut fs, "/srv", &local_root, true, None).unwrap();
        // Only the legitimate file survives; every traversal/absolute name dropped.
        assert_eq!(plans.len(), 1);
        assert!(plans[0].local.ends_with("ok.txt"));
        // The planned local path stays inside the chosen directory.
        assert!(std::path::Path::new(&plans[0].local).starts_with(&local_root));
    }

    #[test]
    fn is_safe_component_filters_dangerous_names() {
        assert!(is_safe_component("report.txt"));
        assert!(!is_safe_component(".."));
        assert!(!is_safe_component("."));
        assert!(!is_safe_component(""));
        assert!(!is_safe_component("/etc/passwd"));
        assert!(!is_safe_component("a/b"));
        assert!(!is_safe_component("../x"));
    }

    #[test]
    fn plan_download_sanitizes_server_names() {
        let dest = tempfile::tempdir().unwrap();
        let local_root = dest.path().join("site");

        let mut fs = MockFs::default();
        fs.listings
            .insert("/srv".into(), vec![file("a:b?.txt", "/srv/a:b?.txt", 3)]);

        let sanitize = (":?".to_string(), '_');
        let plans = plan_download(&mut fs, "/srv", &local_root, true, Some(&sanitize)).unwrap();
        assert_eq!(plans.len(), 1);
        assert!(
            plans[0].local.ends_with("a_b_.txt"),
            "illegal chars replaced: {}",
            plans[0].local
        );
        // The remote path is untouched — we still fetch the real file.
        assert_eq!(plans[0].remote, "/srv/a:b?.txt");
    }
}
