use std::io::{self, Read};
fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let cases: Vec<serde_json::Value> = serde_json::from_str(&s).unwrap();
    let out: Vec<_> = cases
        .into_iter()
        .map(|v| match sensa_library::semantic::validate_proposal(v) {
            Ok(v) => serde_json::json!({"accepted":true,"proposal":v}),
            Err(_) => serde_json::json!({"accepted":false}),
        })
        .collect();
    println!("{}", serde_json::to_string(&out).unwrap());
}
