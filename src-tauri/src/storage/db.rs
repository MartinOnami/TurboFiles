//! SQLite-backed Site Manager.
//!
//! Stores connection *profiles* only — never secrets (those go to the keychain,
//! see [`super::keychain`]). The store is wrapped in a mutex so it can be shared
//! across Tauri command threads.

use parking_lot::Mutex;
use rusqlite::{params, Connection};

use crate::error::Result;
use crate::models::{FtpEncryption, FtpMode, LogonType, Protocol, Site};

pub struct SiteStore {
    conn: Mutex<Connection>,
}

impl SiteStore {
    /// Open (creating if needed) the database at `path` and run migrations.
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

    /// In-memory store for tests.
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
        let conn = self.conn.lock();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sites (
                id                  TEXT PRIMARY KEY,
                name                TEXT NOT NULL,
                protocol            TEXT NOT NULL,
                host                TEXT NOT NULL,
                port                INTEGER NOT NULL,
                username            TEXT NOT NULL,
                default_remote_path TEXT,
                has_stored_secret   INTEGER NOT NULL DEFAULT 0,
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            );
            "#,
        )?;
        // Additive migrations — ignore "duplicate column" errors from previous runs.
        let _ = conn.execute_batch(
            "ALTER TABLE sites ADD COLUMN logon_type TEXT NOT NULL DEFAULT 'normal'",
        );
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN ftp_encryption TEXT");
        let _ = conn.execute_batch(
            "ALTER TABLE sites ADD COLUMN accept_invalid_cert INTEGER NOT NULL DEFAULT 0",
        );
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN private_key_path TEXT");
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN default_local_path TEXT");
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN ftp_mode TEXT");
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN connection_limit INTEGER");
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN timezone_offset_minutes INTEGER");
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN encoding TEXT");
        let _ = conn.execute_batch("ALTER TABLE sites ADD COLUMN bypass_proxy INTEGER");
        // Trust-on-first-use SSH host keys, keyed by "host:port".
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS known_hosts (hostport TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)",
        )?;
        Ok(())
    }

    /// The trusted SSH host-key fingerprint for `host:port`, if any.
    pub fn known_host(&self, hostport: &str) -> Result<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT fingerprint FROM known_hosts WHERE hostport = ?1")?;
        let mut rows = stmt.query_map(params![hostport], |r| r.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    /// Persist the trusted host-key fingerprint for `host:port` (upsert).
    pub fn set_known_host(&self, hostport: &str, fingerprint: &str) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO known_hosts (hostport, fingerprint) VALUES (?1, ?2) \
             ON CONFLICT(hostport) DO UPDATE SET fingerprint = ?2",
            params![hostport, fingerprint],
        )?;
        Ok(())
    }

    /// Forget the trusted host key for `host:port` (used to re-trust a rotated key).
    pub fn forget_known_host(&self, hostport: &str) -> Result<()> {
        self.conn.lock().execute(
            "DELETE FROM known_hosts WHERE hostport = ?1",
            params![hostport],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Site>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, protocol, host, port, username, default_remote_path, \
             has_stored_secret, created_at, updated_at, logon_type, ftp_encryption, \
             accept_invalid_cert, private_key_path, default_local_path, ftp_mode, connection_limit, \
             timezone_offset_minutes, encoding, bypass_proxy \
             FROM sites ORDER BY name",
        )?;
        let rows = stmt
            .query_map([], Self::row_to_site)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Map a `sites` row (in the canonical column order) to a [`Site`].
    fn row_to_site(r: &rusqlite::Row) -> rusqlite::Result<Site> {
        Ok(Site {
            id: r.get(0)?,
            name: r.get(1)?,
            protocol: parse_protocol(&r.get::<_, String>(2)?),
            host: r.get(3)?,
            port: r.get(4)?,
            username: r.get(5)?,
            default_remote_path: r.get(6)?,
            has_stored_secret: r.get::<_, i64>(7)? != 0,
            created_at: r.get(8)?,
            updated_at: r.get(9)?,
            logon_type: parse_logon_type(&r.get::<_, String>(10).unwrap_or_default()),
            ftp_encryption: r
                .get::<_, Option<String>>(11)?
                .as_deref()
                .and_then(parse_ftp_encryption),
            accept_invalid_cert: Some(r.get::<_, i64>(12).unwrap_or(0) != 0),
            private_key_path: r.get::<_, Option<String>>(13).unwrap_or(None),
            default_local_path: r.get::<_, Option<String>>(14).unwrap_or(None),
            ftp_mode: r
                .get::<_, Option<String>>(15)
                .unwrap_or(None)
                .as_deref()
                .and_then(parse_ftp_mode),
            connection_limit: r
                .get::<_, Option<i64>>(16)
                .unwrap_or(None)
                .map(|n| n as u32),
            timezone_offset_minutes: r
                .get::<_, Option<i64>>(17)
                .unwrap_or(None)
                .map(|n| n as i32),
            encoding: r.get::<_, Option<String>>(18).unwrap_or(None),
            bypass_proxy: r.get::<_, Option<i64>>(19).unwrap_or(None).map(|n| n != 0),
        })
    }

    /// Insert or update a site, returning the persisted record.
    pub fn upsert(&self, mut site: Site) -> Result<Site> {
        let now = crate::util::now_rfc3339();
        if site.id.is_empty() {
            site.id = uuid::Uuid::new_v4().to_string();
            site.created_at = now.clone();
        }
        site.updated_at = now;
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sites (id, name, protocol, host, port, username, default_remote_path, \
             has_stored_secret, created_at, updated_at, logon_type, ftp_encryption, accept_invalid_cert, \
             private_key_path, default_local_path, ftp_mode, connection_limit, \
             timezone_offset_minutes, encoding, bypass_proxy) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20) \
             ON CONFLICT(id) DO UPDATE SET name=?2, protocol=?3, host=?4, port=?5, username=?6, \
             default_remote_path=?7, has_stored_secret=?8, updated_at=?10, logon_type=?11, \
             ftp_encryption=?12, accept_invalid_cert=?13, private_key_path=?14, default_local_path=?15, \
             ftp_mode=?16, connection_limit=?17, timezone_offset_minutes=?18, encoding=?19, bypass_proxy=?20",
            params![
                site.id,
                site.name,
                protocol_str(site.protocol),
                site.host,
                site.port,
                site.username,
                site.default_remote_path,
                site.has_stored_secret as i64,
                site.created_at,
                site.updated_at,
                logon_type_str(site.logon_type),
                site.ftp_encryption.map(ftp_encryption_str),
                site.accept_invalid_cert.unwrap_or(false) as i64,
                site.private_key_path,
                site.default_local_path,
                site.ftp_mode.map(ftp_mode_str),
                site.connection_limit.map(|n| n as i64),
                site.timezone_offset_minutes.map(|n| n as i64),
                site.encoding,
                site.bypass_proxy.map(|b| b as i64),
            ],
        )?;
        Ok(site)
    }

    pub fn get(&self, id: &str) -> Result<Option<Site>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, protocol, host, port, username, default_remote_path, \
             has_stored_secret, created_at, updated_at, logon_type, ftp_encryption, \
             accept_invalid_cert, private_key_path, default_local_path, ftp_mode, connection_limit, \
             timezone_offset_minutes, encoding, bypass_proxy \
             FROM sites WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_site)?;
        Ok(rows.next().transpose()?)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        self.conn
            .lock()
            .execute("DELETE FROM sites WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn protocol_str(p: Protocol) -> &'static str {
    match p {
        Protocol::Sftp => "sftp",
        Protocol::Ftp => "ftp",
        Protocol::Ftps => "ftps",
    }
}

fn parse_protocol(s: &str) -> Protocol {
    match s {
        "ftp" => Protocol::Ftp,
        "ftps" => Protocol::Ftps,
        _ => Protocol::Sftp,
    }
}

fn logon_type_str(t: LogonType) -> &'static str {
    match t {
        LogonType::Normal => "normal",
        LogonType::Anonymous => "anonymous",
        LogonType::Interactive => "interactive",
        LogonType::Key => "key",
    }
}

fn parse_logon_type(s: &str) -> LogonType {
    match s {
        "anonymous" => LogonType::Anonymous,
        "interactive" => LogonType::Interactive,
        "key" => LogonType::Key,
        _ => LogonType::Normal,
    }
}

fn ftp_encryption_str(e: FtpEncryption) -> &'static str {
    match e {
        FtpEncryption::ExplicitTlsIfAvailable => "explicit_tls_if_available",
        FtpEncryption::RequireExplicitTls => "require_explicit_tls",
        FtpEncryption::RequireImplicitTls => "require_implicit_tls",
        FtpEncryption::Plain => "plain",
    }
}

fn ftp_mode_str(m: FtpMode) -> &'static str {
    match m {
        FtpMode::Default => "default",
        FtpMode::Active => "active",
        FtpMode::Passive => "passive",
    }
}

fn parse_ftp_mode(s: &str) -> Option<FtpMode> {
    match s {
        "active" => Some(FtpMode::Active),
        "passive" => Some(FtpMode::Passive),
        "default" => Some(FtpMode::Default),
        _ => None,
    }
}

fn parse_ftp_encryption(s: &str) -> Option<FtpEncryption> {
    match s {
        "explicit_tls_if_available" => Some(FtpEncryption::ExplicitTlsIfAvailable),
        "require_explicit_tls" => Some(FtpEncryption::RequireExplicitTls),
        "require_implicit_tls" => Some(FtpEncryption::RequireImplicitTls),
        "plain" => Some(FtpEncryption::Plain),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LogonType, Protocol, Site};

    fn sample() -> Site {
        Site {
            id: String::new(),
            name: "Test".into(),
            protocol: Protocol::Sftp,
            host: "example.com".into(),
            port: 22,
            username: "user".into(),
            logon_type: LogonType::Normal,
            default_remote_path: Some("/srv".into()),
            default_local_path: Some("/home/user".into()),
            ftp_encryption: None,
            ftp_mode: None,
            connection_limit: None,
            timezone_offset_minutes: None,
            encoding: None,
            bypass_proxy: None,
            accept_invalid_cert: None,
            private_key_path: None,
            has_stored_secret: true,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn insert_list_update_delete() {
        let store = SiteStore::in_memory().unwrap();
        assert!(store.list().unwrap().is_empty());

        let saved = store.upsert(sample()).unwrap();
        assert!(!saved.id.is_empty(), "id should be generated");
        assert_eq!(store.list().unwrap().len(), 1);

        let mut updated = saved.clone();
        updated.name = "Renamed".into();
        let updated = store.upsert(updated).unwrap();
        assert_eq!(updated.id, saved.id, "id is stable across updates");
        let rows = store.list().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Renamed");

        store.delete(&saved.id).unwrap();
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn advanced_site_fields_round_trip() {
        let store = SiteStore::in_memory().unwrap();
        let mut site = sample();
        site.connection_limit = Some(4);
        site.timezone_offset_minutes = Some(-90);
        site.encoding = Some("utf8".into());
        site.bypass_proxy = Some(true);

        let saved = store.upsert(site).unwrap();
        let got = store.get(&saved.id).unwrap().expect("site exists");
        assert_eq!(got.connection_limit, Some(4));
        assert_eq!(got.timezone_offset_minutes, Some(-90));
        assert_eq!(got.encoding.as_deref(), Some("utf8"));
        assert_eq!(got.bypass_proxy, Some(true));
    }

    #[test]
    fn known_hosts_tofu() {
        let store = SiteStore::in_memory().unwrap();
        assert_eq!(store.known_host("h:22").unwrap(), None);

        store.set_known_host("h:22", "SHA256:abc").unwrap();
        assert_eq!(
            store.known_host("h:22").unwrap().as_deref(),
            Some("SHA256:abc")
        );

        // Re-trusting a rotated key overwrites the fingerprint.
        store.set_known_host("h:22", "SHA256:def").unwrap();
        assert_eq!(
            store.known_host("h:22").unwrap().as_deref(),
            Some("SHA256:def")
        );

        store.forget_known_host("h:22").unwrap();
        assert_eq!(store.known_host("h:22").unwrap(), None);
    }
}
