//! Platform-independent domain decisions. No storage, network or UI dependencies.
//! This first migration slice supports consumer-initial-v1 only.
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

pub const PROTOCOL: &str = "consumer-initial-v1";
pub const SCHEDULING_POLICY: &str = "sensa-lightweight-scheduling-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Recall,
    Reveal,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Reveal,
    Again,
    Hard,
    Good,
}

pub fn transition(protocol: &str, phase: Phase, action: Action) -> Result<Phase, &'static str> {
    if protocol != PROTOCOL {
        return Err("unsupported_protocol");
    }
    match (phase, action) {
        (Phase::Recall, Action::Reveal) => Ok(Phase::Reveal),
        (Phase::Reveal, Action::Again) => Ok(Phase::Recall),
        (Phase::Reveal, Action::Hard | Action::Good) => Ok(Phase::Completed),
        _ => Err("stale_step"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialSchedule {
    pub due_at: DateTime<Utc>,
    pub reps: u32,
    pub lapses: u32,
    pub fsrs_card_state: String,
    pub fsrs_step_index: Option<u32>,
    pub fsrs_stability: f64,
    pub fsrs_difficulty: f64,
    pub fsrs_last_reviewed_at: DateTime<Utc>,
    pub fsrs_scheduled_days: u32,
}

/// Exact initial-study initializer from Sensa's existing TS scheduling policy.
/// Both hard and good initialize with grade 3; this is not a review evaluator.
/// Fixed settings: FSRS-6 default weights, retention=.9, no steps/fuzz.
/// Other policies and due-review updates are deliberately not implemented here.
pub fn initial_schedule(at: DateTime<Utc>) -> Result<InitialSchedule, &'static str> {
    let stability: f64 = 2.3065;
    let difficulty = ((6.4133 - (2.0_f64 * 0.8334).exp() + 1.0) * 1e8).round() / 1e8;
    let days = stability.round() as u32;
    let due = at
        .checked_add_signed(Duration::days(i64::from(days)))
        .ok_or("clock_out_of_range")?;
    Ok(InitialSchedule {
        due_at: due,
        reps: 1,
        lapses: 0,
        fsrs_card_state: "review".into(),
        fsrs_step_index: None,
        fsrs_stability: stability,
        fsrs_difficulty: difficulty.clamp(1.0, 10.0),
        fsrs_last_reviewed_at: at,
        fsrs_scheduled_days: days,
    })
}
