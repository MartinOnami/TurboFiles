//! SFTP client backed by the `ssh2` crate.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use ssh2::Session;

use super::traits::{ProgressFn, RemoteFs};
use crate::error::{Error, Result};
use crate::models::{ConnectionRequest, DirEntry, EntryKind, LogonType};

const CHUNK: usize = 64 * 1024;

pub struct SftpClient {
    session: Session,
    fingerprint: String,
    /// Preallocate the full file size on disk before a download (less fragmentation).
    preallocate: bool,
    /// Minutes added to remote mtimes to align them with local time.
    time_offset_minutes: i32,
}

/// Format the server's host key as a `SHA256:<base64>` fingerprint (OpenSSH style).
fn host_key_fingerprint(session: &Session) -> String {
    match session.host_key_hash(ssh2::HashType::Sha256) {
        Some(hash) => format!(
            "SHA256:{}",
            super::proxy::base64_encode(hash).trim_end_matches('=')
        ),
        None => match session.host_key_hash(ssh2::HashType::Sha1) {
            Some(hash) => format!(
                "SHA1:{}",
                super::proxy::base64_encode(hash).trim_end_matches('=')
            ),
            None => "unknown".to_string(),
        },
    }
}

impl SftpClient {
    /// Connect, perform the SSH handshake, and authenticate.
    pub fn connect(req: &ConnectionRequest) -> Result<Self> {
        use std::net::ToSocketAddrs;
        let timeout = Duration::from_secs(req.timeout_secs.unwrap_or(20));

        // Tunnel through a proxy when configured, else connect directly.
        let tcp = match req
            .proxy
            .as_ref()
            .filter(|p| p.kind != crate::models::ProxyType::None)
        {
            Some(proxy) => super::proxy::connect_via_proxy(proxy, &req.host, req.port, timeout)?,
            None => {
                let addr = format!("{}:{}", req.host, req.port);
                let sock = addr
                    .to_socket_addrs()
                    .map_err(|e| Error::Connection(format!("cannot resolve {}: {}", req.host, e)))?
                    .next()
                    .ok_or_else(|| Error::Connection(format!("no address for {}", req.host)))?;
                TcpStream::connect_timeout(&sock, timeout)
                    .map_err(|e| Error::Connection(e.to_string()))?
            }
        };
        tcp.set_read_timeout(Some(timeout.max(Duration::from_secs(30))))
            .ok();

        let mut session = Session::new()?;
        session.set_tcp_stream(tcp);
        if req.sftp_compression.unwrap_or(false) {
            session.set_compress(true);
        }
        session.handshake()?;

        // Verify the host key BEFORE sending credentials (prevents MITM password
        // theft). Trust-on-first-use: an unknown host is accepted and remembered
        // by the caller; a key that differs from the remembered one hard-fails.
        let fingerprint = host_key_fingerprint(&session);
        if let Some(known) = req.known_host_key.as_deref() {
            if !known.is_empty() && known != fingerprint {
                return Err(Error::HostKeyMismatch(format!(
                    "{} expected {}, got {}. If you trust the new key, forget the saved one and reconnect.",
                    req.host, known, fingerprint
                )));
            }
        }

        authenticate(&mut session, req)?;
        Ok(Self {
            session,
            fingerprint,
            preallocate: req.preallocate.unwrap_or(false),
            time_offset_minutes: req.time_offset_minutes.unwrap_or(0),
        })
    }
}

/// Route authentication based on the requested logon type.
fn authenticate(session: &mut ssh2::Session, req: &ConnectionRequest) -> Result<()> {
    // Try the SSH agent first when enabled - succeeds silently if a loaded key
    // matches, otherwise falls through to the configured logon type.
    if req.use_agent.unwrap_or(false)
        && session.userauth_agent(&req.username).is_ok()
        && session.authenticated()
    {
        return Ok(());
    }

    match req.logon_type {
        LogonType::Key => {
            let key = req.private_key.as_deref().ok_or_else(|| {
                Error::Auth("private key contents required for Key auth".to_string())
            })?;
            session
                .userauth_pubkey_memory(&req.username, None, key, req.passphrase.as_deref())
                .map_err(|e| Error::Auth(format!("public key auth failed: {}", e.message())))?;
        }
        LogonType::Interactive => {
            let pw = req.password.clone().unwrap_or_default();
            session
                .userauth_keyboard_interactive(
                    &req.username,
                    &mut KbdPrompt::new(&req.username, &pw),
                )
                .map_err(|e| {
                    Error::Auth(format!("keyboard-interactive failed: {}", e.message()))
                })?;
        }
        LogonType::Anonymous => {
            session
                .userauth_password(&req.username, "")
                .map_err(|e| Error::Auth(format!("anonymous auth failed: {}", e.message())))?;
        }
        LogonType::Normal => {
            let pw = req.password.as_deref().ok_or_else(|| {
                Error::Auth(
                    "no password stored - edit the site in Site Manager and re-enter the password"
                        .to_string(),
                )
            })?;

            // Try keyboard-interactive first - matches FileZilla's SFTP behaviour.
            // Do NOT call auth_methods() first; that consumes one attempt on strict
            // servers (e.g. WP Engine limits total attempts to 3).
            let kbd_ok = session
                .userauth_keyboard_interactive(
                    &req.username,
                    &mut KbdPrompt::new(&req.username, pw),
                )
                .is_ok()
                && session.authenticated();

            if !kbd_ok {
                // Fall back to plain-password method.
                session.userauth_password(&req.username, pw).map_err(|e| {
                    Error::Auth(format!(
                        "authentication failed - the stored SFTP password is wrong. \
                         Use the ✏ Edit button on the site in the Site Manager, \
                         re-enter the correct password, and click Save. \
                         Server: {}",
                        e.message()
                    ))
                })?;
            }
        }
    }

    if !session.authenticated() {
        return Err(Error::Auth(
            "not authenticated after all attempts".to_string(),
        ));
    }
    Ok(())
}

/// Responds to keyboard-interactive prompts by matching prompt text:
/// username-like prompts → send username, everything else → send password.
/// This handles servers (e.g. WP Engine) that send separate Username/Password prompts.
struct KbdPrompt {
    username: String,
    password: String,
}

impl KbdPrompt {
    fn new(username: &str, password: &str) -> Self {
        Self {
            username: username.to_string(),
            password: password.to_string(),
        }
    }
}

impl ssh2::KeyboardInteractivePrompt for KbdPrompt {
    fn prompt(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[ssh2::Prompt<'_>],
    ) -> Vec<String> {
        prompts
            .iter()
            .map(|p| {
                let lower = p.text.to_ascii_lowercase();
                if lower.contains("user") || lower.contains("login") || lower.contains("name") {
                    self.username.clone()
                } else {
                    self.password.clone()
                }
            })
            .collect()
    }
}

impl RemoteFs for SftpClient {
    fn host_key_fingerprint(&self) -> Option<String> {
        Some(self.fingerprint.clone())
    }

    fn cwd(&mut self) -> Result<String> {
        // SFTP has no notion of a CWD; default to the user's home via realpath(".").
        let sftp = self.session.sftp()?;
        let path = sftp.realpath(Path::new(".")).unwrap_or_else(|_| "/".into());
        Ok(path.to_string_lossy().into_owned())
    }

    fn list(&mut self, path: &str) -> Result<Vec<DirEntry>> {
        let sftp = self.session.sftp()?;
        let mut out = Vec::new();
        for (p, stat) in sftp.readdir(Path::new(path))? {
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name == "." || name == ".." {
                continue;
            }
            let kind = if stat.is_dir() {
                EntryKind::Directory
            } else if stat.file_type().is_symlink() {
                EntryKind::Symlink
            } else {
                EntryKind::File
            };
            out.push(DirEntry {
                name,
                path: p.to_string_lossy().into_owned(),
                kind,
                size: stat.size.unwrap_or(0),
                modified: stat
                    .mtime
                    .map(|s| format_mtime(s, self.time_offset_minutes)),
                permissions: stat.perm.map(format_perms),
                owner: stat.uid.map(|u| u.to_string()),
            });
        }
        out.sort_by_key(sort_key);
        Ok(out)
    }

    fn download(
        &mut self,
        remote: &str,
        dest: &Path,
        resume: bool,
        progress: &mut ProgressFn,
    ) -> Result<()> {
        use std::io::{Seek, SeekFrom};
        let sftp = self.session.sftp()?;
        let stat = sftp.stat(Path::new(remote))?;
        let total = stat.size.unwrap_or(0);

        // Resume from the partial local file's length, if requested and present.
        let existing = if resume {
            std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        if existing > 0 && existing >= total {
            return Ok(()); // already complete
        }

        let mut remote_file = sftp.open(Path::new(remote))?;
        let mut local = if existing > 0 {
            let mut f = std::fs::OpenOptions::new().write(true).open(dest)?;
            remote_file.seek(SeekFrom::Start(existing))?;
            f.seek(SeekFrom::Start(existing))?;
            f
        } else {
            let f = std::fs::File::create(dest)?;
            // Preallocate the full size up-front to reduce on-disk fragmentation;
            // the data is overwritten as it streams in. Best-effort only.
            if self.preallocate && total > 0 {
                let _ = f.set_len(total);
            }
            f
        };

        let mut buf = vec![0u8; CHUNK];
        let mut done: u64 = existing;
        loop {
            let n = remote_file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            local.write_all(&buf[..n])?;
            done += n as u64;
            if !progress(done, total) {
                break; // cancelled mid-stream
            }
        }
        local.flush()?;
        Ok(())
    }

    fn upload(
        &mut self,
        src: &Path,
        remote: &str,
        resume: bool,
        progress: &mut ProgressFn,
    ) -> Result<()> {
        use ssh2::OpenFlags;
        use std::io::{Seek, SeekFrom};
        let sftp = self.session.sftp()?;
        let total = std::fs::metadata(src)?.len();

        // Resume from the partial remote file's length, if requested and present.
        let existing = if resume {
            sftp.stat(Path::new(remote))
                .ok()
                .and_then(|s| s.size)
                .unwrap_or(0)
        } else {
            0
        };
        if existing > 0 && existing >= total {
            return Ok(()); // already complete
        }

        let mut local = std::fs::File::open(src)?;
        let mut remote_file = if existing > 0 {
            local.seek(SeekFrom::Start(existing))?;
            sftp.open_mode(
                Path::new(remote),
                OpenFlags::WRITE | OpenFlags::APPEND,
                0o644,
                ssh2::OpenType::File,
            )?
        } else {
            sftp.create(Path::new(remote))?
        };

        let mut buf = vec![0u8; CHUNK];
        let mut done: u64 = existing;
        loop {
            let n = local.read(&mut buf)?;
            if n == 0 {
                break;
            }
            remote_file.write_all(&buf[..n])?;
            done += n as u64;
            if !progress(done, total) {
                break; // cancelled mid-stream
            }
        }
        Ok(())
    }

    fn delete(&mut self, path: &str) -> Result<()> {
        let sftp = self.session.sftp()?;
        let stat = sftp.stat(Path::new(path))?;
        if stat.is_dir() {
            sftp.rmdir(Path::new(path))?;
        } else {
            sftp.unlink(Path::new(path))?;
        }
        Ok(())
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        let sftp = self.session.sftp()?;
        sftp.rename(Path::new(from), Path::new(to), None)?;
        Ok(())
    }

    fn mkdir(&mut self, path: &str) -> Result<()> {
        let sftp = self.session.sftp()?;
        sftp.mkdir(Path::new(path), 0o755)?;
        Ok(())
    }

    fn disconnect(&mut self) -> Result<()> {
        self.session
            .disconnect(None, "bye", None)
            .map_err(Error::from)
    }
}

fn sort_key(e: &DirEntry) -> (u8, String) {
    let dir_first = if matches!(e.kind, EntryKind::Directory) {
        0
    } else {
        1
    };
    (dir_first, e.name.to_lowercase())
}

/// Format a Unix mtime as "Jun 13 13:24" - short enough for the table column.
/// `offset_minutes` shifts the timestamp to align the server clock with local time.
fn format_mtime(secs: u64, offset_minutes: i32) -> String {
    use time::OffsetDateTime;
    const MON: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let adjusted = secs as i64 + offset_minutes as i64 * 60;
    OffsetDateTime::from_unix_timestamp(adjusted)
        .map(|dt| {
            let m = (dt.month() as u8).saturating_sub(1) as usize;
            format!(
                "{} {:2} {:02}:{:02}",
                MON.get(m).copied().unwrap_or("?"),
                dt.day(),
                dt.hour(),
                dt.minute()
            )
        })
        .unwrap_or_default()
}

/// Render a Unix permission bitmask as a `drwxr-xr-x`-style string.
fn format_perms(mode: u32) -> String {
    let is_dir = mode & 0o040000 != 0;
    let is_link = mode & 0o120000 == 0o120000;
    let kind = if is_link {
        'l'
    } else if is_dir {
        'd'
    } else {
        '-'
    };
    let bit = |m: u32, c: char| if mode & m != 0 { c } else { '-' };
    format!(
        "{}{}{}{}{}{}{}{}{}{}",
        kind,
        bit(0o400, 'r'),
        bit(0o200, 'w'),
        bit(0o100, 'x'),
        bit(0o040, 'r'),
        bit(0o020, 'w'),
        bit(0o010, 'x'),
        bit(0o004, 'r'),
        bit(0o002, 'w'),
        bit(0o001, 'x'),
    )
}

#[cfg(test)]
mod tests {
    use super::format_perms;

    #[test]
    fn formats_regular_file() {
        // 0o100644 = regular file rw-r--r--
        assert_eq!(format_perms(0o100644), "-rw-r--r--");
    }

    #[test]
    fn formats_directory() {
        assert_eq!(format_perms(0o040755), "drwxr-xr-x");
    }

    #[test]
    fn formats_symlink() {
        assert_eq!(format_perms(0o120777), "lrwxrwxrwx");
    }
}
