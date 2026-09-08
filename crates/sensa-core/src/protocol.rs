//! Versioned protocol progression, independent of scheduling and persistence.
use serde::{Deserialize, Serialize};

pub const PROTOCOL: &str = "consumer-initial-v1";
pub const REVIEW_PROTOCOL: &str = "consumer-review-v1";
pub const RELEARNING_PROTOCOL: &str = "consumer-relearning-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Purpose {
    InitialLearning,
    RetentionReview,
    Relearning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Recall,
    Reveal,
    Waiting,
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

/// An explicit version binding. Unknown versions never fall back to lightweight.
/// Other protocol families can supply their own progression/evaluation modules.
pub fn consumer_purpose(protocol: &str) -> Result<Purpose, &'static str> {
    match protocol {
        PROTOCOL => Ok(Purpose::InitialLearning),
        REVIEW_PROTOCOL => Ok(Purpose::RetentionReview),
        RELEARNING_PROTOCOL => Ok(Purpose::Relearning),
        _ => Err("unsupported_protocol"),
    }
}

pub fn transition(protocol: &str, phase: Phase, action: Action) -> Result<Phase, &'static str> {
    let purpose = consumer_purpose(protocol)?;
    match (phase, action) {
        (Phase::Recall, Action::Reveal) => Ok(Phase::Reveal),
        (Phase::Reveal, Action::Again) => Ok(match purpose {
            Purpose::InitialLearning => Phase::Recall,
            Purpose::RetentionReview => Phase::Completed,
            Purpose::Relearning => Phase::Waiting,
        }),
        (Phase::Reveal, Action::Hard | Action::Good) => Ok(Phase::Completed),
        _ => Err("stale_step"),
    }
}
