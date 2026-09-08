//! Local text-pack transport. This is not a generator candidate or a publication
//! approval endpoint. The imported snapshot is frozen; import never enrolls it.
use crate::{Error, Material, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LearningPack {
    pub format: String,
    pub id: String,
    pub version: String,
    pub title: String,
    pub protocol_version: String,
    pub target_language_tag: String,
    pub familiar_language_tag: String,
    pub learner_locale: String,
    pub materials: Vec<Material>,
}
impl LearningPack {
    pub fn parse(encoded: &str) -> Result<Self> {
        if encoded.len() > 2_000_000 {
            return Err(Error::Rule("pack_too_large"));
        }
        let pack: Self = serde_json::from_str(encoded).map_err(|_| Error::Rule("invalid_pack"))?;
        if pack.format != "sensa-local-text-pack-v1"
            || pack.protocol_version != sensa_core::PROTOCOL
            || pack.target_language_tag != "en"
            || pack.familiar_language_tag != "zh-CN"
            || pack.learner_locale != "zh-CN"
        {
            return Err(Error::Rule("unsupported_pack"));
        }
        if [&pack.id, &pack.version, &pack.title]
            .iter()
            .any(|v| v.trim().is_empty() || v.len() > 500)
            || pack.materials.is_empty()
            || pack.materials.len() > 100
        {
            return Err(Error::Rule("invalid_pack"));
        }
        let mut ids = HashSet::new();
        let mut targets = HashSet::new();
        for m in &pack.materials {
            if [&m.id, &m.sense_version_id, &m.binding_version_id]
                .iter()
                .any(|v| uuid::Uuid::parse_str(v).map_or(true, |id| id.to_string() != v.as_str()))
                || !ids.insert(&m.id)
                || !targets.insert((&m.sense_version_id, &m.binding_version_id))
                || [&m.scene, &m.sense, &m.expression, &m.source]
                    .iter()
                    .any(|v| v.trim().is_empty() || v.len() > 8000)
            {
                return Err(Error::Rule("invalid_pack"));
            }
            // The current consumer UI shows both these fields before Reveal.
            // Do not accept a pack that would disclose its own target there.
            let normalize = |value: &str| {
                value
                    .nfkc()
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_lowercase()
            };
            let expression = normalize(&m.expression);
            if normalize(&m.scene).contains(&expression)
                || normalize(&m.sense).contains(&expression)
            {
                return Err(Error::Rule("pack_reveals_expression"));
            }
        }
        Ok(pack)
    }
}
