use std::io::{self, Read};
fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).unwrap();
    let cases: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    let results: Vec<bool> = cases
        .iter()
        .map(|v| {
            serde_json::from_value::<sensa_library::resources::Reference>(v["reference"].clone())
                .is_ok_and(|r| r.validate(&v["target"]).is_ok())
        })
        .collect();
    println!("{}", serde_json::to_string(&results).unwrap());
}
