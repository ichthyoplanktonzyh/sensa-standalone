//! Versioned policy resolution and content readiness. No storage or scheduler writes.
use crate::policies::{Binding, Purposes};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyRef {
    pub profile_id: String,
    pub profile_version: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assignment {
    pub assignment_id: String,
    pub revision: u32,
    pub policy: PolicyRef,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentScope {
    Target,
    Curriculum,
    Learner,
    System,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectivePolicy {
    pub policy: PolicyRef,
    pub scope: AssignmentScope,
    pub assignment_id: Option<String>,
    pub assignment_revision: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolutionInput {
    pub committed: Option<EffectivePolicy>,
    pub target: Option<Assignment>,
    pub curriculum: Option<Assignment>,
    pub learner: Option<Assignment>,
    pub system: PolicyRef,
}
pub fn resolve_policy(input: &ResolutionInput) -> Result<EffectivePolicy> {
    if let Some(committed) = &input.committed {
        return Ok(committed.clone());
    }
    for (scope, assignment) in [
        (AssignmentScope::Target, &input.target),
        (AssignmentScope::Curriculum, &input.curriculum),
        (AssignmentScope::Learner, &input.learner),
    ] {
        if let Some(a) = assignment {
            if a.assignment_id.trim().is_empty() || a.revision == 0 {
                return Err("invalid_policy_assignment".into());
            }
            return Ok(EffectivePolicy {
                policy: a.policy.clone(),
                scope,
                assignment_id: Some(a.assignment_id.clone()),
                assignment_revision: Some(a.revision),
            });
        }
    }
    Ok(EffectivePolicy {
        policy: input.system.clone(),
        scope: AssignmentScope::System,
        assignment_id: None,
        assignment_revision: None,
    })
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Readiness {
    Ready,
    Preparing,
    Blocked,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadinessView {
    pub status: Readiness,
    pub label: String,
    pub detail: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capability {
    pub view: ReadinessView,
    pub provisioned: bool,
    pub materialization_id: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityResolution {
    pub view: ReadinessView,
    pub provisioned: bool,
    pub materialization_ids: Vec<String>,
}
pub fn conjoin_content(
    requirements: &[String],
    provider: &BTreeMap<String, Capability>,
) -> Result<CapabilityResolution> {
    if requirements.is_empty() {
        return Err("Content requirements must not be empty.".into());
    }
    let mut all = Vec::new();
    for id in requirements {
        all.push(
            provider
                .get(id)
                .ok_or_else(|| format!("Unknown content capability: {id}"))?,
        );
    }
    for c in &all {
        if c.provisioned != c.materialization_id.is_some() {
            return Err("Content provisioning fact and Materialization identity disagree.".into());
        }
    }
    let mut view = all[0].view.clone();
    for c in &all[1..] {
        if c.view.status > view.status {
            view = c.view.clone();
        }
    }
    Ok(CapabilityResolution {
        view,
        provisioned: all.iter().all(|c| c.provisioned),
        materialization_ids: all
            .iter()
            .filter_map(|c| c.materialization_id.clone())
            .collect(),
    })
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSpec {
    pub protocol_id: String,
    pub protocol_version: String,
    #[serde(flatten)]
    pub binding: Binding,
    pub content_demands: Vec<serde_json::Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub profile_id: String,
    pub profile_version: String,
    pub lifecycle: serde_json::Value,
    pub protocols: Purposes<ProtocolSpec>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurposePlan {
    pub binding: ProtocolSpec,
    pub readiness: ReadinessView,
    pub provisioned: bool,
    pub materialization_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningPlan {
    pub effective: EffectivePolicy,
    pub profile: Profile,
    pub purposes: Purposes<PurposePlan>,
}
pub fn resolve_plan(
    effective: EffectivePolicy,
    profile: &Profile,
    provider: &BTreeMap<String, Capability>,
    runtime_adapters: &[String],
) -> Result<LearningPlan> {
    if effective.policy.profile_id != profile.profile_id
        || effective.policy.profile_version != profile.profile_version
    {
        return Err("policy_version_mismatch".into());
    }
    let purpose = |spec: &ProtocolSpec| -> Result<PurposePlan> {
        let c = conjoin_content(&spec.binding.content_requirement, provider)?;
        let readiness = if !runtime_adapters.contains(&spec.binding.runtime_adapter_id) {
            ReadinessView {
                status: Readiness::Blocked,
                label: "当前设备暂不支持此学习方式".into(),
                detail:
                    "所选方式的运行能力尚未接入。可以保留选择等待支持，或在首次学习前明确更换方式。"
                        .into(),
            }
        } else if c.view.status == Readiness::Ready && !c.provisioned {
            ReadinessView {
                status: Readiness::Blocked,
                label: "学习材料尚不可用".into(),
                detail: "准备状态不能代替实际材料，当前无法开始学习。".into(),
            }
        } else {
            c.view.clone()
        };
        Ok(PurposePlan {
            binding: spec.clone(),
            readiness,
            provisioned: c.provisioned,
            materialization_ids: c.materialization_ids,
        })
    };
    Ok(LearningPlan {
        effective,
        profile: profile.clone(),
        purposes: Purposes {
            initial_learning: purpose(&profile.protocols.initial_learning)?,
            retention_review: purpose(&profile.protocols.retention_review)?,
            relearning: purpose(&profile.protocols.relearning)?,
        },
    })
}
