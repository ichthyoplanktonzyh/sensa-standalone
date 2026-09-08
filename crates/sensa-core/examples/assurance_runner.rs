//! Source-differential adapter; collation is an explicit host seam.
use sensa_core::assurance::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Case {
    Acquisition {
        candidates: Vec<AcquisitionCandidate>,
        plan: Plan,
        order: Vec<String>,
    },
    Retention {
        candidates: Vec<RetentionCandidate>,
        plan: Plan,
        order: Vec<String>,
    },
    Outcome {
        capability: Capability,
        correct: bool,
    },
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&input).unwrap();
    let out = cases
        .into_iter()
        .map(|c| match c {
            Case::Acquisition {
                candidates,
                plan,
                order,
            } => {
                let compare = |a: &str, b: &str| {
                    order
                        .iter()
                        .position(|k| k == a)
                        .cmp(&order.iter().position(|k| k == b))
                };
                json!(acquisition_fresh(&candidates, &plan, &compare))
            }
            Case::Retention {
                candidates,
                plan,
                order,
            } => {
                let compare = |a: &str, b: &str| {
                    order
                        .iter()
                        .position(|k| k == a)
                        .cmp(&order.iter().position(|k| k == b))
                };
                json!(retention_fresh(&candidates, &plan, &compare))
            }
            Case::Outcome {
                capability,
                correct,
            } => review_outcome(capability, correct).unwrap_or(Value::Null),
        })
        .collect::<Vec<_>>();
    println!("{}", serde_json::to_string(&out).unwrap());
}
