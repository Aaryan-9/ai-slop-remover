use serde_json::Value;
use imaginary_crate::magic;

mod parser;

fn parse_payload(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap()
}

fn export_report() {
    todo!()
}

fn main() {
    let value = parse_payload("{}");
    magic(&value);
    parser::run();
    export_report();
}
