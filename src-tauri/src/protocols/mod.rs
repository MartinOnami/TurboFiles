//! Protocol abstraction layer.
//!
//! Every transport (SFTP, FTP, FTPS) implements [`RemoteFs`]. The rest of the
//! application depends only on the trait, so adding a protocol means adding one
//! module here and a match arm in [`connect`].
//!
//! The underlying crates (`ssh2`, `suppaftp`) are **blocking**. Callers must run
//! these methods on a blocking thread (e.g. `tokio::task::spawn_blocking`); never
//! call them directly from an async context.

mod ftp;
mod ftps;
pub(crate) mod proxy;
mod sftp;
pub mod traits;

pub use traits::{ProgressFn, RemoteFs};

use crate::error::{Error, Result};
use crate::models::{ConnectionRequest, FtpEncryption, Protocol};

/// Establish a connection and return a boxed protocol client.
pub fn connect(req: &ConnectionRequest) -> Result<Box<dyn RemoteFs>> {
    let req = sanitize(req);
    match req.protocol {
        Protocol::Sftp => Ok(Box::new(sftp::SftpClient::connect(&req)?)),
        // Legacy "ftps" protocol entries always use explicit TLS.
        Protocol::Ftps => Ok(Box::new(ftps::connect_explicit(&req)?)),
        Protocol::Ftp => match req.ftp_encryption {
            None | Some(FtpEncryption::Plain) => {
                Ok(Box::new(ftp::FtpClient::connect(&req, false)?))
            }
            Some(FtpEncryption::ExplicitTlsIfAvailable) => {
                // Try AUTH TLS; fall back to plain FTP if TLS is unavailable.
                // A cert-trust failure is surfaced (not downgraded) so the user
                // can decide to trust the certificate rather than silently
                // dropping to an insecure connection.
                match ftps::connect_explicit(&req) {
                    Ok(c) => Ok(Box::new(c)),
                    Err(e @ Error::CertUntrusted(_)) => Err(e),
                    Err(_) => Ok(Box::new(ftp::FtpClient::connect(&req, false)?)),
                }
            }
            Some(FtpEncryption::RequireExplicitTls) => Ok(Box::new(ftps::connect_explicit(&req)?)),
            Some(FtpEncryption::RequireImplicitTls) => Ok(Box::new(ftps::connect_implicit(&req)?)),
        },
    }
}

/// Strip URL schemes and trailing slashes from the host field so users can
/// paste URLs like `ftp://example.com` without getting a connect error.
fn sanitize(req: &ConnectionRequest) -> ConnectionRequest {
    let host = req
        .host
        .trim_start_matches("sftp://")
        .trim_start_matches("ftp://")
        .trim_start_matches("ftps://")
        .trim_start_matches("ssh://")
        .trim_end_matches('/')
        .trim()
        .to_string();
    ConnectionRequest {
        host,
        ..req.clone()
    }
}
