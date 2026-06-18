/**
 * Shared types mirroring the Rust backend's serde models (see src-tauri/src/models.rs).
 * Keep these in sync; the contract is documented in docs/API.md.
 */

export type Protocol = "sftp" | "ftp" | "ftps";

/**
 * FTP/FTPS encryption mode — mirrors FileZilla's Encryption dropdown.
 * Only relevant for Protocol "ftp" (and legacy "ftps").
 */
export type FtpEncryption =
  | "explicit_tls_if_available"
  | "require_explicit_tls"
  | "require_implicit_tls"
  | "plain";

/** FTP data-connection mode (FileZilla "Transfer mode"). */
export type FtpMode = "default" | "active" | "passive";

export type ProxyType = "none" | "socks4" | "socks5" | "http";

/** Proxy config sent per-connect. The password is never persisted to disk. */
export interface ProxyConfig {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * How the client authenticates — matches FileZilla's logon types.
 * "normal"      — password with keyboard-interactive fallback (default)
 * "anonymous"   — FTP anonymous login
 * "interactive" — force SSH keyboard-interactive only
 * "key"         — SSH public-key auth (privateKey must be supplied)
 */
export type LogonType = "normal" | "anonymous" | "interactive" | "key";

/** A saved connection profile. The password is never returned to the frontend. */
export interface Site {
  id: string;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  logonType: LogonType;
  /** FTP/FTPS encryption mode (absent for SFTP or legacy sites). */
  ftpEncryption?: FtpEncryption;
  /** FTP data-connection mode (absent for SFTP). */
  ftpMode?: FtpMode;
  /** Maximum simultaneous transfer connections for this site (caps the global default). */
  connectionLimit?: number;
  /** Minutes to add to remote file timestamps to align them with local time. */
  timezoneOffsetMinutes?: number;
  /** Filename charset: "utf8" forces UTF-8, otherwise autodetect. */
  encoding?: string;
  /** Skip the global proxy for this site (direct connection). */
  bypassProxy?: boolean;
  /** Whether the user opted to trust this server's otherwise-invalid TLS cert. */
  acceptInvalidCert?: boolean;
  /** Path to a private key file on disk, for SFTP Key logon. */
  privateKeyPath?: string;
  /** Default remote directory to open on connect. */
  defaultRemotePath?: string;
  /** Default local directory to open in the left pane on connect. */
  defaultLocalPath?: string;
  /** Whether a secret is stored in the OS keychain for this site. */
  hasStoredSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Credentials supplied at connect time (never persisted unless `save` is set). */
export interface ConnectionRequest {
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  logonType: LogonType;
  password?: string;
  /** PEM private key contents for SFTP key auth. */
  privateKey?: string;
  passphrase?: string;
  /** FTP/FTPS encryption mode (absent means plain FTP for backward compat). */
  ftpEncryption?: FtpEncryption;
  /** Bypass TLS cert/hostname verification (set after the user trusts the cert). */
  acceptInvalidCert?: boolean;
  /** TCP connect timeout in seconds. */
  timeoutSecs?: number;
  /** Number of times to retry a failed connection. */
  retries?: number;
  /** Delay between connection retries, in seconds. */
  retryDelaySecs?: number;
  /** Proxy to tunnel the connection through. */
  proxy?: ProxyConfig;
  /** Minimum allowed TLS version for FTPS ("1.0".."1.3"; default 1.2). */
  minTlsVersion?: string;
  /** Enable zlib compression for SFTP. */
  sftpCompression?: boolean;
  /** Try the SSH agent (SSH_AUTH_SOCK) before password/key for SFTP. */
  useAgent?: boolean;
  /** Periodically send FTP NOOP to keep an idle control connection alive. */
  ftpKeepAlive?: boolean;
  /** Preallocate the full file size on disk before an SFTP download. */
  preallocate?: boolean;
  /** Maximum simultaneous transfer connections for this session (default 1). */
  maxConcurrent?: number;
  /** FTP transfer representation: "auto", "ascii", or "binary". */
  ftpDataType?: string;
  /** Legacy "USER user@host" FTP proxy host (plain FTP only). */
  ftpProxyHost?: string;
  /** Legacy FTP proxy port. */
  ftpProxyPort?: number;
}

/** An active session handle returned by `connect`. */
export interface Session {
  id: string;
  protocol: Protocol;
  host: string;
  username: string;
  cwd: string;
}

export type EntryKind = "file" | "directory" | "symlink";

/** A single directory entry (local or remote). */
export interface DirEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  /** RFC3339 timestamp. */
  modified?: string;
  /** Unix permission string e.g. "drwxr-xr-x" (remote only). */
  permissions?: string;
  owner?: string;
}

export type TransferDirection = "upload" | "download";
export type TransferStatus =
  | "queued"
  | "transferring"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** A transfer queue item. Progress fields are updated via `transfer://progress` events. */
export interface Transfer {
  id: string;
  direction: TransferDirection;
  name: string;
  localPath: string;
  remotePath: string;
  status: TransferStatus;
  bytesTransferred: number;
  totalBytes: number;
  /** bytes/sec, smoothed. */
  speed: number;
  /** seconds remaining, null when unknown. */
  etaSeconds: number | null;
  error?: string;
  /** Client-side label of the session this transfer belongs to (for filtering). */
  scope?: string;
  /** When the transfer was queued / finished (ISO), for date grouping. */
  timestamp?: string;
}

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  /** Optional session label this log relates to (for per-site filtering). */
  scope?: string;
}

/** Latest published GitHub release, returned by `check_latest_release`. */
export interface ReleaseInfo {
  /** Version from the tag, leading "v" stripped (e.g. "0.2.0"). */
  version: string;
  /** The release tag as published (e.g. "v0.2.0"). */
  tag: string;
  /** The release page URL (where the installer is downloaded). */
  url: string;
  /** Release notes (markdown), possibly empty. */
  notes: string;
}

/** Payload of the `transfer://progress` event emitted by the backend. */
export interface TransferProgressEvent {
  id: string;
  bytesTransferred: number;
  totalBytes: number;
  speed: number;
  etaSeconds: number | null;
  status: TransferStatus;
  error?: string;
}
