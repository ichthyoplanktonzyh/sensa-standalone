use sensa_library::personal::Capture;
use serde_json::{Value, json};
use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Value> = serde_json::from_str(&input).unwrap();
    let out: Vec<Value> = cases
        .into_iter()
        .map(|v| match serde_json::from_value::<Capture>(v) {
            Ok(c) if c.validate().is_ok() => {
                json!({"accepted":true,"identity":c.identity(),"sourceLink":c.source_link()})
            }
            _ => json!({"accepted":false}),
        })
        .collect();
    println!("{}", json!(out));
}
