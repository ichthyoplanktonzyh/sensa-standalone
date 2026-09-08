//! Protocol-local progress; no storage, scheduler, UI or Profile-name branching.
//! Migrated from Sensa's protocolProgression.ts. Decisions never mutate inputs.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointDefinition {
    pub checkpoint_id: String,
    pub capability_objective_ids: Vec<String>,
    pub required_for_completion: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CompletionPolicy {
    ProtocolCompletion,
    AllRequiredCheckpoints { require_same_progress_epoch: bool },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub protocol_id: String,
    pub protocol_version: String,
    pub checkpoints: Vec<CheckpointDefinition>,
    pub completion_policy: CompletionPolicy,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreditStatus {
    Unresolved,
    Credited,
    Failed,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credit {
    pub status: CreditStatus,
    pub credited_in_epoch: Option<u64>,
    pub last_observation_id: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingRepair {
    pub checkpoint_id: String,
    pub failed_action_id: String,
    pub observation_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub protocol_run_id: String,
    pub protocol_id: String,
    pub protocol_version: String,
    pub progress_epoch: u64,
    pub checkpoint_credits: BTreeMap<String, Credit>,
    pub pending_repairs: BTreeMap<String, PendingRepair>,
    pub reassessment_required_checkpoint_ids: Vec<String>,
    pub completed: bool,
    pub applied_decisions: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationKind {
    InstructionCompleted,
    PracticeCompleted,
    CheckpointSatisfied,
    CheckpointNotSatisfied,
    RepairCompleted,
    ProtocolCompleted,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    pub observation_id: String,
    pub attempt_id: String,
    pub action_id: String,
    pub kind: ObservationKind,
    pub checkpoint_id: Option<String>,
    pub evidence_ids: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "scope",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ResetScope {
    Current { checkpoint_id: String },
    DeclaredSet { checkpoint_ids: Vec<String> },
    Run,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Effect {
    CreditCheckpoint {
        checkpoint_id: String,
    },
    InvalidateCheckpoint {
        checkpoint_id: String,
    },
    ScheduleRepair {
        checkpoint_id: String,
        failed_action_id: String,
    },
    RequireReassessment {
        checkpoint_id: String,
    },
    ResetProgress {
        #[serde(flatten)]
        reset: ResetScope,
    },
    Advance,
    Complete,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Decision {
    pub decision_id: String,
    pub observation_id: String,
    pub progression_policy_id: String,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransitionResult {
    pub applied: bool,
    pub decision: Decision,
    pub state: State,
}

pub(super) fn require_identity(value: &str, label: &str) -> Result<()> {
    // ECMAScript trim, including BOM; Rust's Unicode whitespace differs at U+0085.
    let whitespace = |c: char| matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}');
    if value.trim_matches(whitespace).is_empty() {
        Err(format!("{label} must not be empty."))
    } else {
        Ok(())
    }
}
fn checkpoints(d: &Definition) -> Result<BTreeSet<String>> {
    require_identity(&d.protocol_id, "Protocol identity")?;
    require_identity(&d.protocol_version, "Protocol version")?;
    let mut ids = BTreeSet::new();
    for c in &d.checkpoints {
        require_identity(&c.checkpoint_id, "Checkpoint identity")?;
        if !ids.insert(c.checkpoint_id.clone()) {
            return Err(format!(
                "Duplicate Protocol Checkpoint identity: {}",
                c.checkpoint_id
            ));
        }
    }
    Ok(ids)
}
fn require_checkpoint(ids: &BTreeSet<String>, id: &str) -> Result<()> {
    if ids.contains(id) {
        Ok(())
    } else {
        Err(format!("Unknown Protocol Checkpoint: {id}"))
    }
}
pub fn create_state(run: &str, d: &Definition) -> Result<State> {
    require_identity(run, "Protocol Run identity")?;
    let ids = checkpoints(d)?;
    Ok(State {
        protocol_run_id: run.into(),
        protocol_id: d.protocol_id.clone(),
        protocol_version: d.protocol_version.clone(),
        progress_epoch: 0,
        checkpoint_credits: ids
            .into_iter()
            .map(|id| {
                (
                    id,
                    Credit {
                        status: CreditStatus::Unresolved,
                        credited_in_epoch: None,
                        last_observation_id: None,
                    },
                )
            })
            .collect(),
        pending_repairs: BTreeMap::new(),
        reassessment_required_checkpoint_ids: vec![],
        completed: false,
        applied_decisions: BTreeMap::new(),
    })
}
fn matching(d: &Definition, s: &State) -> Result<BTreeSet<String>> {
    let ids = checkpoints(d)?;
    if s.protocol_id != d.protocol_id || s.protocol_version != d.protocol_version {
        return Err(format!(
            "Protocol progress {} is pinned to {}@{}.",
            s.protocol_run_id, s.protocol_id, s.protocol_version
        ));
    }
    if s.checkpoint_credits
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>()
        != ids
    {
        return Err(format!(
            "Protocol progress {} does not match its Checkpoint definition.",
            s.protocol_run_id
        ));
    }
    Ok(ids)
}
fn satisfied(d: &Definition, s: &State) -> bool {
    match d.completion_policy {
        CompletionPolicy::ProtocolCompletion => true,
        CompletionPolicy::AllRequiredCheckpoints {
            require_same_progress_epoch,
        } => d
            .checkpoints
            .iter()
            .filter(|c| c.required_for_completion)
            .all(|c| {
                let credit = &s.checkpoint_credits[&c.checkpoint_id];
                credit.status == CreditStatus::Credited
                    && (!require_same_progress_epoch
                        || credit.credited_in_epoch == Some(s.progress_epoch))
                    && !s.pending_repairs.contains_key(&c.checkpoint_id)
                    && !s
                        .reassessment_required_checkpoint_ids
                        .contains(&c.checkpoint_id)
            }),
    }
}
fn invalidate(s: &mut State, id: &str) {
    let c = s
        .checkpoint_credits
        .get_mut(id)
        .expect("validated checkpoint");
    c.status = CreditStatus::Unresolved;
    c.credited_in_epoch = None;
    s.pending_repairs.remove(id);
    s.reassessment_required_checkpoint_ids.retain(|v| v != id);
}

// Sort recursively even if another workspace dependency enables serde_json's
// preserve_order feature. Receipt fingerprints must not depend on feature union.
fn canonicalize(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(fields) => serde_json::Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key, canonicalize(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.into_iter().map(canonicalize).collect())
        }
        value => value,
    }
}

pub fn apply_decision(d: &Definition, s: &State, decision: &Decision) -> Result<TransitionResult> {
    let ids = matching(d, s)?;
    require_identity(&decision.decision_id, "Transition Decision identity")?;
    require_identity(&decision.observation_id, "Observation identity")?;
    require_identity(
        &decision.progression_policy_id,
        "Progression Policy identity",
    )?;
    // Decision schema keys are ASCII and match TS canonicalize.
    let fingerprint = serde_json::to_string(&canonicalize(
        serde_json::to_value(decision).map_err(|e| e.to_string())?,
    ))
    .map_err(|e| e.to_string())?;
    if let Some(previous) = s.applied_decisions.get(&decision.decision_id) {
        if previous != &fingerprint {
            return Err(format!(
                "Transition Decision identity conflict: {}",
                decision.decision_id
            ));
        }
        return Ok(TransitionResult {
            applied: false,
            decision: decision.clone(),
            state: s.clone(),
        });
    }
    for e in &decision.effects {
        match e {
            Effect::CreditCheckpoint { checkpoint_id }
            | Effect::InvalidateCheckpoint { checkpoint_id }
            | Effect::ScheduleRepair { checkpoint_id, .. }
            | Effect::RequireReassessment { checkpoint_id } => {
                require_checkpoint(&ids, checkpoint_id)?
            }
            Effect::ResetProgress {
                reset: ResetScope::Current { checkpoint_id },
            } => require_checkpoint(&ids, checkpoint_id)?,
            Effect::ResetProgress {
                reset: ResetScope::DeclaredSet { checkpoint_ids },
            } => {
                if checkpoint_ids.is_empty() {
                    return Err(
                        "A declared-set Progress Reset requires at least one Checkpoint.".into(),
                    );
                }
                for id in checkpoint_ids {
                    require_checkpoint(&ids, id)?;
                }
            }
            _ => (),
        }
    }
    let mut next = s.clone();
    for e in &decision.effects {
        match e {
            Effect::CreditCheckpoint { checkpoint_id } => {
                next.checkpoint_credits.insert(
                    checkpoint_id.clone(),
                    Credit {
                        status: CreditStatus::Credited,
                        credited_in_epoch: Some(next.progress_epoch),
                        last_observation_id: Some(decision.observation_id.clone()),
                    },
                );
                next.pending_repairs.remove(checkpoint_id);
                next.reassessment_required_checkpoint_ids
                    .retain(|id| id != checkpoint_id);
            }
            Effect::InvalidateCheckpoint { checkpoint_id } => invalidate(&mut next, checkpoint_id),
            Effect::ScheduleRepair {
                checkpoint_id,
                failed_action_id,
            } => {
                next.checkpoint_credits.insert(
                    checkpoint_id.clone(),
                    Credit {
                        status: CreditStatus::Failed,
                        credited_in_epoch: None,
                        last_observation_id: Some(decision.observation_id.clone()),
                    },
                );
                next.pending_repairs.insert(
                    checkpoint_id.clone(),
                    PendingRepair {
                        checkpoint_id: checkpoint_id.clone(),
                        failed_action_id: failed_action_id.clone(),
                        observation_id: decision.observation_id.clone(),
                    },
                );
                next.reassessment_required_checkpoint_ids
                    .retain(|id| id != checkpoint_id);
            }
            Effect::RequireReassessment { checkpoint_id } => {
                invalidate(&mut next, checkpoint_id);
                next.reassessment_required_checkpoint_ids
                    .push(checkpoint_id.clone());
            }
            Effect::ResetProgress { reset } => {
                let selected: Vec<String> = match reset {
                    ResetScope::Run => {
                        next.progress_epoch = next
                            .progress_epoch
                            .checked_add(1)
                            .filter(|v| *v <= 9_007_199_254_740_991)
                            .ok_or("Progress epoch exceeds safe integer range.")?;
                        ids.iter().cloned().collect()
                    }
                    ResetScope::Current { checkpoint_id } => vec![checkpoint_id.clone()],
                    ResetScope::DeclaredSet { checkpoint_ids } => checkpoint_ids.clone(),
                };
                for id in selected {
                    invalidate(&mut next, &id);
                }
                next.completed = false;
            }
            Effect::Advance => (),
            Effect::Complete => next.completed = true,
        }
    }
    next.reassessment_required_checkpoint_ids
        .sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    next.reassessment_required_checkpoint_ids.dedup();
    next.applied_decisions
        .insert(decision.decision_id.clone(), fingerprint);
    if next.completed && !satisfied(d, &next) {
        return Err(format!(
            "Protocol {} cannot complete with unresolved Checkpoints.",
            d.protocol_id
        ));
    }
    Ok(TransitionResult {
        applied: true,
        decision: decision.clone(),
        state: next,
    })
}

/// Open behavior seam: additional registered policies require no kernel branches.
pub trait ProgressionPolicy: Send + Sync {
    fn id(&self) -> &str;
    fn decide(&self, d: &Definition, s: &State, o: &Observation) -> Result<Vec<Effect>>;
}
pub fn decide_and_apply(
    d: &Definition,
    policy: &dyn ProgressionPolicy,
    s: &State,
    o: &Observation,
    decision_id: &str,
) -> Result<TransitionResult> {
    if s.completed && o.kind != ObservationKind::CheckpointNotSatisfied {
        return Err(format!(
            "Protocol Run {} is already complete.",
            s.protocol_run_id
        ));
    }
    require_identity(&o.observation_id, "Observation identity")?;
    require_identity(&o.attempt_id, "Attempt identity")?;
    require_identity(&o.action_id, "Action identity")?;
    if let Some(id) = &o.checkpoint_id {
        require_checkpoint(&checkpoints(d)?, id)?;
    }
    let decision = Decision {
        decision_id: decision_id.into(),
        observation_id: o.observation_id.clone(),
        progression_policy_id: policy.id().into(),
        effects: policy.decide(d, s, o)?,
    };
    apply_decision(d, s, &decision)
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureReset {
    Current,
    Run,
}
pub struct CheckpointPolicy {
    id: String,
    failure_reset: FailureReset,
}
impl CheckpointPolicy {
    pub fn new(id: &str, failure_reset: FailureReset) -> Result<Self> {
        require_identity(id, "Progression Policy identity")?;
        Ok(Self {
            id: id.into(),
            failure_reset,
        })
    }
}
impl ProgressionPolicy for CheckpointPolicy {
    fn id(&self) -> &str {
        &self.id
    }
    fn decide(&self, d: &Definition, s: &State, o: &Observation) -> Result<Vec<Effect>> {
        let checkpoint = || {
            o.checkpoint_id.clone().ok_or_else(|| {
                format!(
                    "Observation {} requires a Protocol Checkpoint.",
                    o.observation_id
                )
            })
        };
        Ok(match o.kind {
            ObservationKind::CheckpointSatisfied => {
                let id = checkpoint()?;
                let mut effects = vec![
                    Effect::CreditCheckpoint {
                        checkpoint_id: id.clone(),
                    },
                    Effect::Advance,
                ];
                if let CompletionPolicy::AllRequiredCheckpoints {
                    require_same_progress_epoch,
                } = d.completion_policy
                    && d.checkpoints
                        .iter()
                        .filter(|c| c.required_for_completion)
                        .all(|c| {
                            c.checkpoint_id == id
                                || s.checkpoint_credits.get(&c.checkpoint_id).is_some_and(
                                    |credit| {
                                        credit.status == CreditStatus::Credited
                                            && (!require_same_progress_epoch
                                                || credit.credited_in_epoch
                                                    == Some(s.progress_epoch))
                                    },
                                )
                        })
                {
                    effects.push(Effect::Complete);
                }
                effects
            }
            ObservationKind::CheckpointNotSatisfied => {
                let id = checkpoint()?;
                vec![
                    Effect::ResetProgress {
                        reset: match self.failure_reset {
                            FailureReset::Current => ResetScope::Current {
                                checkpoint_id: id.clone(),
                            },
                            FailureReset::Run => ResetScope::Run,
                        },
                    },
                    Effect::ScheduleRepair {
                        checkpoint_id: id,
                        failed_action_id: o.action_id.clone(),
                    },
                ]
            }
            ObservationKind::RepairCompleted => vec![
                Effect::RequireReassessment {
                    checkpoint_id: checkpoint()?,
                },
                Effect::Advance,
            ],
            ObservationKind::InstructionCompleted | ObservationKind::PracticeCompleted => {
                vec![Effect::Advance]
            }
            ObservationKind::ProtocolCompleted => vec![Effect::Complete],
        })
    }
}
pub struct CompletionOnlyPolicy {
    id: String,
}
impl CompletionOnlyPolicy {
    pub fn new(id: &str) -> Result<Self> {
        require_identity(id, "Progression Policy identity")?;
        Ok(Self { id: id.into() })
    }
}
impl ProgressionPolicy for CompletionOnlyPolicy {
    fn id(&self) -> &str {
        &self.id
    }
    fn decide(&self, _: &Definition, _: &State, o: &Observation) -> Result<Vec<Effect>> {
        Ok(vec![if o.kind == ObservationKind::ProtocolCompleted {
            Effect::Complete
        } else {
            Effect::Advance
        }])
    }
}
