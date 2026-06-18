//! Transfer engine: queue state, pause/cancel control, and worker spawning.

mod pool;
mod scheduler;
mod worker;

pub use pool::ConnectionPool;
pub use scheduler::{enqueue, Pending, Scheduler};

use std::sync::atomic::{AtomicU8, Ordering};

/// Lifecycle control shared between the command layer and a running worker.
///
/// State is an atomic so pause/resume/cancel can be signalled without locking.
#[derive(Debug)]
pub struct TransferControl {
    state: AtomicU8,
}

pub const RUNNING: u8 = 0;
pub const PAUSED: u8 = 1;
pub const CANCELLED: u8 = 2;

impl Default for TransferControl {
    fn default() -> Self {
        Self {
            state: AtomicU8::new(RUNNING),
        }
    }
}

impl TransferControl {
    pub fn set(&self, state: u8) {
        self.state.store(state, Ordering::SeqCst);
    }
    pub fn get(&self) -> u8 {
        self.state.load(Ordering::SeqCst)
    }
    pub fn is_cancelled(&self) -> bool {
        self.get() == CANCELLED
    }
    pub fn is_paused(&self) -> bool {
        self.get() == PAUSED
    }
}
