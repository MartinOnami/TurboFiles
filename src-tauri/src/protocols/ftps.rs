//! FTPS client: explicit TLS (AUTH TLS) and implicit TLS backed by `suppaftp` + native-tls.
//!
//! Reuses shared transfer/listing logic via [`crate::impl_ftp_remotefs`].

use std::net::ToSocketAddrs;
use std::time::Duration;

use suppaftp::native_tls::TlsConnector;
use suppaftp::{NativeTlsConnector, NativeTlsFtpStream};

use crate::error::{Error, Result};
use crate::impl_ftp_remotefs;
use crate::models::{ConnectionRequest, LogonType};

pub struct FtpsClient {
    pub(crate) inner: NativeTlsFtpStream,
    pub(crate) data_type: crate::protocols::ftp::FtpDataType,
}

/// Connect over plaintext then upgrade via AUTH TLS (explicit FTPS), then authenticate.
pub fn connect_explicit(req: &ConnectionRequest) -> Result<FtpsClient> {
    let accept = req.accept_invalid_cert.unwrap_or(false);
    let timeout = Duration::from_secs(req.timeout_secs.unwrap_or(20));
    let tcp = match req
        .proxy
        .as_ref()
        .filter(|p| p.kind != crate::models::ProxyType::None)
    {
        Some(proxy) => {
            crate::protocols::proxy::connect_via_proxy(proxy, &req.host, req.port, timeout)?
        }
        None => {
            let addr = format!("{}:{}", req.host, req.port);
            let sock = addr
                .to_socket_addrs()
                .map_err(|e| Error::Connection(format!("cannot resolve {}: {}", req.host, e)))?
                .next()
                .ok_or_else(|| Error::Connection(format!("no address for {}", req.host)))?;
            std::net::TcpStream::connect_timeout(&sock, timeout)
                .map_err(|e| Error::Connection(e.to_string()))?
        }
    };
    let ftp = NativeTlsFtpStream::connect_with_stream(tcp)
        .map_err(|e| Error::Connection(e.to_string()))?;

    let connector = build_connector(accept, req.min_tls_version.as_deref())?;
    let mut secure = ftp
        .into_secure(connector, &req.host)
        .map_err(|e| classify_tls_error(e, accept))?;

    let (user, pass) = credentials(req);
    secure
        .login(&user, &pass)
        .map_err(|e| Error::Auth(e.to_string()))?;
    if let Some(m) = crate::protocols::ftp::ftp_mode_to_suppaftp(req.ftp_mode) {
        secure.set_mode(m);
    }
    Ok(FtpsClient {
        inner: secure,
        data_type: crate::protocols::ftp::parse_data_type(req.ftp_data_type.as_deref()),
    })
}

/// Wrap a fresh TCP connection in TLS before the FTP handshake (implicit FTPS, typically port 990).
pub fn connect_implicit(req: &ConnectionRequest) -> Result<FtpsClient> {
    let accept = req.accept_invalid_cert.unwrap_or(false);
    // The implicit-TLS entry point has no "connect with existing stream" variant,
    // so it can't be tunnelled. Fail clearly rather than bypassing the proxy.
    if req
        .proxy
        .as_ref()
        .is_some_and(|p| p.kind != crate::models::ProxyType::None)
    {
        return Err(Error::Connection(
            "a proxy cannot be used with implicit FTPS - use explicit TLS instead".into(),
        ));
    }
    let addr = format!("{}:{}", req.host, req.port);
    let connector = build_connector(accept, req.min_tls_version.as_deref())?;
    let mut ftp = NativeTlsFtpStream::connect_secure_implicit(&addr, connector, &req.host)
        .map_err(|e| classify_tls_error(e, accept))?;

    let (user, pass) = credentials(req);
    ftp.login(&user, &pass)
        .map_err(|e| Error::Auth(e.to_string()))?;
    if let Some(m) = crate::protocols::ftp::ftp_mode_to_suppaftp(req.ftp_mode) {
        ftp.set_mode(m);
    }
    Ok(FtpsClient {
        inner: ftp,
        data_type: crate::protocols::ftp::parse_data_type(req.ftp_data_type.as_deref()),
    })
}

/// Build a native-tls connector, optionally disabling certificate/hostname
/// verification when the user has explicitly chosen to trust this server, and
/// applying the configured minimum TLS version.
fn build_connector(accept_invalid_cert: bool, min_tls: Option<&str>) -> Result<NativeTlsConnector> {
    use suppaftp::native_tls::Protocol;
    let mut builder = TlsConnector::builder();
    if accept_invalid_cert {
        builder.danger_accept_invalid_certs(true);
        builder.danger_accept_invalid_hostnames(true);
    }
    let proto = match min_tls {
        Some("1.0") => Some(Protocol::Tlsv10),
        Some("1.1") => Some(Protocol::Tlsv11),
        Some("1.2") => Some(Protocol::Tlsv12),
        // native-tls can't express a 1.3 floor. Rather than silently negotiate
        // 1.2 (defeating a user's deliberate hardening), fail with a clear message.
        Some("1.3") => {
            return Err(Error::Connection(
                "minimum TLS 1.3 is not supported for FTPS by this build (the strongest \
                 enforceable floor is TLS 1.2). Choose TLS 1.2, or use SFTP."
                    .into(),
            ))
        }
        _ => None,
    };
    if proto.is_some() {
        builder.min_protocol_version(proto);
    }
    let connector = builder
        .build()
        .map_err(|e| Error::Connection(e.to_string()))?;
    Ok(NativeTlsConnector::from(connector))
}

/// Map a TLS handshake failure to either a trust prompt (`CertUntrusted`) or a
/// generic connection error. When verification is already disabled, any failure
/// is a genuine connection problem, not a trust issue.
fn classify_tls_error(e: impl std::fmt::Display, accept_invalid_cert: bool) -> Error {
    let msg = e.to_string();
    if accept_invalid_cert {
        return Error::Connection(msg);
    }
    let low = msg.to_lowercase();
    let cert_like = low.contains("certificate")
        || low.contains("host name")
        || low.contains("hostname")
        || low.contains("mismatch")
        || low.contains("self signed")
        || low.contains("self-signed")
        || low.contains("secure error")
        || low.contains("unknown ca")
        || low.contains("not trusted")
        || low.contains("verify");
    if cert_like {
        Error::CertUntrusted(msg)
    } else {
        Error::Connection(msg)
    }
}

fn credentials(req: &ConnectionRequest) -> (String, String) {
    match req.logon_type {
        LogonType::Anonymous => ("anonymous".to_string(), String::new()),
        _ => (
            req.username.clone(),
            req.password.clone().unwrap_or_default(),
        ),
    }
}

impl_ftp_remotefs!(FtpsClient);
