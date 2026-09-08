//! Source-differential and cross-process recovery adapter, never a product API.
use sensa_core::four_stage::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Operation {
    Next,
    Settle { satisfied: bool },
    Feedback,
    Review { answer: Answer },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    mode: String,
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    candidates: Vec<Candidate>,
    #[serde(default)]
    run: String,
    #[serde(default = "gap")]
    min_gap: u32,
    snapshot: Option<String>,
    operations: Vec<Operation>,
}
fn gap() -> u32 {
    2
}
fn initial(c: Case) -> Result<Value, String> {
    let mut q = if let Some(s) = c.snapshot {
        Queue::restore(&s)?
    } else {
        Queue::new(c.ids, c.run, c.min_gap)?
    };
    let view = |q: &Queue| json!({"projection":q.projection(),"done":q.is_done()});
    let mut trace = vec![json!({"ok":view(&q)})];
    for op in c.operations {
        let result = match op {
            Operation::Next => q.next_session(),
            Operation::Settle { satisfied } => q.settle(satisfied),
            Operation::Feedback => q.complete_feedback(),
            _ => Err("Invalid operation.".into()),
        };
        trace.push(match result {
            Ok(_) => json!({"ok":view(&q)}),
            Err(error) => json!({"error":error,"state":view(&q)}),
        });
        // Roundtrip after every operation, including pending feedback and failed commands.
        q = Queue::restore(&serde_json::to_string(&q).unwrap())?;
    }
    Ok(json!({"trace":trace,"snapshot":serde_json::to_string(&q).unwrap()}))
}
fn review(c: Case) -> Result<Value, String> {
    let mut q = if let Some(s) = c.snapshot {
        ReviewQueue::restore(&s)?
    } else {
        ReviewQueue::new(c.candidates)?
    };
    let view =
        |q: &ReviewQueue| json!({"current":q.current(),"outcomes":q.outcomes(),"done":q.is_done()});
    let mut trace = vec![json!({"ok":view(&q)})];
    for op in c.operations {
        let result = match op {
            Operation::Next => q.next_session(),
            Operation::Review { answer } => q.settle(answer),
            Operation::Feedback => q.complete_feedback(),
            _ => Err("Invalid operation.".into()),
        };
        trace.push(match result {
            Ok(_) => json!({"ok":view(&q)}),
            Err(error) => json!({"error":error,"state":view(&q)}),
        });
        q = ReviewQueue::restore(&serde_json::to_string(&q).unwrap())?;
    }
    Ok(json!({"trace":trace,"snapshot":serde_json::to_string(&q).unwrap()}))
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&input).unwrap();
    let results = cases
        .into_iter()
        .map(|c| {
            match if c.mode == "initial" {
                initial(c)
            } else {
                review(c)
            } {
                Ok(v) => v,
                Err(error) => json!({"error":error}),
            }
        })
        .collect::<Vec<_>>();
    println!("{}", serde_json::to_string(&results).unwrap());
}
