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
pub(super) fn normalize(s: &str) -> String {
    s.nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
pub fn validate(resources: &[Resource], expression: &str, model_generated: bool) -> Result<()> {
    valid(resources.len() <= 8)?;
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
            "pronunciation" => {
                // Audio is admitted separately through digest-bound local media, never a URL.
                valid(
                    !model_generated
                        && fields(p, &["audioUrl", "phoneticNotation", "accentLabel"])
                        && p["audioUrl"].is_null()
                        && text(&p["phoneticNotation"])
                        && (p["accentLabel"].is_null() || text(&p["accentLabel"])),
                )?;
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

/// A bounded source-backed excerpt, explicitly aligned to one fixed local target.
/// Import is a learner trust decision, never platform certification or model authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reference {
    pub source_id: String,
    pub edition: String,
    pub entry_id: String,
    pub source_url: String,
    pub license: String,
    pub attribution: String,
    pub reviewer: String,
    pub sense_version_id: String,
    pub binding_version_id: String,
    pub expression: String,
    pub digest: String,
    pub resources: Vec<Resource>,
}
impl Reference {
    pub fn validate(&self, target: &Value) -> Result<()> {
        let ok = || -> bool {
            [
                &self.source_id,
                &self.edition,
                &self.entry_id,
                &self.license,
                &self.attribution,
                &self.reviewer,
                &self.expression,
            ]
            .iter()
            .all(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 2000)
                && self.sense_version_id == target["senseVersionId"].as_str().unwrap_or("")
                && self.binding_version_id == target["bindingVersionId"].as_str().unwrap_or("")
                && self.expression
                    == target["expression"]["surface"]
                        .as_str()
                        .or_else(|| target["proposal"]["expression"]["surface"].as_str())
                        .unwrap_or("")
                && self.source_url.encode_utf16().count() <= 2000
                && url::Url::parse(&self.source_url).is_ok_and(|u| {
                    u.scheme() == "https"
                        && u.username().is_empty()
                        && u.password().is_none()
                        && u.query().is_none()
                        && u.fragment().is_none()
                })
                && !self.resources.is_empty()
                && self.resources.len() <= 3
                && self.resources.iter().all(|r| {
                    matches!(
                        r.material_role_key.as_str(),
                        "language_structure" | "usage_guidance" | "pronunciation"
                    )
                })
        };
        if !ok() {
            return Err(Error::Rule("invalid_reference_source"));
        }
        validate(&self.resources, &self.expression, false)?;
        let kind = target["expression"]["type"]
            .as_str()
            .or_else(|| target["proposal"]["expression"]["type"].as_str())
            .unwrap_or("unspecified");
        let expected = match kind {
            "sentence" | "utterance_strategy" => "utterance",
            _ => kind,
        };
        if self.resources.iter().any(|r| {
            r.material_role_key == "language_structure"
                && ((r.content_payload["expressionTypeLabel"].is_null()
                    && r.content_payload["partOfSpeech"].is_null())
                    || r.content_payload["expressionKind"] != expected)
        }) {
            return Err(Error::Rule("invalid_reference_source"));
        }
        if self.digest
            != crate::semantic::hash(
                &serde_json::json!({"sourceId":self.source_id,"edition":self.edition,"entryId":self.entry_id,"sourceUrl":self.source_url,"license":self.license,"attribution":self.attribution,"reviewer":self.reviewer,"expression":self.expression,"resources":self.resources}),
            )?
        {
            return Err(Error::Rule("reference_digest_mismatch"));
        }
        Ok(())
    }
}
