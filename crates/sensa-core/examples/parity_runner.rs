//! No-cost differential-test adapter. Not linked into the production library.
use chrono::{DateTime, Utc};
use sensa_core::{
    protocol::{Action, Phase, transition},
    scheduling::{
        ReviewHistoryEvent, ScheduleState, SchedulerConfig, compute_review_schedule,
        rebuild_schedule,
    },
    settlement::{SettlementContext, decide_consumer_settlement},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Case {
    Rebuild {
        target_id: String,
        config: SchedulerConfig,
        events: Vec<ReviewHistoryEvent>,
    },
    Schedule {
        card: ScheduleState,
        config: SchedulerConfig,
        rating: u8,
        at: DateTime<Utc>,
    },
    Transition {
        protocol: String,
        phase: Phase,
        action: Action,
    },
    Settlement {
        target_id: String,
        protocol: String,
        action: Action,
        at: DateTime<Utc>,
        context: SettlementContext,
    },
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&input).unwrap();
    let output: Vec<Value> = cases
        .into_iter()
        .map(|case| {
            let result = match case {
                Case::Rebuild {
                    target_id,
                    config,
                    events,
                } => rebuild_schedule(&target_id, &config, &events).map(|(state, due)| {
                    let mut value = serde_json::to_value(state).unwrap();
                    value.as_object_mut().unwrap().remove("cardId");
                    value["dueAt"] = serde_json::to_value(due).unwrap();
                    value
                }),
                Case::Schedule {
                    card,
                    config,
                    rating,
                    at,
                } => compute_review_schedule(&card, &config, rating, at)
                    .map(|v| serde_json::to_value(v).unwrap()),
                Case::Transition {
                    protocol,
                    phase,
                    action,
                } => transition(&protocol, phase, action).map(|v| serde_json::to_value(v).unwrap()),
                Case::Settlement {
                    target_id,
                    protocol,
                    action,
                    at,
                    context,
                } => decide_consumer_settlement(&target_id, &protocol, action, at, &context)
                    .map(|v| serde_json::to_value(v).unwrap()),
            };
            match result {
                Ok(value) => json!({"ok":value}),
                Err(code) => json!({"error":code}),
            }
        })
        .collect();
    println!("{}", serde_json::to_string(&output).unwrap());
}
