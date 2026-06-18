//! The [`RemoteFs`] trait implemented by every protocol client.

use std::path::Path;

use crate::error::Result;
use crate::models::DirEntry;

/// Progress callback: `(bytes_transferred_so_far, total_bytes) -> keep_going`.
///
/// Returning `false` asks the in-progress transfer to abort as soon as possible
/// (used to honour mid-stream cancellation).
pub type ProgressFn<'a> = dyn FnMut(u64, u64) -> bool + Send + 'a;

/// A connected remote filesystem. All methods are blocking.
pub trait RemoteFs: Send {
    /// The initial working directory after login.
    fn cwd(&mut self) -> Result<String>;

    /// List the entries of `path`.
    fn list(&mut self, path: &str) -> Result<Vec<DirEntry>>;

    /// Download `remote` to the local `dest` file, reporting progress.
    ///
    /// When `resume` is true and a partial `dest` already exists, the transfer
    /// continues from the existing file's length instead of starting over.
    fn download(
        &mut self,
        remote: &str,
        dest: &Path,
        resume: bool,
        progress: &mut ProgressFn,
    ) -> Result<()>;

    /// Upload the local `src` file to `remote`, reporting progress.
    ///
    /// When `resume` is true and a partial remote file already exists, the
    /// transfer continues from the remote file's length instead of restarting.
    fn upload(
        &mut self,
        src: &Path,
        remote: &str,
        resume: bool,
        progress: &mut ProgressFn,
    ) -> Result<()>;

    /// Delete a file or empty directory at `path`.
    fn delete(&mut self, _path: &str) -> Result<()> {
        Err(crate::error::Error::Remote(
            "delete not supported by this protocol".into(),
        ))
    }

    /// Rename / move `from` to `to`.
    fn rename(&mut self, _from: &str, _to: &str) -> Result<()> {
        Err(crate::error::Error::Remote(
            "rename not supported by this protocol".into(),
        ))
    }

    /// Create a directory at `path`.
    fn mkdir(&mut self, _path: &str) -> Result<()> {
        Err(crate::error::Error::Remote(
            "mkdir not supported by this protocol".into(),
        ))
    }

    /// Send a lightweight keep-alive (e.g. FTP `NOOP`) to stop an idle control
    /// connection from being dropped by the server. Default is a no-op.
    fn keep_alive(&mut self) -> Result<()> {
        Ok(())
    }

    /// Gracefully close the connection. Default is a no-op.
    fn disconnect(&mut self) -> Result<()> {
        Ok(())
    }

    /// The server's SSH host-key fingerprint, if this protocol has one (SFTP).
    /// Used to persist trust-on-first-use after a successful connect.
    fn host_key_fingerprint(&self) -> Option<String> {
        None
    }
}
