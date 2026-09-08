//! Orthogonal policy registry and pure composition-reference validation.
//! Registry identity is open; executable behavior is supplied through a trait.
use crate::progression::{
    self, CheckpointPolicy, CompletionOnlyPolicy, CompletionPolicy, FailureReset,
    ProgressionPolicy, Result,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub struct Registry {
    evaluation: BTreeSet<String>,
    progression: BTreeMap<String, Box<dyn ProgressionPolicy>>,
    completion: BTreeMap<String, CompletionPolicy>,
    repair: BTreeSet<String>,
    memory_outcome: BTreeSet<String>,
}
fn unique<I: IntoIterator<Item = String>>(items: I, label: &str) -> Result<BTreeSet<String>> {
    let mut set = BTreeSet::new();
    for id in items {
        progression::require_identity(&id, &format!("{label} identity"))?;
        if !set.insert(id.clone()) {
            return Err(format!("Duplicate {label} identity: {id}"));
        }
    }
    Ok(set)
}
impl Registry {
    pub fn new(
        evaluation: Vec<String>,
        progression: Vec<Box<dyn ProgressionPolicy>>,
        completion: Vec<(String, CompletionPolicy)>,
        repair: Vec<String>,
        memory_outcome: Vec<String>,
    ) -> Result<Self> {
        let evaluation = unique(evaluation, "Evaluation Policy")?;
        unique(
            progression.iter().map(|p| p.id().to_owned()),
            "Progression Policy",
        )?;
        unique(
            completion.iter().map(|(id, _)| id.clone()),
            "Completion Policy",
        )?;
        Ok(Self {
            evaluation,
            progression: progression
                .into_iter()
                .map(|p| (p.id().to_owned(), p))
                .collect(),
            completion: completion.into_iter().collect(),
            repair: unique(repair, "Repair Policy")?,
            memory_outcome: unique(memory_outcome, "Memory Outcome Policy")?,
        })
    }
    pub fn progression(&self, id: &str) -> Result<&dyn ProgressionPolicy> {
        self.progression
            .get(id)
            .map(|p| p.as_ref())
            .ok_or_else(|| format!("Unknown Progression Policy: {id}"))
    }
    pub fn completion(&self, id: &str) -> Result<&CompletionPolicy> {
        self.completion
            .get(id)
            .ok_or_else(|| format!("Unknown Completion Policy: {id}"))
    }
    pub fn has_evaluation(&self, id: &str) -> bool {
        self.evaluation.contains(id)
    }
    pub fn has_repair(&self, id: &str) -> bool {
        self.repair.contains(id)
    }
    pub fn has_memory_outcome(&self, id: &str) -> bool {
        self.memory_outcome.contains(id)
    }
    pub fn count(&self) -> usize {
        self.evaluation.len()
            + self.progression.len()
            + self.completion.len()
            + self.repair.len()
            + self.memory_outcome.len()
    }
}
/// Same existing policy identities as protocolPolicies.ts. Presence is a declared
/// capability, not a claim that an evaluator/renderer is available on a platform.
pub fn existing_policy_inventory() -> Result<Registry> {
    let strings = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    Registry::new(
        strings(&[
            "lightweight-practice-observation-v1",
            "learner-rating-v1",
            "structured-behavioral-v1",
            "four-stage-mixed-evaluation-v1",
        ]),
        vec![
            Box::new(CompletionOnlyPolicy::new("completion-only-v1")?),
            Box::new(CheckpointPolicy::new(
                "structured-current-checkpoint-reset-v1",
                FailureReset::Current,
            )?),
            Box::new(CheckpointPolicy::new("run-reset-v1", FailureReset::Run)?),
        ],
        vec![
            (
                "study-completion-v1".into(),
                CompletionPolicy::ProtocolCompletion,
            ),
            (
                "all-required-current-epoch-v1".into(),
                CompletionPolicy::AllRequiredCheckpoints {
                    require_same_progress_epoch: true,
                },
            ),
            (
                "one-review-one-outcome-v1".into(),
                CompletionPolicy::ProtocolCompletion,
            ),
            (
                "relearning-completion-v1".into(),
                CompletionPolicy::ProtocolCompletion,
            ),
        ],
        strings(&[
            "lightweight-retry-v1",
            "lightweight-rebinding-v1",
            "structured-targeted-repair-v1",
            "four-stage-detail-repair-v1",
            "four-stage-rebinding-v1",
        ]),
        strings(&["learner-rated-graded-v1", "behavioral-binary-graded-v1"]),
    )
}

/// Portable descriptors carry only fields consumed by the TS graph validator.
/// Platform code projects runtime methods (surfaceFor) into fixed purpose maps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub runtime_adapter_id: String,
    pub orchestration_id: String,
    pub evaluation_policy_id: String,
    pub progression_policy_id: String,
    pub completion_policy_id: String,
    pub repair_policy_id: String,
    pub memory_outcome_policy_id: Option<String>,
    pub checkpoint_definition_ids: Vec<String>,
    pub content_requirement: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "behavior",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Fallback {
    Blocked,
    LearnerExplicitDowngrade { target_profile_id: String },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lifecycle {
    pub provisioning_fallback: Fallback,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub profile_id: String,
    pub lifecycle: Lifecycle,
    pub protocols: Purposes<Binding>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Purposes<T> {
    pub initial_learning: T,
    pub retention_review: T,
    pub relearning: T,
}
impl<T> Purposes<T> {
    pub fn entries(&self) -> [(&'static str, &T); 3] {
        [
            ("initial_learning", &self.initial_learning),
            ("retention_review", &self.retention_review),
            ("relearning", &self.relearning),
        ]
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    pub adapter_id: String,
    pub retention_store_id: String,
    pub surfaces: Purposes<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Orchestration {
    pub orchestration_id: String,
    pub required_step_kinds: Vec<String>,
    pub initial_completion: Option<serde_json::Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub scope_id: String,
    pub content_requirement: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub profiles: Vec<Profile>,
    pub adapters: Vec<Adapter>,
    pub orchestrations: Vec<Orchestration>,
    pub surfaces: Vec<String>,
    pub retention_stores: Vec<String>,
    pub content_capability_ids: Vec<String>,
    pub step_kinds: Vec<String>,
    pub retention_scopes: Vec<Scope>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub profile_count: usize,
    pub adapter_count: usize,
    pub orchestration_count: usize,
    pub surface_count: usize,
    pub retention_store_count: usize,
    pub content_capability_count: usize,
    pub step_renderer_count: usize,
    pub retention_scope_count: usize,
    pub protocol_policy_count: usize,
}
fn reference(available: &BTreeSet<&str>, id: &str, message: String) -> Result<()> {
    if available.contains(id) {
        Ok(())
    } else {
        Err(message)
    }
}
pub fn validate_composition(g: &Graph, r: &Registry) -> Result<Summary> {
    for (label, count) in [
        ("profiles", g.profiles.len()),
        ("adapters", g.adapters.len()),
        ("orchestrations", g.orchestrations.len()),
        ("surfaces", g.surfaces.len()),
        ("retentionStores", g.retention_stores.len()),
        ("contentCapabilities", g.content_capability_ids.len()),
        ("stepRenderers", g.step_kinds.len()),
        ("retentionScopes", g.retention_scopes.len()),
        ("protocolPolicies", r.count()),
    ] {
        if count == 0 {
            return Err(format!(
                "Learning Runtime composition requires at least one {label}."
            ));
        }
    }
    let adapters = g.adapters.iter().map(|a| a.adapter_id.as_str()).collect();
    let orchestrations = g
        .orchestrations
        .iter()
        .map(|a| a.orchestration_id.as_str())
        .collect();
    let surfaces = g.surfaces.iter().map(String::as_str).collect();
    let stores = g.retention_stores.iter().map(String::as_str).collect();
    let capabilities = g
        .content_capability_ids
        .iter()
        .map(String::as_str)
        .collect();
    let steps = g.step_kinds.iter().map(String::as_str).collect();
    let profiles = g.profiles.iter().map(|p| p.profile_id.as_str()).collect();
    for p in &g.profiles {
        if let Fallback::LearnerExplicitDowngrade { target_profile_id } =
            &p.lifecycle.provisioning_fallback
        {
            reference(
                &profiles,
                target_profile_id,
                format!(
                    "Profile {} references unknown fallback {target_profile_id}.",
                    p.profile_id
                ),
            )?;
        }
        for (purpose, b) in p.protocols.entries() {
            let name = format!("{}/{purpose}", p.profile_id);
            if !r.has_evaluation(&b.evaluation_policy_id) {
                return Err(format!(
                    "Profile {name} references unknown Evaluation Policy {}.",
                    b.evaluation_policy_id
                ));
            }
            r.progression(&b.progression_policy_id)?;
            let completion = r.completion(&b.completion_policy_id)?;
            if !r.has_repair(&b.repair_policy_id) {
                return Err(format!(
                    "Profile {name} references unknown Repair Policy {}.",
                    b.repair_policy_id
                ));
            }
            if let Some(id) = &b.memory_outcome_policy_id
                && !r.has_memory_outcome(id)
            {
                return Err(format!(
                    "Profile {name} references unknown Memory Outcome Policy {id}."
                ));
            }
            if b.checkpoint_definition_ids
                .iter()
                .collect::<BTreeSet<_>>()
                .len()
                != b.checkpoint_definition_ids.len()
            {
                return Err(format!("Profile {name} declares duplicate Checkpoints."));
            }
            if matches!(completion, CompletionPolicy::AllRequiredCheckpoints { .. })
                && b.checkpoint_definition_ids.is_empty()
            {
                return Err(format!(
                    "Profile {name} requires Checkpoint completion without Checkpoints."
                ));
            }
            reference(
                &adapters,
                &b.runtime_adapter_id,
                format!(
                    "Profile {name} references unknown adapter {}.",
                    b.runtime_adapter_id
                ),
            )?;
            reference(
                &orchestrations,
                &b.orchestration_id,
                format!(
                    "Profile {name} references unknown orchestration {}.",
                    b.orchestration_id
                ),
            )?;
            // JS Map uses the last entry on duplicate identity; match that behavior here.
            let o = g
                .orchestrations
                .iter()
                .rev()
                .find(|o| o.orchestration_id == b.orchestration_id)
                .expect("validated reference");
            if purpose == "initial_learning"
                && o.initial_completion.as_ref().is_none_or(|v| match v {
                    serde_json::Value::Null => true,
                    serde_json::Value::Bool(value) => !value,
                    serde_json::Value::Number(value) => value.as_f64() == Some(0.0),
                    serde_json::Value::String(value) => value.is_empty(),
                    _ => false,
                })
            {
                return Err(format!(
                    "Profile {}/initial_learning lacks an Initial Completion contract.",
                    p.profile_id
                ));
            }
            for step in &o.required_step_kinds {
                reference(
                    &steps,
                    step,
                    format!(
                        "Orchestration {} requires unknown Step renderer {step}.",
                        o.orchestration_id
                    ),
                )?;
            }
            for capability in &b.content_requirement {
                reference(
                    &capabilities,
                    capability,
                    format!("Profile {name} references unknown content capability {capability}."),
                )?;
            }
        }
    }
    for a in &g.adapters {
        reference(
            &stores,
            &a.retention_store_id,
            format!(
                "Adapter {} references unknown Retention Store {}.",
                a.adapter_id, a.retention_store_id
            ),
        )?;
        for (purpose, surface) in a.surfaces.entries() {
            reference(
                &surfaces,
                surface,
                format!(
                    "Adapter {}/{purpose} references unknown Runtime Surface {surface}.",
                    a.adapter_id
                ),
            )?;
        }
    }
    for s in &g.retention_scopes {
        for capability in &s.content_requirement {
            reference(
                &capabilities,
                capability,
                format!(
                    "Retention Scope {} references unknown content capability {capability}.",
                    s.scope_id
                ),
            )?;
        }
    }
    Ok(Summary {
        profile_count: g.profiles.len(),
        adapter_count: g.adapters.len(),
        orchestration_count: g.orchestrations.len(),
        surface_count: g.surfaces.len(),
        retention_store_count: g.retention_stores.len(),
        content_capability_count: g.content_capability_ids.len(),
        step_renderer_count: g.step_kinds.len(),
        retention_scope_count: g.retention_scopes.len(),
        protocol_policy_count: r.count(),
    })
}
