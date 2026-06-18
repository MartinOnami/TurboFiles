//! Integration tests against the public crate API.

use turbofiles_lib::models::{Protocol, TransferDirection};
use turbofiles_lib::transfer::{TransferControl, CANCELLED, PAUSED, RUNNING};

#[test]
fn protocol_serializes_lowercase() {
    let json = serde_json::to_string(&Protocol::Ftps).unwrap();
    assert_eq!(json, "\"ftps\"");
}

#[test]
fn direction_roundtrips() {
    let json = serde_json::to_string(&TransferDirection::Upload).unwrap();
    let back: TransferDirection = serde_json::from_str(&json).unwrap();
    assert_eq!(back, TransferDirection::Upload);
}

#[test]
fn transfer_control_transitions() {
    let c = TransferControl::default();
    assert_eq!(c.get(), RUNNING);
    c.set(PAUSED);
    assert!(c.is_paused());
    c.set(CANCELLED);
    assert!(c.is_cancelled());
}
