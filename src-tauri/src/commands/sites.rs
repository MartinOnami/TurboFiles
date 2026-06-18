use tauri::State;

use crate::error::Result;
use crate::models::Site;
use crate::state::AppState;
use crate::storage::keychain;

/// List all saved sites (no secrets are returned).
#[tauri::command]
pub fn list_sites(state: State<'_, AppState>) -> Result<Vec<Site>> {
    state.sites.list()
}

/// Create or update a site. If `secret` is non-empty it is stored in the keychain.
/// An empty string secret is treated as "no change" to avoid wiping stored passwords.
#[tauri::command]
pub fn save_site(
    mut site: Site,
    secret: Option<String>,
    state: State<'_, AppState>,
) -> Result<Site> {
    let non_empty_secret = secret.filter(|s| !s.is_empty());
    site.has_stored_secret = non_empty_secret.is_some() || site.has_stored_secret;
    let saved = state.sites.upsert(site)?;
    if let Some(secret) = non_empty_secret {
        keychain::set_secret(&saved.id, &secret)?;
    }
    Ok(saved)
}

/// Delete a site and its stored secret.
#[tauri::command]
pub fn delete_site(id: String, state: State<'_, AppState>) -> Result<()> {
    state.sites.delete(&id)?;
    keychain::delete_secret(&id)?;
    Ok(())
}
