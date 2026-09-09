//! No-cost integration driver. The caller owns an isolated test-library path.
use sensa_library::*;
use serde_json::{Value, json};
use std::{
    io::{self, Read},
    path::PathBuf,
};
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let v: Value = serde_json::from_str(&input).unwrap();
    let path = PathBuf::from(v["path"].as_str().unwrap());
    let s = open_library(&path).unwrap();
    if v["action"].is_null() {
        println!("{}", serde_json::to_string(&s).unwrap());
        return;
    }
    let command = Command {
        operation_id: v["operationId"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        library_id: s.library_id.clone(),
        expected_revision: v["revision"]
            .as_u64()
            .map(|r| u32::try_from(r).unwrap())
            .unwrap_or(s.revision),
        action: serde_json::from_value(v["action"].clone()).unwrap(),
    };
    match execute(&path, command) {
        Ok(s) => println!("{}", serde_json::to_string(&s).unwrap()),
        Err(e) => println!("{}", json!({"error":e.to_string()})),
    }
}
