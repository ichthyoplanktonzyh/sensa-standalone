use serde_json::{Value, json};
use std::io::{self, Read};
fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).unwrap();
    let input: Value = serde_json::from_str(&raw).unwrap();
    let results = input
        .as_array()
        .unwrap()
        .iter()
        .map(|v| match sensa_core::runtime_release::validate(v) {
            Ok(()) => json!([]),
            Err(e) => json!(e),
        })
        .collect::<Vec<_>>();
    println!("{}", json!(results));
}
