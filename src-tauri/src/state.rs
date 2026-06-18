//! Global application state shared across Tauri commands.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::models::{Session, Transfer};
use crate::protocols::RemoteFs;
use crate::storage::{HistoryStore, SiteStore};
use crate::transfer::{ConnectionPool, Scheduler, TransferControl};

/// A connected client guarded for cross-thread access.
pub type SharedClient = Arc<Mutex<Box<dyn RemoteFs>>>;

/// Application-wide state, managed by Tauri (`app.manage(...)`).
pub struct AppState {
    pub sessions: Mutex<HashMap<String, SessionEntry>>,
    pub transfers: Mutex<HashMap<String, Transfer>>,
    pub controls: Mutex<HashMap<String, Arc<TransferControl>>>,
    pub scheduler: Scheduler,
    pub sites: SiteStore,
    pub history: HistoryStore,
    /// Per-direction transfer speed limits in bytes/sec (0 = unlimited).
    pub speed_limits: Mutex<SpeedLimits>,
    /// Handle to the running OS "stay awake" helper, if prevent-sleep is active.
    pub sleep_guard: Mutex<Option<std::process::Child>>,
    /// Open file that log lines are mirrored to, when "log to file" is enabled.
    pub log_file: Mutex<Option<std::fs::File>>,
}

/// Download/upload speed caps in bytes per second (0 means no limit).
#[derive(Debug, Clone, Copy, Default)]
pub struct SpeedLimits {
    pub download: u64,
    pub upload: u64,
    /// Seconds of headroom the limiter tolerates as a short burst above the cap
    /// (0 = strict). A transfer may briefly exceed the limit by `burst_secs *
    /// limit` bytes before being throttled back.
    pub burst_secs: f64,
    /// Report instantaneous (windowed) transfer speed instead of the average.
    pub momentary_speed: bool,
}

pub struct SessionEntry {
    pub meta: Session,
    /// The interactive connection (browse/list/delete). Also the pool's first member.
    pub client: SharedClient,
    /// Connection pool used by the transfer scheduler for concurrency.
    pub pool: Arc<ConnectionPool>,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> crate::error::Result<Self> {
        // History lives in a sibling DB file so its writes never contend with
        // the site store (e.g. "turbofiles.sqlite" → "turbofiles-history.sqlite").
        let history_path = db_path.with_file_name(format!(
            "{}-history.sqlite",
            db_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("turbofiles")
        ));
        Ok(Self {
            sessions: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
            controls: Mutex::new(HashMap::new()),
            scheduler: Scheduler::default(),
            sites: SiteStore::open(&db_path)?,
            history: HistoryStore::open(&history_path)?,
            speed_limits: Mutex::new(SpeedLimits::default()),
            sleep_guard: Mutex::new(None),
            log_file: Mutex::new(None),
        })
    }

    /// Look up a connected client by session id.
    pub fn client(&self, session_id: &str) -> Option<SharedClient> {
        self.sessions
            .lock()
            .get(session_id)
            .map(|e| e.client.clone())
    }

    /// Look up a session's connection pool by session id.
    pub fn pool(&self, session_id: &str) -> Option<Arc<ConnectionPool>> {
        self.sessions.lock().get(session_id).map(|e| e.pool.clone())
    }
}
