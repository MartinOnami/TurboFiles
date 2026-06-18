//! Data models shared across the backend and serialized to the frontend.
//!
//! These mirror `src/lib/types.ts`. All structs use `camelCase` on the wire to
//! match TypeScript conventions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Sftp,
    Ftp,
    Ftps,
}

/// FTP/FTPS encryption mode - mirrors FileZilla's Encryption dropdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FtpEncryption {
    /// Try explicit TLS (AUTH TLS); fall back to plain FTP on TLS failure.
    #[default]
    ExplicitTlsIfAvailable,
    /// Require explicit TLS - fail if the server does not support AUTH TLS.
    RequireExplicitTls,
    /// Require implicit TLS - TLS wraps the whole session (typically port 990).
    RequireImplicitTls,
    /// Plain FTP - no encryption.
    Plain,
}

/// Proxy type for tunnelling the control connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProxyType {
    #[default]
    None,
    Socks4,
    Socks5,
    Http,
}

/// Proxy configuration. Credentials are not persisted to SQLite - they arrive
/// per-connect from the frontend's in-memory settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(rename = "type")]
    pub kind: ProxyType,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

/// FTP data-connection mode (FileZilla "Transfer mode").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FtpMode {
    /// Library default (passive).
    #[default]
    Default,
    Active,
    Passive,
}

/// How the client authenticates - matches FileZilla's logon types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LogonType {
    /// Password auth with keyboard-interactive fallback (default).
    #[default]
    Normal,
    /// FTP anonymous login (username = "anonymous", password = "").
    Anonymous,
    /// Force keyboard-interactive SSH auth (for servers that require it).
    Interactive,
    /// SSH public-key auth; `private_key` must be supplied.
    Key,
}

/// Credentials provided at connect time. Never logged or persisted as-is.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRequest {
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub logon_type: LogonType,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    /// FTP/FTPS encryption mode (ignored for SFTP).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ftp_encryption: Option<FtpEncryption>,
    /// Accept a TLS certificate that fails verification (user trusted it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accept_invalid_cert: Option<bool>,
    /// TCP connect timeout in seconds (default 20).
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// Number of times to retry a failed *connection* (not auth). Default 0.
    #[serde(default)]
    pub retries: Option<u32>,
    /// Delay between connection retries, in seconds (default 5).
    #[serde(default)]
    pub retry_delay_secs: Option<u64>,
    /// FTP data-connection mode (ignored for SFTP).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ftp_mode: Option<FtpMode>,
    /// Optional proxy to tunnel the connection through.
    #[serde(default)]
    pub proxy: Option<ProxyConfig>,
    /// Previously-trusted SSH host-key fingerprint for this host (TOFU check).
    #[serde(default)]
    pub known_host_key: Option<String>,
    /// Minimum allowed TLS version for FTPS ("1.0".."1.3"; default 1.2).
    #[serde(default)]
    pub min_tls_version: Option<String>,
    /// Enable zlib compression for SFTP.
    #[serde(default)]
    pub sftp_compression: Option<bool>,
    /// Try the SSH agent (SSH_AUTH_SOCK) before password/key for SFTP.
    #[serde(default)]
    pub use_agent: Option<bool>,
    /// Periodically send FTP `NOOP` to keep an idle control connection alive.
    #[serde(default)]
    pub ftp_keep_alive: Option<bool>,
    /// Preallocate the full file size on disk before an SFTP download.
    #[serde(default)]
    pub preallocate: Option<bool>,
    /// Maximum simultaneous transfer connections for this session (default 1).
    #[serde(default)]
    pub max_concurrent: Option<u32>,
    /// Minutes to add to remote file timestamps to align them with local time.
    #[serde(default)]
    pub time_offset_minutes: Option<i32>,
    /// Filename charset handling: "utf8" forces UTF-8, anything else autodetects.
    #[serde(default)]
    pub encoding: Option<String>,
    /// FTP transfer representation: "auto" (default), "ascii", or "binary".
    #[serde(default)]
    pub ftp_data_type: Option<String>,
    /// Legacy FTP-protocol proxy: connect to this `host:port` and log in with a
    /// `user@ftphost` username (the "USER user@host" proxy style). Plain FTP only.
    #[serde(default)]
    pub ftp_proxy_host: Option<String>,
    #[serde(default)]
    pub ftp_proxy_port: Option<u16>,
}

/// A live session handle returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub protocol: Protocol,
    pub host: String,
    pub username: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
}

/// A directory entry, local or remote.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Queued,
    Transferring,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// A transfer queue item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub id: String,
    pub direction: TransferDirection,
    pub name: String,
    pub local_path: String,
    pub remote_path: String,
    pub status: TransferStatus,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub speed: u64,
    pub eta_seconds: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Session label this transfer belongs to (for per-site history filtering).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// When the transfer was queued / finished (ISO), for date grouping.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// Continue from an existing partial file instead of restarting.
    #[serde(default)]
    pub resume: bool,
}

/// A user-facing log line, persisted to history so it can be referenced later.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

/// Progress event payload emitted on `transfer://progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub id: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub speed: u64,
    pub eta_seconds: Option<u64>,
    pub status: TransferStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A saved connection profile. The secret lives in the OS keychain, never here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub logon_type: LogonType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_remote_path: Option<String>,
    /// Local directory to open in the left pane on connect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_local_path: Option<String>,
    /// Path to a private key file on disk, for SFTP Key logon. Not a secret.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub has_stored_secret: bool,
    /// FTP/FTPS encryption mode; None for SFTP or legacy sites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ftp_encryption: Option<FtpEncryption>,
    /// Whether the user opted to trust this server's (otherwise invalid) TLS cert.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accept_invalid_cert: Option<bool>,
    /// FTP data-connection mode (ignored for SFTP).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ftp_mode: Option<FtpMode>,
    /// Maximum simultaneous transfer connections for this site (caps the global default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_limit: Option<u32>,
    /// Minutes to add to remote file timestamps to align them with local time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone_offset_minutes: Option<i32>,
    /// Filename charset: "utf8" forces UTF-8, otherwise autodetect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    /// Skip the global proxy for this site (direct connection).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypass_proxy: Option<bool>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}
