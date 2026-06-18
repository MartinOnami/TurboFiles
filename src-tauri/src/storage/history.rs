//! Durable history: every user-facing log line and every finished transfer is
//! written to SQLite so it can be referenced across restarts. Nothing here is a
//! secret (those live in the keychain).

use parking_lot::Mutex;
use rusqlite::{params, Connection};

use crate::error::Result;
use crate::models::{LogEntry, Transfer, TransferDirection, TransferStatus};

pub struct HistoryStore {
    conn: Mutex<Connection>,
}

impl HistoryStore {
    /// Open (creating if needed) the history database and run migrations.
    pub fn open(path: &std::path::Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.lock().execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS logs (
                seq       INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                level     TEXT NOT NULL,
                message   TEXT NOT NULL,
                scope     TEXT
            );
            CREATE TABLE IF NOT EXISTS transfer_history (
                id            TEXT PRIMARY KEY,
                direction     TEXT NOT NULL,
                name          TEXT NOT NULL,
                local_path    TEXT NOT NULL,
                remote_path   TEXT NOT NULL,
                status        TEXT NOT NULL,
                total_bytes   INTEGER NOT NULL,
                scope         TEXT,
                error         TEXT,
                finished_at   TEXT NOT NULL,
                seq           INTEGER
            );
            CREATE TABLE IF NOT EXISTS history_meta (k TEXT PRIMARY KEY, v INTEGER);
            "#,
        )?;
        Ok(())
    }

    // ── Logs ────────────────────────────────────────────────────────────────

    pub fn append_log(&self, entry: &LogEntry) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO logs (timestamp, level, message, scope) VALUES (?1,?2,?3,?4)",
            params![entry.timestamp, entry.level, entry.message, entry.scope],
        )?;
        Ok(())
    }

    /// Return the most recent `limit` log lines, oldest-first.
    pub fn list_logs(&self, limit: u32) -> Result<Vec<LogEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT timestamp, level, message, scope FROM logs ORDER BY seq DESC LIMIT ?1",
        )?;
        let mut rows = stmt
            .query_map(params![limit], |r| {
                Ok(LogEntry {
                    timestamp: r.get(0)?,
                    level: r.get(1)?,
                    message: r.get(2)?,
                    scope: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.reverse(); // oldest-first for display
        Ok(rows)
    }

    pub fn clear_logs(&self) -> Result<()> {
        self.conn.lock().execute("DELETE FROM logs", [])?;
        Ok(())
    }

    // ── Transfer history ──────────────────────────────────────────────────────

    /// Record (or update) a finished transfer. Upserts by id so re-runs/retries
    /// don't create duplicates.
    pub fn record_transfer(&self, t: &Transfer, finished_at: &str) -> Result<()> {
        let conn = self.conn.lock();
        let seq: i64 = conn
            .query_row(
                "SELECT COALESCE((SELECT v FROM history_meta WHERE k='seq'), 0) + 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or(1);
        conn.execute(
            "INSERT INTO history_meta (k, v) VALUES ('seq', ?1) \
             ON CONFLICT(k) DO UPDATE SET v=?1",
            params![seq],
        )?;
        conn.execute(
            "INSERT INTO transfer_history \
             (id, direction, name, local_path, remote_path, status, total_bytes, scope, error, finished_at, seq) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) \
             ON CONFLICT(id) DO UPDATE SET status=?6, total_bytes=?7, scope=?8, error=?9, finished_at=?10, seq=?11",
            params![
                t.id,
                direction_str(t.direction),
                t.name,
                t.local_path,
                t.remote_path,
                status_str(t.status),
                t.total_bytes as i64,
                t.scope,
                t.error,
                finished_at,
                seq,
            ],
        )?;
        Ok(())
    }

    /// Return the most recent `limit` finished transfers, oldest-first.
    pub fn list_transfers(&self, limit: u32) -> Result<Vec<Transfer>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, direction, name, local_path, remote_path, status, total_bytes, scope, error, finished_at \
             FROM transfer_history ORDER BY seq DESC LIMIT ?1",
        )?;
        let mut rows = stmt
            .query_map(params![limit], |r| {
                let total: i64 = r.get(6)?;
                Ok(Transfer {
                    id: r.get(0)?,
                    direction: parse_direction(&r.get::<_, String>(1)?),
                    name: r.get(2)?,
                    local_path: r.get(3)?,
                    remote_path: r.get(4)?,
                    status: parse_status(&r.get::<_, String>(5)?),
                    bytes_transferred: total as u64,
                    total_bytes: total as u64,
                    speed: 0,
                    eta_seconds: None,
                    error: r.get(8)?,
                    scope: r.get(7)?,
                    timestamp: r.get::<_, Option<String>>(9).unwrap_or(None),
                    resume: false,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.reverse();
        Ok(rows)
    }

    /// Purge finished transfers from history (completed/cancelled). Failed ones
    /// are kept so they remain retryable.
    pub fn clear_transfers(&self) -> Result<()> {
        self.conn.lock().execute(
            "DELETE FROM transfer_history WHERE status IN ('completed','cancelled')",
            [],
        )?;
        Ok(())
    }
}

fn direction_str(d: TransferDirection) -> &'static str {
    match d {
        TransferDirection::Upload => "upload",
        TransferDirection::Download => "download",
    }
}

fn parse_direction(s: &str) -> TransferDirection {
    match s {
        "upload" => TransferDirection::Upload,
        _ => TransferDirection::Download,
    }
}

fn status_str(s: TransferStatus) -> &'static str {
    match s {
        TransferStatus::Queued => "queued",
        TransferStatus::Transferring => "transferring",
        TransferStatus::Paused => "paused",
        TransferStatus::Completed => "completed",
        TransferStatus::Failed => "failed",
        TransferStatus::Cancelled => "cancelled",
    }
}

fn parse_status(s: &str) -> TransferStatus {
    match s {
        "completed" => TransferStatus::Completed,
        "failed" => TransferStatus::Failed,
        "cancelled" => TransferStatus::Cancelled,
        "paused" => TransferStatus::Paused,
        "transferring" => TransferStatus::Transferring,
        _ => TransferStatus::Queued,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_transfer(id: &str, status: TransferStatus) -> Transfer {
        Transfer {
            id: id.into(),
            direction: TransferDirection::Download,
            name: "file.bin".into(),
            local_path: "/tmp/file.bin".into(),
            remote_path: "/srv/file.bin".into(),
            status,
            bytes_transferred: 100,
            total_bytes: 100,
            speed: 0,
            eta_seconds: None,
            error: None,
            scope: Some("user@host".into()),
            timestamp: Some("2026-06-15T10:00:00Z".into()),
            resume: false,
        }
    }

    #[test]
    fn logs_round_trip_oldest_first() {
        let h = HistoryStore::in_memory().unwrap();
        for i in 0..3 {
            h.append_log(&LogEntry {
                timestamp: format!("t{i}"),
                level: "info".into(),
                message: format!("msg {i}"),
                scope: None,
            })
            .unwrap();
        }
        let logs = h.list_logs(10).unwrap();
        assert_eq!(logs.len(), 3);
        assert_eq!(logs[0].message, "msg 0");
        assert_eq!(logs[2].message, "msg 2");
    }

    #[test]
    fn transfer_history_upserts_by_id() {
        let h = HistoryStore::in_memory().unwrap();
        h.record_transfer(&sample_transfer("a", TransferStatus::Failed), "t1")
            .unwrap();
        h.record_transfer(&sample_transfer("a", TransferStatus::Completed), "t2")
            .unwrap();
        let rows = h.list_transfers(10).unwrap();
        assert_eq!(rows.len(), 1, "same id upserts, not duplicates");
        assert_eq!(rows[0].status, TransferStatus::Completed);
        assert_eq!(rows[0].scope.as_deref(), Some("user@host"));

        h.clear_transfers().unwrap();
        assert!(h.list_transfers(10).unwrap().is_empty());
    }
}
