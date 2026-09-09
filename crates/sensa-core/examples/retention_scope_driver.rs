use sensa_core::retention_scopes::{Definition, Registry};
use serde::Deserialize;
use std::io::{self, Read};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    definitions: Vec<Definition>,
    learning_target_id: String,
    selected: Vec<String>,
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let requests: Vec<serde_json::Value> = serde_json::from_str(&input).unwrap();
    let out: Vec<_> = requests
        .into_iter()
        .map(|v| {
            let run = || -> Result<_, String> {
                let r: Request = serde_json::from_value(v).map_err(|e| e.to_string())?;
                Registry::new(r.definitions)?.resolve(&r.learning_target_id, &r.selected)
            };
            match run() {
                Ok(t) => serde_json::json!({"ok":true,"targets":t}),
                Err(_) => serde_json::json!({"ok":false}),
            }
        })
        .collect();
    println!("{}", serde_json::to_string(&out).unwrap());
}
