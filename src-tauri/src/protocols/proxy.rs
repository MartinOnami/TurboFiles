//! Optional proxy tunnelling for the control connection.
//!
//! Supports SOCKS5 (via the `socks` crate) and HTTP CONNECT. The returned
//! `TcpStream` is already tunnelled to the target, so callers hand it to the
//! protocol library as if it were a direct connection.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use socks::{Socks4Stream, Socks5Stream};

use crate::error::{Error, Result};
use crate::models::{ProxyConfig, ProxyType};

/// Open a TCP stream to `host:port` through the configured proxy.
pub fn connect_via_proxy(
    proxy: &ProxyConfig,
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<TcpStream> {
    match proxy.kind {
        ProxyType::None => Err(Error::Connection("no proxy configured".into())),
        ProxyType::Socks4 => socks4(proxy, host, port),
        ProxyType::Socks5 => socks5(proxy, host, port),
        ProxyType::Http => http_connect(proxy, host, port, timeout),
    }
}

fn socks4(proxy: &ProxyConfig, host: &str, port: u16) -> Result<TcpStream> {
    // SOCKS4 cannot resolve hostnames itself (that's SOCKS4a, unsupported by the
    // `socks` crate's target API), so resolve to an IP first.
    let target = (host, port)
        .to_socket_addrs()
        .map_err(|e| Error::Connection(e.to_string()))?
        .next()
        .ok_or_else(|| Error::Connection(format!("cannot resolve {host}")))?;
    let proxy_addr = format!("{}:{}", proxy.host, proxy.port);
    // SOCKS4 has no password — only an optional userid.
    let userid = proxy.username.as_deref().unwrap_or("");
    let stream = Socks4Stream::connect(proxy_addr.as_str(), target, userid)
        .map_err(|e| Error::Connection(format!("SOCKS4 proxy {}: {}", proxy.host, e)))?;
    Ok(stream.into_inner())
}

fn socks5(proxy: &ProxyConfig, host: &str, port: u16) -> Result<TcpStream> {
    let proxy_addr = format!("{}:{}", proxy.host, proxy.port);
    let target = (host, port);
    let user = proxy.username.as_deref().unwrap_or("");
    let stream = if !user.is_empty() {
        Socks5Stream::connect_with_password(
            proxy_addr.as_str(),
            target,
            user,
            proxy.password.as_deref().unwrap_or(""),
        )
    } else {
        Socks5Stream::connect(proxy_addr.as_str(), target)
    }
    .map_err(|e| Error::Connection(format!("SOCKS5 proxy {}: {}", proxy.host, e)))?;
    Ok(stream.into_inner())
}

fn http_connect(
    proxy: &ProxyConfig,
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<TcpStream> {
    let sock = format!("{}:{}", proxy.host, proxy.port)
        .to_socket_addrs()
        .map_err(|e| Error::Connection(e.to_string()))?
        .next()
        .ok_or_else(|| Error::Connection(format!("cannot resolve proxy {}", proxy.host)))?;
    let mut tcp =
        TcpStream::connect_timeout(&sock, timeout).map_err(|e| Error::Connection(e.to_string()))?;

    let mut req = format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n");
    if let Some(user) = proxy.username.as_deref().filter(|u| !u.is_empty()) {
        let cred =
            base64_encode(format!("{user}:{}", proxy.password.as_deref().unwrap_or("")).as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {cred}\r\n"));
    }
    req.push_str("Proxy-Connection: Keep-Alive\r\n\r\n");
    tcp.write_all(req.as_bytes())
        .map_err(|e| Error::Connection(e.to_string()))?;

    let mut buf = [0u8; 1024];
    let n = tcp
        .read(&mut buf)
        .map_err(|e| Error::Connection(e.to_string()))?;
    let resp = String::from_utf8_lossy(&buf[..n]);
    let status = resp.lines().next().unwrap_or("");
    // Expect "HTTP/1.x 200 Connection established".
    if !status.contains(" 200") {
        return Err(Error::Connection(format!(
            "HTTP proxy refused tunnel: {}",
            status.trim()
        )));
    }
    Ok(tcp)
}

/// Standard base64 encoding (for HTTP Basic proxy auth). Avoids pulling in a crate.
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(T[(b0 >> 2) as usize] as char);
        out.push(T[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::base64_encode;
    use crate::models::ProxyType;

    #[test]
    fn proxy_type_wire_values() {
        // The frontend sends these lowercase tags; keep them stable.
        assert_eq!(
            serde_json::from_str::<ProxyType>("\"socks4\"").unwrap(),
            ProxyType::Socks4
        );
        assert_eq!(
            serde_json::from_str::<ProxyType>("\"socks5\"").unwrap(),
            ProxyType::Socks5
        );
        assert_eq!(
            serde_json::to_string(&ProxyType::Socks4).unwrap(),
            "\"socks4\""
        );
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"user:pass"), "dXNlcjpwYXNz");
    }
}
