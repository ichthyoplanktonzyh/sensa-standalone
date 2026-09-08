//! High-assurance Step selection. Immutable material inventory and trusted local
//! facts enter; Step definitions leave. No credit, Evidence or scheduling writes.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{cmp::Ordering, collections::BTreeMap};
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    ContextualRecognition,
    MeaningToFormRecall,
    NovelContextTransfer,
    BoundaryDiscrimination,
}
impl Capability {
    pub fn key(self) -> &'static str {
        match self {
            Self::ContextualRecognition => "contextual_recognition",
            Self::MeaningToFormRecall => "meaning_to_form_recall",
            Self::NovelContextTransfer => "novel_context_transfer",
            Self::BoundaryDiscrimination => "boundary_discrimination",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub required_capabilities: Vec<Capability>,
    pub actions: Vec<Value>,
    pub review_actions: Vec<Value>,
    #[serde(default)]
    pub repair_actions: Vec<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub ordinal: u32,
    pub min_gap: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcquisitionRepair {
    pub capability: Capability,
    pub failed_action_key: String,
    pub repair_count: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcquisitionCandidate {
    pub target_key: String,
    pub last_step_ordinal: i64,
    pub repair_basis: Option<AcquisitionRepair>,
    pub inventory: Inventory,
    pub introduced: bool,
    pub gate_status: BTreeMap<Capability, String>,
    pub last_assessment_action_key: BTreeMap<Capability, String>,
    pub transfer_scenario_index: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetentionRepair {
    pub capability: Capability,
    pub failed_review_action_key: String,
    pub repair_count: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Retest {
    pub capability: Capability,
    pub repair_count: u32,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    #[serde(default)]
    pub preferred_capabilities: Vec<Capability>,
    pub last_capability: Option<Capability>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetentionCandidate {
    pub target_key: String,
    pub last_step_ordinal: i64,
    pub repair_basis: Option<RetentionRepair>,
    pub inventory: Inventory,
    pub retaining: bool,
    pub retest: Option<Retest>,
    #[serde(default)]
    pub diagnostic_facts: Diagnostics,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub candidate_index: usize,
    pub definition: Value,
}
fn field<'a>(a: &'a Value, key: &str) -> Option<&'a str> {
    a.get(key).and_then(Value::as_str)
}
pub fn intent(a: &Value) -> &str {
    field(a, "intent").unwrap_or("assessment")
}
fn capability(a: &Value, c: Capability) -> bool {
    field(a, "capability") == Some(c.key())
}
pub fn required_gates(i: &Inventory) -> Vec<Capability> {
    let mut gates = vec![];
    for c in &i.required_capabilities {
        if !gates.contains(c) {
            gates.push(*c);
        }
    }
    gates
}
fn gate_actions(i: &Inventory, c: Capability) -> Vec<&Value> {
    i.actions
        .iter()
        .filter(|a| {
            capability(a, c)
                && field(a, "kind") == Some("acquisition_gate")
                && intent(a) == "assessment"
        })
        .collect()
}
fn stamp(a: Value, retention: bool) -> Value {
    let action_intent = intent(&a).to_owned();
    let kind = if action_intent == "repair" {
        "review_repair"
    } else if retention {
        "review_assessment"
    } else if action_intent == "instruction" {
        "introduction"
    } else {
        match field(&a, "capability") {
            Some("contextual_recognition") => "recognition",
            Some("meaning_to_form_recall") => "recall",
            Some("novel_context_transfer") => "transfer",
            _ => "review_assessment",
        }
    };
    let mut a = a;
    a["intent"] = json!(action_intent);
    a["stepKind"] = json!(kind);
    a
}
fn fallback(c: Capability) -> Value {
    json!({"role":if c==Capability::MeaningToFormRecall{"l1_bridge"}else{"experience_recap"},"key":null,"source":"scheduler_fallback","fallbackReason":"repair_binding_not_exposed"})
}
pub fn acquisition_repair(c: &AcquisitionCandidate, b: &AcquisitionRepair) -> Option<Value> {
    let actions = gate_actions(&c.inventory, b.capability);
    let base = actions
        .iter()
        .copied()
        .find(|a| field(a, "actionKey") == Some(&b.failed_action_key))
        .or_else(|| actions.first().copied())?;
    let base_key = field(base, "actionKey")?;
    let repair_key = format!("{base_key}.repair.{}", u64::from(b.repair_count) + 1);
    let definition = if let Some(declared) = c
        .inventory
        .repair_actions
        .iter()
        .find(|a| capability(a, b.capability) && intent(a) == "repair")
    {
        let mut d = declared.clone();
        if field(&d, "actionKey") == Some(base_key) {
            d["actionKey"] = json!(repair_key);
        }
        d["taskKey"] = Value::Null;
        d["kind"] = json!("acquisition_gate");
        d["intent"] = json!("repair");
        if d.get("repairForActionKey").is_none_or(Value::is_null) {
            d["repairForActionKey"] = json!(base_key);
        }
        if d.get("repairResourceRef").is_none_or(Value::is_null) {
            d["repairResourceRef"] = fallback(b.capability);
        }
        d
    } else {
        json!({"actionKey":repair_key,"capability":b.capability,"taskKey":null,"kind":"acquisition_gate","intent":"repair","repairForActionKey":base_key,"repairResourceRef":fallback(b.capability)})
    };
    Some(stamp(definition, false))
}
pub fn acquisition_next(c: &AcquisitionCandidate) -> Option<Value> {
    let definition = if !c.introduced {
        c.inventory
            .actions
            .iter()
            .find(|a| field(a, "kind") == Some("introduction") && intent(a) == "instruction")?
    } else {
        let pending = required_gates(&c.inventory)
            .into_iter()
            .find(|g| c.gate_status.get(g).is_none_or(|s| s != "passed"))?;
        let actions = gate_actions(&c.inventory, pending);
        if actions.is_empty() {
            return None;
        }
        if pending == Capability::NovelContextTransfer {
            actions[c.transfer_scenario_index as usize % actions.len()]
        } else if let Some(previous) = c
            .last_assessment_action_key
            .get(&pending)
            .filter(|s| !s.is_empty())
        {
            if actions.len() > 1 {
                actions
                    .iter()
                    .copied()
                    .find(|a| field(a, "actionKey") != Some(previous))
                    .unwrap_or(actions[0])
            } else {
                actions[0]
            }
        } else {
            actions[0]
        }
    };
    Some(stamp(definition.clone(), false))
}
fn retention_assessment(a: &Value) -> bool {
    field(a, "kind") == Some("retention_review")
        && intent(a) != "repair"
        && matches!(
            field(a, "capability"),
            Some("contextual_recognition" | "meaning_to_form_recall" | "novel_context_transfer")
        )
}
pub fn retention_next(c: &RetentionCandidate, p: &Plan) -> Option<Value> {
    let chosen = if c.retaining {
        let actions = c
            .inventory
            .review_actions
            .iter()
            .filter(|a| retention_assessment(a))
            .collect::<Vec<_>>();
        let preferred = c
            .diagnostic_facts
            .preferred_capabilities
            .iter()
            .find_map(|c| actions.iter().copied().find(|a| capability(a, *c)));
        if let Some(preferred) = preferred {
            preferred
        } else {
            let alternatives = actions
                .iter()
                .copied()
                .filter(|a| {
                    c.diagnostic_facts
                        .last_capability
                        .is_none_or(|cap| !capability(a, cap))
                })
                .collect::<Vec<_>>();
            let pool = if alternatives.is_empty() {
                &actions
            } else {
                &alternatives
            };
            if pool.is_empty() {
                return None;
            }
            pool[p.ordinal as usize % pool.len()]
        }
    } else {
        let retest = c.retest.as_ref()?;
        let actions = c
            .inventory
            .review_actions
            .iter()
            .filter(|a| {
                field(a, "kind") == Some("relearning_gate")
                    && intent(a) != "repair"
                    && capability(a, retest.capability)
            })
            .collect::<Vec<_>>();
        if actions.is_empty() {
            return None;
        }
        actions[retest.repair_count as usize % actions.len()]
    };
    Some(stamp(chosen.clone(), true))
}
pub fn retention_repair(c: &RetentionCandidate, b: &RetentionRepair) -> Option<Value> {
    let declared = c.inventory.repair_actions.iter().find(|a| {
        field(a, "kind") == Some("acquisition_gate")
            && intent(a) == "repair"
            && capability(a, b.capability)
            && a["repairResourceRef"]["source"] == "package_declared"
            && a["repairResourceRef"]["key"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
    })?;
    let mut d = declared.clone();
    d["actionKey"] = json!(format!(
        "{}.relearning.{}",
        field(declared, "actionKey")?,
        u64::from(b.repair_count) + 1
    ));
    d["taskKey"] = Value::Null;
    d["kind"] = json!("acquisition_gate");
    d["intent"] = json!("repair");
    d["repairForActionKey"] = json!(b.failed_review_action_key);
    Some(stamp(d, true))
}
/// The host supplies its stable target-key collation. Web uses localeCompare;
/// byte ordering is deliberately not substituted for locale ordering here.
fn choose(
    rows: &[(usize, &str, i64)],
    p: &Plan,
    acquisition: bool,
    compare: &dyn Fn(&str, &str) -> Ordering,
) -> Option<usize> {
    let eligible = |last: i64| {
        (acquisition && last < 0)
            || i128::from(p.ordinal) - i128::from(last) > i128::from(p.min_gap)
    };
    let has_eligible = rows.iter().any(|(_, _, last)| eligible(*last));
    rows.iter()
        .filter(|(_, _, last)| !has_eligible || eligible(*last))
        .min_by(|a, b| a.2.cmp(&b.2).then_with(|| compare(a.1, b.1)))
        .map(|r| r.0)
}
pub fn acquisition_fresh(
    c: &[AcquisitionCandidate],
    p: &Plan,
    compare: &dyn Fn(&str, &str) -> Ordering,
) -> Option<Selection> {
    let rows = c
        .iter()
        .enumerate()
        .map(|(i, c)| (i, c.target_key.as_str(), c.last_step_ordinal))
        .collect::<Vec<_>>();
    let i = choose(&rows, p, true, compare)?;
    let c = &c[i];
    let definition = if let Some(b) = &c.repair_basis {
        acquisition_repair(c, b)
    } else {
        acquisition_next(c)
    }?;
    Some(Selection {
        candidate_index: i,
        definition,
    })
}
pub fn retention_fresh(
    c: &[RetentionCandidate],
    p: &Plan,
    compare: &dyn Fn(&str, &str) -> Ordering,
) -> Option<Selection> {
    let rows = c
        .iter()
        .enumerate()
        .map(|(i, c)| (i, c.target_key.as_str(), c.last_step_ordinal))
        .collect::<Vec<_>>();
    let i = choose(&rows, p, false, compare)?;
    let c = &c[i];
    let definition = if let Some(b) = &c.repair_basis {
        retention_repair(c, b)
    } else {
        retention_next(c, p)
    }?;
    Some(Selection {
        candidate_index: i,
        definition,
    })
}
/// Pure classification only. Eligibility/evidence validation and one-due-one-
/// outcome transactions belong to the runtime, not this convenience projection.
pub fn review_outcome(c: Capability, correct: bool) -> Option<Value> {
    if c == Capability::BoundaryDiscrimination {
        return None;
    }
    Some(
        json!({"basis":if !correct{"retrieval_failed"}else if c==Capability::NovelContextTransfer{"transfer_confirmed"}else{"independent_retrieval"},"grade":if correct{"good"}else{"again"},"evidenceLevel":"behavioral","evidenceIds":[]}),
    )
}

/// The package's required Gate set defines this target's structured protocol;
/// conditional boundary requirements are not manufactured for other targets.
pub fn progress_definition(i: &Inventory) -> crate::progression::Definition {
    use crate::progression::{CheckpointDefinition, CompletionPolicy, Definition};
    Definition {
        protocol_id: "structured-acquisition".into(),
        protocol_version: "v1".into(),
        checkpoints: required_gates(i)
            .into_iter()
            .map(|c| CheckpointDefinition {
                checkpoint_id: format!("structured-acquisition:{}", c.key()),
                capability_objective_ids: vec![c.key().into()],
                required_for_completion: true,
            })
            .collect(),
        completion_policy: CompletionPolicy::AllRequiredCheckpoints {
            require_same_progress_epoch: true,
        },
    }
}
