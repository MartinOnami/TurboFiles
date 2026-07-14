//! Secret storage backed by the operating-system keychain (`keyring` crate):
//! macOS Keychain, Windows Credential Manager, or the Secret Service on Linux.
//!
//! Secrets are keyed by site id under the app's keychain service name. Passwords
//! are never written to SQLite, logs, or returned to the frontend.

use keyring::Entry;

use crate::error::{Error, Result};

const SERVICE: &str = "com.gowp.turbofiles";

/// Service name used before the GoWP rebrand (was `io.xfusion.turbofiles`). The
/// `keyring` crate cannot enumerate items, so secrets stored under the old name
/// are migrated lazily: `get_secret` reads through to it and copies the secret
/// forward under `SERVICE` on first access.
const LEGACY_SERVICE: &str = "io.xfusion.turbofiles";

fn entry(site_id: &str) -> Result<Entry> {
    Entry::new(SERVICE, site_id).map_err(|e| Error::Keychain(e.to_string()))
}

fn legacy_entry(site_id: &str) -> Result<Entry> {
    Entry::new(LEGACY_SERVICE, site_id).map_err(|e| Error::Keychain(e.to_string()))
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
        Err(keyring::Error::NoEntry) => get_legacy_secret(site_id),
        Err(e) => {
            tracing::warn!(
                "keychain read failed for site {site_id}: {e}; treating as no stored secret"
            );
            Ok(None)
        }
    }
}

/// Read a secret saved under the pre-rebrand service name and, if present, copy
/// it forward under the current service so later reads hit the new entry. Any
/// failure degrades to "no stored secret" (the caller then prompts for the
/// password), so migration never blocks a connection.
fn get_legacy_secret(site_id: &str) -> Result<Option<String>> {
    let pw = match legacy_entry(site_id)?.get_password() {
        Ok(pw) => pw,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => {
            tracing::warn!(
                "legacy keychain read failed for site {site_id}: {e}; treating as no stored secret"
            );
            return Ok(None);
        }
    };
    if let Err(e) = set_secret(site_id, &pw) {
        tracing::warn!("keychain migration copy-forward failed for site {site_id}: {e}");
    }
    Ok(Some(pw))
}

/// Remove the secret for a site (no error if it was absent).
pub fn delete_secret(site_id: &str) -> Result<()> {
    // Best-effort removal of any pre-rebrand copy so a deleted secret cannot
    // resurface via the legacy read-through in `get_secret`.
    if let Ok(legacy) = legacy_entry(site_id) {
        let _ = legacy.delete_password();
    }
    match entry(site_id)?.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Keychain(e.to_string())),
    }
}
