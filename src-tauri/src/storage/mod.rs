//! Persistence: SQLite for site profiles, the OS keychain for secrets.

pub mod db;
pub mod history;
pub mod keychain;

pub use db::SiteStore;
pub use history::HistoryStore;
