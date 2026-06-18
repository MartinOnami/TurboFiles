//! BYOK assistant: secure proxy to an LLM provider.
//!
//! The API key is stored in the OS keychain (never persisted to SQLite, never
//! returned to the web layer). [`llm_proxy`] injects the key as the appropriate
//! auth header and forwards the request body the frontend built, so the renderer
//! never sees the key and the app's CSP stays locked to `'self'`.

use crate::error::{Error, Result};
use crate::storage::keychain;

/// Keychain account id for a provider's API key.
fn key_id(provider: &str) -> String {
    format!("llm:{provider}")
}

/// Apply the right auth header for `provider`, using the stored key. Anthropic
/// requires a key; OpenAI-compatible providers (incl. local Ollama/LM Studio)
/// may run without one, so the key is optional there.
fn with_auth(req: reqwest::RequestBuilder, provider: &str) -> Result<reqwest::RequestBuilder> {
    let key = keychain::get_secret(&key_id(provider))?.filter(|k| !k.is_empty());
    if provider == "anthropic" {
        let key = key.ok_or_else(|| Error::Invalid("no API key set for anthropic".into()))?;
        Ok(req
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"))
    } else if let Some(k) = key {
        Ok(req.bearer_auth(k))
    } else {
        // Local / keyless OpenAI-compatible endpoint.
        Ok(req)
    }
}

/// Reject anything that isn't a plain http(s) URL (no file://, data://, etc.).
fn ensure_http(url: &str) -> Result<()> {
    if url.starts_with("https://") || url.starts_with("http://") {
        Ok(())
    } else {
        Err(Error::Invalid(
            "the model endpoint must be an http(s) URL".into(),
        ))
    }
}

/// Resolve the API base URL for an OpenAI-compatible provider (blank → OpenAI).
fn openai_base(base_url: &str) -> String {
    let b = base_url.trim().trim_end_matches('/');
    if b.is_empty() {
        "https://api.openai.com/v1".to_string()
    } else {
        b.to_string()
    }
}

/// Pull the provider/server error message out of a JSON body (never the key).
fn provider_error(json: &serde_json::Value) -> String {
    json.get("error")
        .and_then(|e| e.get("message").or(Some(e)))
        .and_then(|m| m.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| json.to_string())
}

/// List the models available from the provider, so the user can pick one.
/// Works for Anthropic (`/v1/models`) and any OpenAI-compatible server's
/// `/models` endpoint — including local Ollama / LM Studio.
#[tauri::command]
pub async fn llm_list_models(provider: String, base_url: String) -> Result<Vec<String>> {
    let url = if provider == "anthropic" {
        "https://api.anthropic.com/v1/models".to_string()
    } else {
        format!("{}/models", openai_base(&base_url))
    };
    ensure_http(&url)?;
    let client = reqwest::Client::new();
    let req = with_auth(client.get(&url), &provider)?;
    let resp = req
        .send()
        .await
        .map_err(|e| Error::Connection(format!("could not reach the model provider: {e}")))?;
    let status = resp.status();
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| Error::Remote(format!("invalid model list: {e}")))?;
    if !status.is_success() {
        return Err(Error::Remote(format!(
            "model list error ({status}): {}",
            provider_error(&json)
        )));
    }
    // Both Anthropic and OpenAI return `{ data: [{ id, ... }] }`.
    let ids = json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(ids)
}

/// Store (or replace) the API key for a provider in the OS keychain.
#[tauri::command]
pub fn llm_set_key(provider: String, key: String) -> Result<()> {
    if key.trim().is_empty() {
        return keychain::delete_secret(&key_id(&provider));
    }
    keychain::set_secret(&key_id(&provider), &key)
}

/// Whether an API key is stored for a provider (the key itself is never returned).
#[tauri::command]
pub fn llm_has_key(provider: String) -> Result<bool> {
    Ok(keychain::get_secret(&key_id(&provider))?.is_some())
}

/// Remove the stored API key for a provider.
#[tauri::command]
pub fn llm_clear_key(provider: String) -> Result<()> {
    keychain::delete_secret(&key_id(&provider))
}

/// Forward a chat-completion request to `url`, injecting the stored key for
/// `provider` as the correct auth header. `body` is the provider-native request
/// the frontend assembled. Returns the raw JSON response.
///
/// `provider` is `"anthropic"` (uses `x-api-key` + `anthropic-version`) or any
/// other value, treated as OpenAI-compatible (`Authorization: Bearer`).
#[tauri::command]
pub async fn llm_proxy(
    provider: String,
    url: String,
    body: serde_json::Value,
) -> Result<serde_json::Value> {
    ensure_http(&url)?;
    let client = reqwest::Client::new();
    let req = with_auth(client.post(&url).json(&body), &provider)?;
    let resp = req
        .send()
        .await
        .map_err(|e| Error::Connection(format!("LLM request failed: {e}")))?;
    let status = resp.status();
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| Error::Remote(format!("invalid LLM response: {e}")))?;
    if !status.is_success() {
        return Err(Error::Remote(format!(
            "LLM API error ({status}): {}",
            provider_error(&json)
        )));
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::{ensure_http, openai_base, provider_error};
    use serde_json::json;

    #[test]
    fn ensure_http_rejects_non_http_schemes() {
        assert!(ensure_http("https://api.openai.com/v1/chat/completions").is_ok());
        assert!(ensure_http("http://localhost:11434/v1/chat/completions").is_ok());
        assert!(ensure_http("file:///etc/passwd").is_err());
        assert!(ensure_http("ftp://x/y").is_err());
        assert!(ensure_http("").is_err());
    }

    #[test]
    fn openai_base_defaults_and_trims() {
        assert_eq!(openai_base(""), "https://api.openai.com/v1");
        assert_eq!(openai_base("  "), "https://api.openai.com/v1");
        assert_eq!(
            openai_base("http://localhost:11434/v1/"),
            "http://localhost:11434/v1"
        );
        assert_eq!(openai_base("  https://host/v1  "), "https://host/v1");
    }

    #[test]
    fn provider_error_extracts_message() {
        assert_eq!(
            provider_error(&json!({"error": {"message": "bad key"}})),
            "bad key"
        );
        assert_eq!(provider_error(&json!({"error": "oops"})), "oops");
        // No recognizable error field → fall back to the raw body.
        assert_eq!(provider_error(&json!({})), "{}");
    }
}
