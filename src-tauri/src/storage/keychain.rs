//! Secret storage backed by the operating-system keychain (`keyring` crate):
//! macOS Keychain, Windows Credential Manager, or the Secret Service on Linux.
//!
//! Secrets are keyed by site id under a single service name. Passwords are never
//! written to SQLite, logs, or returned to the frontend.

use keyring::Entry;

use crate::error::{Error, Result};

const SERVICE: &str = "io.xfusion.turbofiles";

fn entry(site_id: &str) -> Result<Entry> {
    Entry::new(SERVICE, site_id).map_err(|e| Error::Keychain(e.to_string()))
}

/// Store (or replace) the secret for a site.
///
/// If a stale or inaccessible item already exists (e.g. saved by a previous dev
/// build with a different code signature on macOS), `set_password` can fail with
/// an access error. In that case we delete the offending item and retry once so
/// the secret is re-owned by the current binary.
pub fn set_secret(site_id: &str, secret: &str) -> Result<()> {
    let entry = entry(site_id)?;
    if entry.set_password(secret).is_ok() {
        return Ok(());
    }
    let _ = entry.delete_password();
    entry
        .set_password(secret)
        .map_err(|e| Error::Keychain(e.to_string()))
}

/// Fetch the secret for a site, if present.
///
/// A read can fail with an OS access error (notably macOS `errSecAuthFailed`)
/// when the keychain item was written by a previous, differently-signed build.
/// Rather than block the connection outright, we treat that as "no stored
/// secret": the caller then surfaces a clear "re-enter the password" auth error
/// and re-saving rewrites the item under the current binary.
pub fn get_secret(site_id: &str) -> Result<Option<String>> {
    match entry(site_id)?.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            tracing::warn!(
                "keychain read failed for site {site_id}: {e}; treating as no stored secret"
            );
            Ok(None)
        }
    }
}

/// Remove the secret for a site (no error if it was absent).
pub fn delete_secret(site_id: &str) -> Result<()> {
    match entry(site_id)?.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Keychain(e.to_string())),
    }
}
