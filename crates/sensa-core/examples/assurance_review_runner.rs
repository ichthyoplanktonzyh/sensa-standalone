use sensa_core::assurance_review::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    #[serde(default)]
    candidates: Vec<Candidate>,
    #[serde(default)]
    min_gap: u32,
    progress_target: Option<u32>,
    #[serde(default)]
    start_time: i64,
    #[serde(default)]
    order: Vec<String>,
    snapshot: Option<String>,
    events: Vec<Event>,
}
fn run(c: Case) -> Result<Value, String> {
    let mut q = if let Some(s) = c.snapshot {
        Queue::restore(&s)?
    } else {
        Queue::new(
            c.candidates,
            c.order,
            c.min_gap,
            c.progress_target,
            c.start_time,
        )?
    };
    let mut trace = vec![json!({"ok":q.view(),"effects":[]})];
    for event in c.events {
        let r = q.execute(event);
        trace.push(match r {
            Ok(effects) => json!({"ok":q.view(),"effects":effects}),
            Err(error) => json!({"error":error,"state":q.view()}),
        });
        q = Queue::restore(&serde_json::to_string(&q).unwrap())?;
    }
    Ok(json!({"trace":trace,"snapshot":serde_json::to_string(&q).unwrap()}))
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&input).unwrap();
    let out = cases
        .into_iter()
        .map(|c| match run(c) {
            Ok(v) => v,
            Err(error) => json!({"error":error}),
        })
        .collect::<Vec<_>>();
    println!("{}", serde_json::to_string(&out).unwrap());
}
