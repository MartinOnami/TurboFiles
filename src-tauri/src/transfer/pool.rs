//! Per-session connection pool for concurrent transfers.
//!
//! A session keeps one *interactive* connection (used by browse/list/delete and
//! seeded as the pool's first member) plus up to `max - 1` additional transfer
//! connections, minted lazily from the stored [`ConnectionRequest`] only when
//! the user enables concurrency (`max > 1`). At the default `max == 1` the pool
//! never opens a second connection, so behaviour matches the original
//! single-connection design exactly.
//!
//! The stored request carries credentials in memory for the session's lifetime
//! (never persisted) so extra connections can re-authenticate - the same
//! in-memory-secret tradeoff already used for the proxy password.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

use crate::error::Result;
use crate::models::ConnectionRequest;
use crate::state::SharedClient;

/// A pool of reusable connections for one session.
pub struct ConnectionPool {
    request: ConnectionRequest,
    /// Maximum number of simultaneously-open connections (>= 1).
    max: usize,
    idle: Mutex<Vec<SharedClient>>,
    /// Count of connections currently checked out or sitting idle.
    open: Mutex<usize>,
    /// Set once the session disconnects; stops minting and makes `release`
    /// close (rather than re-pool) any still-in-flight connection.
    closed: AtomicBool,
}

impl ConnectionPool {
    /// Create a pool seeded with the session's interactive `primary` connection.
    pub fn new(request: ConnectionRequest, max: usize, primary: SharedClient) -> Arc<Self> {
        Arc::new(Self {
            request,
            max: max.max(1),
            idle: Mutex::new(vec![primary]),
            open: Mutex::new(1),
            closed: AtomicBool::new(false),
        })
    }

    /// Maximum concurrent transfers this pool allows.
    pub fn max(&self) -> usize {
        self.max
    }

    /// Borrow a connection: reuse an idle one, otherwise mint a new one when
    /// under `max`. Returns `Ok(None)` at capacity, or once the pool is closed
    /// (so a transfer racing a disconnect fails instead of opening a connection
    /// against a torn-down session).
    ///
    /// Minting performs a blocking connect, so call this from a worker thread.
    pub fn acquire(&self) -> Result<Option<SharedClient>> {
        if self.closed.load(Ordering::SeqCst) {
            return Ok(None);
        }
        if let Some(c) = self.idle.lock().pop() {
            return Ok(Some(c));
        }
        {
            let mut open = self.open.lock();
            // Re-check under the lock: a disconnect may have landed since the
            // early check, and we must not mint into a closed pool.
            if self.closed.load(Ordering::SeqCst) || *open >= self.max {
                return Ok(None);
            }
            // Reserve the slot before the slow connect so concurrent acquirers
            // don't overshoot `max`.
            *open += 1;
        }
        match crate::protocols::connect(&self.request) {
            Ok(client) => Ok(Some(Arc::new(Mutex::new(client)))),
            Err(e) => {
                // Release the reserved slot on failure so a retry can try again.
                *self.open.lock() -= 1;
                Err(e)
            }
        }
    }

    /// Return a connection after use. If the pool has been closed (the session
    /// disconnected while this transfer was running) the connection is closed
    /// here rather than re-pooled - otherwise it would leak as a zombie session.
    pub fn release(&self, client: SharedClient) {
        if self.closed.load(Ordering::SeqCst) {
            let _ = client.lock().disconnect();
        } else {
            self.idle.lock().push(client);
        }
    }

    /// Mark the pool closed and close every idle connection. Connections still
    /// checked out by a running transfer are closed by [`release`] when that
    /// transfer finishes, so none are leaked.
    pub fn disconnect_all(&self) {
        self.closed.store(true, Ordering::SeqCst);
        for c in self.idle.lock().drain(..) {
            let _ = c.lock().disconnect();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionRequest, LogonType, Protocol};
    use crate::protocols::{ProgressFn, RemoteFs};
    use std::path::Path;

    /// A no-op client that records whether `disconnect` was called, so tests can
    /// assert the pool tears connections down rather than leaking them.
    #[derive(Default)]
    struct DummyClient {
        disconnected: std::sync::Arc<std::sync::atomic::AtomicBool>,
    }
    impl RemoteFs for DummyClient {
        fn cwd(&mut self) -> crate::error::Result<String> {
            Ok("/".into())
        }
        fn list(&mut self, _: &str) -> crate::error::Result<Vec<crate::models::DirEntry>> {
            Ok(vec![])
        }
        fn download(
            &mut self,
            _: &str,
            _: &Path,
            _: bool,
            _: &mut ProgressFn,
        ) -> crate::error::Result<()> {
            Ok(())
        }
        fn upload(
            &mut self,
            _: &Path,
            _: &str,
            _: bool,
            _: &mut ProgressFn,
        ) -> crate::error::Result<()> {
            Ok(())
        }
        fn disconnect(&mut self) -> crate::error::Result<()> {
            self.disconnected.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    fn dummy_request() -> ConnectionRequest {
        ConnectionRequest {
            protocol: Protocol::Sftp,
            host: "127.0.0.1".into(),
            port: 22,
            username: "u".into(),
            logon_type: LogonType::Normal,
            password: None,
            private_key: None,
            passphrase: None,
            ftp_encryption: None,
            accept_invalid_cert: None,
            timeout_secs: None,
            retries: None,
            retry_delay_secs: None,
            ftp_mode: None,
            proxy: None,
            known_host_key: None,
            min_tls_version: None,
            sftp_compression: None,
            use_agent: None,
            ftp_keep_alive: None,
            preallocate: None,
            max_concurrent: None,
            time_offset_minutes: None,
            encoding: None,
            ftp_data_type: None,
            ftp_proxy_host: None,
            ftp_proxy_port: None,
        }
    }

    #[test]
    fn reuses_idle_connection_without_minting() {
        let primary: SharedClient = Arc::new(Mutex::new(Box::new(DummyClient::default())));
        let pool = ConnectionPool::new(dummy_request(), 3, primary);
        assert_eq!(pool.max(), 3);

        // First acquire pops the seeded primary - no network connect involved.
        let c = pool.acquire().expect("acquire").expect("a connection");
        // Returning and re-acquiring reuses the same idle connection (still no
        // mint, since we release before asking again).
        pool.release(c);
        let c2 = pool.acquire().expect("acquire").expect("a connection");
        pool.release(c2);
    }

    #[test]
    fn max_is_at_least_one() {
        let primary: SharedClient = Arc::new(Mutex::new(Box::new(DummyClient::default())));
        let pool = ConnectionPool::new(dummy_request(), 0, primary);
        assert_eq!(pool.max(), 1);
    }

    #[test]
    fn closing_disconnects_idle_and_stops_minting() {
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let primary: SharedClient = Arc::new(Mutex::new(Box::new(DummyClient {
            disconnected: flag.clone(),
        })));
        let pool = ConnectionPool::new(dummy_request(), 3, primary);

        pool.disconnect_all();
        // The idle (primary) connection was closed, not leaked.
        assert!(
            flag.load(Ordering::SeqCst),
            "idle connection should be disconnected"
        );
        // A closed pool never hands out (or mints) connections.
        assert!(pool.acquire().expect("acquire ok").is_none());
    }

    #[test]
    fn releasing_into_a_closed_pool_disconnects_the_connection() {
        let primary: SharedClient = Arc::new(Mutex::new(Box::new(DummyClient::default())));
        let pool = ConnectionPool::new(dummy_request(), 3, primary);

        // Check a connection out *before* closing (mimics an in-flight transfer).
        let in_flight = pool.acquire().expect("acquire").expect("a connection");
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        // Swap in a recording client to observe the disconnect on release.
        let recording: SharedClient = Arc::new(Mutex::new(Box::new(DummyClient {
            disconnected: flag.clone(),
        })));
        drop(in_flight);

        pool.disconnect_all();
        // The worker finishes after disconnect and returns its connection: the
        // pool must close it rather than re-pool it.
        pool.release(recording);
        assert!(
            flag.load(Ordering::SeqCst),
            "released connection should be disconnected"
        );
    }
}
