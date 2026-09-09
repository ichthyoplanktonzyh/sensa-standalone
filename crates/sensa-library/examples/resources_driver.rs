use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let v: serde_json::Value = serde_json::from_str(&input).unwrap();
    let accepted =
        serde_json::from_value::<Vec<sensa_library::resources::Resource>>(v["resources"].clone())
            .is_ok_and(|r| sensa_library::resources::validate(&r, "tactful", false).is_ok());
    println!("{accepted}");
}
