//! Platform-independent domain decisions. No storage, network or UI dependencies.
//! Protocol progression, settlement eligibility and scheduling are separate seams.
pub mod assurance;
pub mod assurance_queue;
pub mod four_stage;
pub mod planning;
pub mod policies;
pub mod progression;
pub mod protocol;
pub mod scheduling;
pub mod settlement;

use chrono::{DateTime, Utc};
pub use protocol::{Action, PROTOCOL, Phase, transition};
pub use scheduling::ReviewSchedule as InitialSchedule;
pub use settlement::SCHEDULING_POLICY;

/// Compatibility entry for the first native slice. Uses the same scheduler as
/// review settlement; only initial completion may initialize new memory.
pub fn initial_schedule(at: DateTime<Utc>) -> Result<InitialSchedule, &'static str> {
    scheduling::compute_review_schedule(
        &scheduling::ScheduleState::empty(String::new()),
        &settlement::consumer_scheduler_config(),
        2,
        at,
    )
}
