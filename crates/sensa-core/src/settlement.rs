//! Purpose-specific result eligibility for the pinned consumer lightweight policy.
//! A decision is not a persisted fact: the application commits it with its attempt.
use crate::protocol::{Action, Phase, Purpose, consumer_purpose, transition};
use crate::scheduling::{ReviewSchedule, ScheduleState, SchedulerConfig, compute_review_schedule};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

pub const SCHEDULING_POLICY: &str = "sensa-lightweight-scheduling-v1";
pub fn consumer_scheduler_config() -> SchedulerConfig {
    SchedulerConfig {
        learning_steps_minutes: vec![],
        relearning_steps_minutes: vec![],
        enable_fuzz: false,
        ..SchedulerConfig::default()
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewMemory {
    pub revision: String,
    pub due_at: DateTime<Utc>,
    pub schedule: ScheduleState,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DueTrigger {
    pub memory_revision: String,
    pub due_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "purpose", rename_all = "snake_case", deny_unknown_fields)]
pub enum SettlementContext {
    InitialLearning,
    RetentionReview {
        memory: ReviewMemory,
        trigger: DueTrigger,
    },
    Relearning,
}
impl SettlementContext {
    fn purpose(&self) -> Purpose {
        match self {
            Self::InitialLearning => Purpose::InitialLearning,
            Self::RetentionReview { .. } => Purpose::RetentionReview,
            Self::Relearning => Purpose::Relearning,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Settlement {
    ContinueInitial,
    StudyCompletion {
        evidence_level: &'static str,
        handoff_basis: &'static str,
        schedule: ReviewSchedule,
    },
    ReviewCompleted {
        evidence_level: &'static str,
        outcome_basis: &'static str,
        rating: Action,
        schedule: ReviewSchedule,
        next_eligible_at: Option<DateTime<Utc>>,
    },
    WaitRelearning {
        next_eligible_at: DateTime<Utc>,
    },
    RelearningCompletion {
        evidence_level: &'static str,
    },
}

pub fn decide_consumer_settlement(
    target_id: &str,
    protocol: &str,
    rating: Action,
    at: DateTime<Utc>,
    context: &SettlementContext,
) -> Result<Settlement, &'static str> {
    if consumer_purpose(protocol)? != context.purpose() {
        return Err("unsupported_protocol");
    }
    if rating == Action::Reveal {
        return Err("invalid_rating");
    }
    let next = transition(protocol, Phase::Reveal, rating)?;
    let retry = || {
        at.checked_add_signed(Duration::minutes(10))
            .ok_or("clock_out_of_range")
    };
    match context {
        SettlementContext::InitialLearning => {
            if next != Phase::Completed {
                return Ok(Settlement::ContinueInitial);
            }
            Ok(Settlement::StudyCompletion {
                evidence_level: "non_evidentiary",
                handoff_basis: "protocol_completion",
                schedule: compute_review_schedule(
                    &ScheduleState::empty(target_id.into()),
                    &consumer_scheduler_config(),
                    2,
                    at,
                )?,
            })
        }
        SettlementContext::Relearning => {
            if next == Phase::Waiting {
                Ok(Settlement::WaitRelearning {
                    next_eligible_at: retry()?,
                })
            } else {
                Ok(Settlement::RelearningCompletion {
                    evidence_level: "non_evidentiary",
                })
            }
        }
        SettlementContext::RetentionReview { memory, trigger } => {
            if memory.revision != trigger.memory_revision || memory.due_at != trigger.due_at {
                return Err("stale_due");
            }
            if memory.schedule.card_id != target_id {
                return Err("memory_mismatch");
            }
            if at < memory.due_at
                || memory
                    .schedule
                    .fsrs_last_reviewed_at
                    .is_none_or(|last| at < last)
            {
                return Err("clock_untrusted");
            }
            Ok(Settlement::ReviewCompleted {
                evidence_level: "self_report",
                outcome_basis: "learner_rated",
                rating,
                schedule: compute_review_schedule(
                    &memory.schedule,
                    &consumer_scheduler_config(),
                    match rating {
                        Action::Again => 0,
                        Action::Hard => 1,
                        Action::Good => 2,
                        Action::Reveal => unreachable!(),
                    },
                    at,
                )?,
                next_eligible_at: if rating == Action::Again {
                    Some(retry()?)
                } else {
                    None
                },
            })
        }
    }
}
