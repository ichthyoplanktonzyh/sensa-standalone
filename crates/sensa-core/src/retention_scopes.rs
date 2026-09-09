//! Scope admission is independent of protocol, presentation, and definition version.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Admission {
    pub learner_selectable: bool,
    pub stable_interaction_contract: bool,
    pub separable_performance: bool,
    pub independent_scheduling_value: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub scope_id: String,
    pub scope_version: String,
    pub kind: String,
    pub label: String,
    pub target_capability: String,
    pub prompt_channel: String,
    pub response_channel: String,
    pub content_requirement: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prerequisite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admission: Option<Admission>,
}
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub retention_target_id: String,
    pub learning_target_id: String,
    pub retention_scope_id: String,
    pub retention_scope_version: String,
    pub prerequisite_retention_target_id: Option<String>,
}
fn encode(v: &str) -> String {
    v.as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(b) {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
pub fn target_id(target: &str, scope: &str) -> String {
    format!("retention-target:{}:{}", encode(target), encode(scope))
}
pub struct Registry {
    definitions: Vec<Definition>,
    by_id: BTreeMap<String, usize>,
    default: usize,
}
impl Registry {
    pub fn new(definitions: Vec<Definition>) -> Result<Self, String> {
        let mut by_id = BTreeMap::new();
        let mut defaults = vec![];
        for (i, d) in definitions.iter().enumerate() {
            if [
                &d.scope_id,
                &d.scope_version,
                &d.label,
                &d.target_capability,
                &d.prompt_channel,
                &d.response_channel,
            ]
            .iter()
            .any(|s| s.trim().is_empty())
                || d.content_requirement.is_empty()
                || d.content_requirement.iter().any(|s| s.trim().is_empty())
            {
                return Err("invalid_scope_definition".into());
            }
            if by_id.insert(d.scope_id.clone(), i).is_some() {
                return Err("duplicate_scope".into());
            }
            match d.kind.as_str() {
                "default" => {
                    defaults.push(i);
                    if d.prerequisite.is_some() {
                        return Err("default_prerequisite".into());
                    }
                }
                "independent" => {
                    if !d.admission.as_ref().is_some_and(|a| {
                        a.learner_selectable
                            && a.stable_interaction_contract
                            && a.separable_performance
                            && a.independent_scheduling_value
                    }) {
                        return Err("scope_admission_required".into());
                    }
                }
                _ => return Err("unknown_scope_kind".into()),
            }
        }
        if defaults.len() != 1 {
            return Err("one_default_scope_required".into());
        }
        for d in &definitions {
            if let Some(p) = &d.prerequisite {
                let i = by_id.get(p).ok_or("unknown_prerequisite")?;
                if definitions[*i].prerequisite.is_some() {
                    return Err("scope_prerequisite_depth".into());
                }
            }
        }
        Ok(Self {
            default: defaults[0],
            definitions,
            by_id,
        })
    }
    pub fn get(&self, id: &str) -> Result<&Definition, String> {
        self.by_id
            .get(id)
            .map(|i| &self.definitions[*i])
            .ok_or("unknown_scope".into())
    }
    pub fn list(&self) -> &[Definition] {
        &self.definitions
    }
    pub fn resolve(&self, target: &str, selected: &[String]) -> Result<Vec<Target>, String> {
        if target.trim().is_empty() {
            return Err("invalid_learning_target".into());
        }
        let default = &self.definitions[self.default];
        let mut seen = BTreeSet::from([default.scope_id.as_str()]);
        let mut chosen = vec![];
        for id in selected {
            let d = self.get(id)?;
            if d.kind != "independent" {
                return Err("explicit_default_scope".into());
            }
            if seen.insert(id) {
                chosen.push(d)
            }
        }
        for d in &chosen {
            if d.prerequisite
                .as_ref()
                .is_some_and(|p| !seen.contains(p.as_str()))
            {
                return Err("unselected_prerequisite".into());
            }
        }
        chosen.sort_by_key(|d| {
            d.prerequisite
                .as_ref()
                .is_some_and(|p| p != &default.scope_id)
        });
        Ok(std::iter::once(default)
            .chain(chosen)
            .map(|d| Target {
                retention_target_id: target_id(target, &d.scope_id),
                learning_target_id: target.into(),
                retention_scope_id: d.scope_id.clone(),
                retention_scope_version: d.scope_version.clone(),
                prerequisite_retention_target_id: d
                    .prerequisite
                    .as_ref()
                    .map(|p| target_id(target, p)),
            })
            .collect())
    }
}
pub fn default_registry() -> Registry {
    Registry::new(vec![Definition {
        scope_id: "semantic_connection".into(),
        scope_version: "v1".into(),
        kind: "default".into(),
        label: "语义连接".into(),
        target_capability: "sense_expression_connection".into(),
        prompt_channel: "mixed_semantic_cue".into(),
        response_channel: "recognition_or_recall".into(),
        content_requirement: vec!["compact_learning_material".into()],
        prerequisite: None,
        admission: None,
    }])
    .expect("built-in scope contract")
}
