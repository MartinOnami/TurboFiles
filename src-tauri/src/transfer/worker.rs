//! Runs a single transfer on a blocking thread and streams progress to the UI.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::models::{Transfer, TransferDirection, TransferProgressEvent, TransferStatus};
use crate::state::AppState;

use super::{ConnectionPool, TransferControl};

/// Minimum interval between progress events, to avoid flooding the UI.
const EMIT_INTERVAL: Duration = Duration::from_millis(150);

/// Spawn a blocking task that performs `transfer` and emits `transfer://progress`.
///
/// Pause is honoured cooperatively (the worker blocks while paused). Cancel is
/// honoured before the byte stream starts; mid-stream cancel is on the roadmap.
pub fn spawn_transfer(
    app: AppHandle,
    session_id: String,
    pool: Arc<ConnectionPool>,
    control: Arc<TransferControl>,
    transfer: Transfer,
) {
    tauri::async_runtime::spawn_blocking(move || {
        if control.is_cancelled() {
            finalize(&app, &transfer.id, TransferStatus::Cancelled, None);
            super::scheduler::on_finished(&app, &session_id);
            return;
        }

        // Borrow a connection from the session pool (may open a new one). A
        // failure to obtain one fails just this transfer, not the session.
        let client = match pool.acquire() {
            Ok(Some(c)) => c,
            Ok(None) => {
                finalize(
                    &app,
                    &transfer.id,
                    TransferStatus::Failed,
                    Some("no connection available".into()),
                );
                super::scheduler::on_finished(&app, &session_id);
                return;
            }
            Err(e) => {
                finalize(
                    &app,
                    &transfer.id,
                    TransferStatus::Failed,
                    Some(e.to_string()),
                );
                super::scheduler::on_finished(&app, &session_id);
                return;
            }
        };
        set_status(&app, &transfer.id, TransferStatus::Transferring);

        // Snapshot the speed cap for this direction (bytes/sec; 0 = unlimited)
        // and the burst headroom (seconds of allowance above the cap).
        let (limit, burst_secs, momentary) = app
            .try_state::<AppState>()
            .map(|s| {
                let l = s.speed_limits.lock();
                let cap = match transfer.direction {
                    TransferDirection::Upload => l.upload,
                    TransferDirection::Download => l.download,
                };
                (cap, l.burst_secs, l.momentary_speed)
            })
            .unwrap_or((0, 0.0, false));

        let started = Instant::now();
        let mut last_emit = Instant::now();
        // Window anchor for instantaneous-speed reporting.
        let mut window = (Instant::now(), 0u64);
        let mut was_paused = false;
        let mut throttle_base: Option<u64> = None;
        let id = transfer.id.clone();
        let app_cb = app.clone();
        let ctrl = control.clone();

        let mut progress = move |done: u64, total: u64| -> bool {
            // Honour a cancel that arrived mid-stream: stop immediately.
            if ctrl.is_cancelled() {
                return false;
            }

            // Speed limiting: if we're ahead of the allowed byte budget for the
            // elapsed time, sleep just enough to stay under the cap.
            if limit > 0 {
                let base = *throttle_base.get_or_insert(done);
                let transferred = done.saturating_sub(base) as f64;
                // Burst headroom lets the transfer run `burst_secs` worth of bytes
                // ahead of the strict budget before we start throttling.
                let allowed = limit as f64 * (started.elapsed().as_secs_f64() + burst_secs);
                if transferred > allowed {
                    let sleep = ((transferred - allowed) / limit as f64).min(0.5);
                    std::thread::sleep(Duration::from_secs_f64(sleep));
                }
            }

            // Keep canonical state up-to-date so finalize() sees the real sizes.
            if let Some(state) = app_cb.try_state::<AppState>() {
                if let Some(t) = state.transfers.lock().get_mut(&id) {
                    t.bytes_transferred = done;
                    if total > t.total_bytes {
                        t.total_bytes = total;
                    }
                }
            }

            // Detect entering pause - emit Paused once.
            if ctrl.is_paused() && !ctrl.is_cancelled() && !was_paused {
                was_paused = true;
                if let Some(state) = app_cb.try_state::<AppState>() {
                    if let Some(t) = state.transfers.lock().get_mut(&id) {
                        t.status = TransferStatus::Paused;
                    }
                }
                emit(
                    &app_cb,
                    TransferProgressEvent {
                        id: id.clone(),
                        bytes_transferred: done,
                        total_bytes: total,
                        speed: 0,
                        eta_seconds: None,
                        status: TransferStatus::Paused,
                        error: None,
                    },
                );
            }

            // Block while paused (poll every 100ms); abort the wait on cancel.
            while ctrl.is_paused() && !ctrl.is_cancelled() {
                std::thread::sleep(Duration::from_millis(100));
            }
            // Cancelled while paused → abort now.
            if ctrl.is_cancelled() {
                return false;
            }

            // Detect resume - emit Transferring once, reset throttle.
            if was_paused {
                was_paused = false;
                if let Some(state) = app_cb.try_state::<AppState>() {
                    if let Some(t) = state.transfers.lock().get_mut(&id) {
                        t.status = TransferStatus::Transferring;
                    }
                }
                emit(
                    &app_cb,
                    TransferProgressEvent {
                        id: id.clone(),
                        bytes_transferred: done,
                        total_bytes: total,
                        speed: 0,
                        eta_seconds: None,
                        status: TransferStatus::Transferring,
                        error: None,
                    },
                );
                last_emit = Instant::now();
                return true;
            }

            if last_emit.elapsed() < EMIT_INTERVAL && done < total {
                return true;
            }
            last_emit = Instant::now();
            let speed = if momentary {
                // Instantaneous: bytes since the last window anchor over its span.
                let (anchor_t, anchor_done) = window;
                let span = anchor_t.elapsed().as_secs_f64().max(0.001);
                let s = (done.saturating_sub(anchor_done) as f64 / span) as u64;
                window = (Instant::now(), done);
                s
            } else {
                let secs = started.elapsed().as_secs_f64().max(0.001);
                (done as f64 / secs) as u64
            };
            let eta = if speed > 0 && total >= done {
                Some((total - done) / speed.max(1))
            } else {
                None
            };
            emit(
                &app_cb,
                TransferProgressEvent {
                    id: id.clone(),
                    bytes_transferred: done,
                    total_bytes: total,
                    speed,
                    eta_seconds: eta,
                    status: TransferStatus::Transferring,
                    error: None,
                },
            );
            true
        };

        // Run the transfer inside catch_unwind so a panic in a protocol impl
        // can't bypass the connection release / slot free below (which would
        // otherwise leak a pool connection and wedge the session's queue).
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut guard = client.lock();
            match transfer.direction {
                TransferDirection::Upload => guard.upload(
                    std::path::Path::new(&transfer.local_path),
                    &transfer.remote_path,
                    transfer.resume,
                    &mut progress,
                ),
                TransferDirection::Download => guard.download(
                    &transfer.remote_path,
                    std::path::Path::new(&transfer.local_path),
                    transfer.resume,
                    &mut progress,
                ),
            }
        }));
        let result = match outcome {
            Ok(r) => r,
            Err(_) => Err(crate::error::Error::Remote(
                "transfer worker panicked".into(),
            )),
        };

        // A cancel flag wins regardless of how the transfer loop returned (it may
        // have broken out early with Ok, leaving a partial file).
        if control.is_cancelled() {
            finalize(&app, &transfer.id, TransferStatus::Cancelled, None);
        } else {
            match result {
                Ok(()) => finalize(&app, &transfer.id, TransferStatus::Completed, None),
                Err(e) => finalize(
                    &app,
                    &transfer.id,
                    TransferStatus::Failed,
                    Some(e.to_string()),
                ),
            }
        }
        // Return the connection to the pool for reuse, then free the session
        // slot and let the next queued transfer start.
        pool.release(client);
        super::scheduler::on_finished(&app, &session_id);
    });
}

fn set_status(app: &AppHandle, id: &str, status: TransferStatus) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Some(t) = state.transfers.lock().get_mut(id) {
            t.status = status;
        }
    }
}

pub(super) fn finalize(app: &AppHandle, id: &str, status: TransferStatus, error: Option<String>) {
    let mut total = 0;
    let mut done = 0;
    if let Some(state) = app.try_state::<AppState>() {
        if let Some(t) = state.transfers.lock().get_mut(id) {
            t.status = status;
            t.error = error.clone();
            if status == TransferStatus::Completed {
                t.bytes_transferred = t.total_bytes;
            }
            total = t.total_bytes;
            done = t.bytes_transferred;
        }
    }
    emit(
        app,
        TransferProgressEvent {
            id: id.to_string(),
            bytes_transferred: done,
            total_bytes: total,
            speed: 0,
            eta_seconds: None,
            status,
            error,
        },
    );
}

fn emit(app: &AppHandle, payload: TransferProgressEvent) {
    let _ = app.emit("transfer://progress", payload);
}
