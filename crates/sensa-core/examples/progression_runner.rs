//! Test-only JSON adapter. Unknown policy IDs never select a default behavior.
use sensa_core::{policies::*, progression::*};
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
    Create {
        run: String,
        definition: Definition,
    },
    Apply {
        definition: Definition,
        state: State,
        decision: Decision,
    },
    Decide {
        definition: Definition,
        state: State,
        observation: Observation,
        decision_id: String,
        policy_id: String,
    },
    Composition {
        graph: Graph,
    },
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Value> = serde_json::from_str(&input).unwrap();
    let output: Vec<_> = cases
        .into_iter()
        .map(|raw| {
            let result: Result<Value> = (|| {
                let c: Case = serde_json::from_value(raw).map_err(|e| e.to_string())?;
                let registry = existing_policy_inventory()?;
                match c {
                    Case::Create { run, definition } => {
                        create_state(&run, &definition).map(|v| json!(v))
                    }
                    Case::Apply {
                        definition,
                        state,
                        decision,
                    } => apply_decision(&definition, &state, &decision).map(|v| json!(v)),
                    Case::Decide {
                        definition,
                        state,
                        observation,
                        decision_id,
                        policy_id,
                    } => decide_and_apply(
                        &definition,
                        registry.progression(&policy_id)?,
                        &state,
                        &observation,
                        &decision_id,
                    )
                    .map(|v| json!(v)),
                    Case::Composition { graph } => {
                        validate_composition(&graph, &registry).map(|v| json!(v))
                    }
                }
            })();
            match result {
                Ok(v) => json!({"ok":v}),
                Err(e) => json!({"error":e}),
            }
        })
        .collect();
    println!("{}", serde_json::to_string(&output).unwrap());
}
