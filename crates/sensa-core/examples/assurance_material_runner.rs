use sensa_core::{
    assurance::Capability,
    assurance_material::{self, Answer, Support},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    package: String,
    sense: String,
    task: String,
    capability: Capability,
}
#[derive(Deserialize)]
struct Input {
    release: Value,
    requests: Vec<Request>,
    evaluations: Vec<Eval>,
    #[serde(default)]
    repairs: Vec<Value>,
}
#[derive(Deserialize)]
struct Eval {
    resource: Value,
    support: Support,
    reviewing: bool,
    answer: Answer,
}
fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).unwrap();
    let input: Input = serde_json::from_str(&raw).unwrap();
    let resources = input
        .requests
        .iter()
        .map(|r| {
            match assurance_material::resolve(
                &input.release,
                &r.package,
                &r.sense,
                &r.task,
                r.capability,
            ) {
                Ok(v) => json!({"ok":v}),
                Err(e) => json!({"error":e}),
            }
        })
        .collect::<Vec<_>>();
    let evaluations = input
        .evaluations
        .iter()
        .map(|e| {
            match assurance_material::evaluate(&e.resource, e.support, e.reviewing, &e.answer) {
                Ok(v) => json!({"ok":v}),
                Err(e) => json!({"error":e}),
            }
        })
        .collect::<Vec<_>>();
    let inventories = input.release["packages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| assurance_material::inventory(p).unwrap())
        .collect::<Vec<_>>();
    let repairs = input
        .repairs
        .iter()
        .map(|r| {
            match assurance_material::repair_teaching(
                &input.release,
                r["package"].as_str().unwrap(),
                &r["reference"],
            ) {
                Ok(v) => json!({"ok":v}),
                Err(e) => json!({"error":e}),
            }
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        json!({"resources":resources,"evaluations":evaluations,"inventories":inventories,"repairs":repairs})
    );
}
