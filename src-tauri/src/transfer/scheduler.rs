//! Per-session transfer scheduler.
//!
//! Each session owns a [`ConnectionPool`](super::ConnectionPool); a session runs
//! up to `pool.max()` transfers at once, each over its own pooled connection.
//! At the default `max == 1` this is the original sequential-over-one-connection
//! behaviour; raising it enables true concurrency.
//!
//! Transfers are queued FIFO per session; [`pump`] starts as many as the pool
//! allows and [`on_finished`] starts the next when one ends.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Manager};

use crate::models::{Transfer, TransferStatus};
use crate::state::AppState;

use super::{worker, TransferControl};

/// Default concurrency when a session's pool can't be found (defensive).
const FALLBACK_MAX: usize = 1;

/// A transfer waiting (or cleared) to run. The connection is taken from the
/// session pool by the worker when it starts.
pub struct Pending {
    pub transfer: Transfer,
    pub control: Arc<TransferControl>,
}

#[derive(Default)]
struct SessionQueue {
    queue: VecDeque<Pending>,
    running: usize,
}

/// FIFO queues keyed by session id.
#[derive(Default)]
pub struct Scheduler {
    sessions: Mutex<HashMap<String, SessionQueue>>,
}

/// Queue a transfer for its session and start it if a slot is free.
pub fn enqueue(app: &AppHandle, session_id: &str, pending: Pending) {
    if let Some(state) = app.try_state::<AppState>() {
        state
            .scheduler
            .sessions
            .lock()
            .entry(session_id.to_string())
            .or_default()
            .queue
            .push_back(pending);
        pump(app, session_id);
    }
}

/// Start as many queued transfers for `session_id` as the pool allows.
fn pump(app: &AppHandle, session_id: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Some(pool) = state.pool(session_id) else {
        return; // session gone
    };
    let max = pool.max().max(FALLBACK_MAX);
    loop {
        let pending = {
            let mut sessions = state.scheduler.sessions.lock();
            let Some(sq) = sessions.get_mut(session_id) else {
                return;
            };
            if sq.running >= max {
                return;
            }
            match sq.queue.pop_front() {
                Some(p) => {
                    sq.running += 1;
                    p
                }
                None => return,
            }
        };

        // Honour a cancel that arrived while the transfer was still queued.
        if pending.control.is_cancelled() {
            worker::finalize(app, &pending.transfer.id, TransferStatus::Cancelled, None);
            let mut sessions = state.scheduler.sessions.lock();
            if let Some(sq) = sessions.get_mut(session_id) {
                sq.running = sq.running.saturating_sub(1);
            }
            continue;
        }

        worker::spawn_transfer(
            app.clone(),
            session_id.to_string(),
            pool.clone(),
            pending.control,
            pending.transfer,
        );
    }
}

/// Called by a worker when its transfer ends: frees the slot and starts the next.
pub fn on_finished(app: &AppHandle, session_id: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        {
            let mut sessions = state.scheduler.sessions.lock();
            if let Some(sq) = sessions.get_mut(session_id) {
                sq.running = sq.running.saturating_sub(1);
            }
        }
        pump(app, session_id);
    }
}
