//! Optional teaching resources share their immutable material's identity and provenance.
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resource {
    pub material_role_key: String,
    pub content_payload: Value,
}
fn valid(ok: bool) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(Error::Rule("invalid_optional_resource"))
    }
}
fn text(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 2000)
}
fn fields(value: &Value, names: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|o| o.len() == names.len() && names.iter().all(|k| o.contains_key(*k)))
}
fn normalize(s: &str) -> String {
    s.nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
pub fn validate(resources: &[Resource], expression: &str, model_generated: bool) -> Result<()> {
    valid(resources.len() <= 7)?;
    let mut counts = std::collections::HashMap::new();
    for r in resources {
        let role = r.material_role_key.as_str();
        let count = counts.entry(role).or_insert(0);
        *count += 1;
        valid(*count <= if role == "recall_support" { 4 } else { 1 })?;
        let p = &r.content_payload;
        match role {
            "recall_support" | "scene_bridge" => {
                valid(fields(p, &["text"]) && text(&p["text"]))?;
                if role == "recall_support" {
                    valid(
                        !normalize(p["text"].as_str().unwrap()).contains(&normalize(expression)),
                    )?;
                }
            }
            "language_structure" => {
                valid(
                    !model_generated
                        && fields(
                            p,
                            &["expressionKind", "expressionTypeLabel", "partOfSpeech"],
                        ),
                )?;
                valid(matches!(
                    p["expressionKind"].as_str(),
                    Some("word" | "phrase" | "construction" | "utterance" | "unspecified")
                ))?;
                for k in ["expressionTypeLabel", "partOfSpeech"] {
                    valid(p[k].is_null() || text(&p[k]))?;
                }
            }
            "usage_guidance" => {
                valid(!model_generated && fields(p, &["example"]) && text(&p["example"]))?
            }
            _ => return Err(Error::Rule("invalid_optional_resource")),
        }
    }
    Ok(())
}
pub fn from_candidate(v: &Value, expression: &str) -> Result<Vec<Resource>> {
    let values = match v.get("resources") {
        None => vec![],
        Some(v) => serde_json::from_value(v.clone())
            .map_err(|_| Error::Rule("invalid_optional_resource"))?,
    };
    validate(&values, expression, true)?;
    Ok(values)
}
