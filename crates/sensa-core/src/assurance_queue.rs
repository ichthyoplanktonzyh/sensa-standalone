//! High-assurance acquisition lifecycle. Executes evaluated learner outcomes;
//! published material admission, actual grading and durable settlement remain
//! application responsibilities. Undo here is protocol-local, never FSRS undo.
use crate::{assurance::*, progression::*};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
const CAPS: [Capability; 4] = [
    Capability::ContextualRecognition,
    Capability::MeaningToFormRecall,
    Capability::NovelContextTransfer,
    Capability::BoundaryDiscrimination,
];
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Package {
    pub package_id: String,
    pub sense_id: String,
    pub retention_target_id: String,
    pub run_id: String,
    pub inventory: Inventory,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub package_id: String,
    pub sense_id: String,
    pub retention_target_id: String,
    pub phase: String,
    pub introduced: bool,
    pub declared_mastery: bool,
    pub protocol_progress: State,
    pub repair_counts: BTreeMap<Capability, u32>,
    pub failure_counts: BTreeMap<Capability, u32>,
    pub last_assessment_action_key: BTreeMap<Capability, String>,
    pub last_action_ordinal: i64,
    pub total_attempts: u32,
    pub total_correct: u32,
    pub transfer_scenario_index: u32,
    pub skipped: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Session {
    index: u32,
    package_index: usize,
    definition: Value,
    settled: bool,
    result: Option<bool>,
    transfer_scenario_index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    recall_outcome: Option<Recall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transfer_outcome: Option<Transfer>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Recall {
    Independent,
    FirstLetter,
    Choice,
    Miss,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Transfer {
    Success,
    Repair,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Event {
    Evaluated {
        event: Box<Event>,
        attempt_id: String,
    },
    Next,
    Introduction,
    Recognition {
        correct: bool,
    },
    Recall {
        outcome: Recall,
    },
    Transfer {
        outcome: Transfer,
    },
    Boundary {
        correct: bool,
    },
    Settle {
        correct: bool,
    },
    Mistake,
    Mastery {
        target: String,
        mastered: bool,
    },
    Skip,
    Undo,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    states: Vec<Target>,
    sessions: Vec<Session>,
    current: Option<Session>,
    total_attempts: u32,
    total_correct: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Queue {
    format_version: u32,
    packages: Vec<Package>,
    min_gap: u32,
    progress_target: u32,
    start_time: i64,
    target_order: Vec<String>,
    frame: Frame,
    undo: Vec<Frame>,
    events: Vec<Event>,
    #[serde(default)]
    evaluation_identity: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    progression_policies: BTreeMap<String, String>,
}
fn checkpoint(c: Capability) -> String {
    format!("structured-acquisition:{}", c.key())
}
fn status(t: &Target, c: Capability) -> &'static str {
    match t
        .protocol_progress
        .checkpoint_credits
        .get(&checkpoint(c))
        .map(|c| &c.status)
    {
        Some(CreditStatus::Credited) => "passed",
        Some(CreditStatus::Failed) => "failed",
        _ => "unresolved",
    }
}
fn increment(n: &mut u32) -> Result<()> {
    *n = n.checked_add(1).ok_or("Acquisition counter overflow.")?;
    Ok(())
}
impl Queue {
    pub fn new(
        packages: Vec<Package>,
        min_gap: u32,
        progress_target: Option<u32>,
        start_time: i64,
        target_order: Vec<String>,
    ) -> Result<Self> {
        let mut ids = BTreeSet::new();
        let mut runs = BTreeSet::new();
        for p in &packages {
            if p.retention_target_id.trim().is_empty() {
                return Err(format!(
                    "Package {} has an empty Retention Target identity.",
                    p.package_id
                ));
            }
            if !ids.insert(p.retention_target_id.clone()) {
                return Err(format!(
                    "Duplicate Retention Target identity: {}",
                    p.retention_target_id
                ));
            }
            if !runs.insert(p.run_id.clone()) {
                return Err("Duplicate Protocol Run identity.".into());
            }
            if !p
                .inventory
                .actions
                .iter()
                .any(|a| a["kind"] == "introduction" && intent(a) == "instruction")
            {
                return Err(format!(
                    "Package {} has no executable Introduction action.",
                    p.package_id
                ));
            }
            for c in &p.inventory.required_capabilities {
                if !p.inventory.actions.iter().any(|a| {
                    a["kind"] == "acquisition_gate"
                        && a["capability"] == c.key()
                        && intent(a) == "assessment"
                }) {
                    return Err(format!(
                        "Package {} has no executable action for {}.",
                        p.package_id,
                        c.key()
                    ));
                }
            }
        }
        if target_order.len() != ids.len()
            || target_order.iter().cloned().collect::<BTreeSet<_>>() != ids
        {
            return Err("Invalid acquisition target collation.".into());
        }
        let target = progress_target.unwrap_or(packages.iter().try_fold(0u32, |n, p| {
            n.checked_add(1 + p.inventory.required_capabilities.len() as u32)
                .ok_or("Acquisition progress target overflow.")
        })?);
        let counts = || CAPS.into_iter().map(|c| (c, 0)).collect();
        let states = packages
            .iter()
            .map(|p| {
                Ok(Target {
                    package_id: p.package_id.clone(),
                    sense_id: p.sense_id.clone(),
                    retention_target_id: p.retention_target_id.clone(),
                    phase: "new".into(),
                    introduced: false,
                    declared_mastery: false,
                    protocol_progress: create_state(&p.run_id, &progress_definition(&p.inventory))?,
                    repair_counts: counts(),
                    failure_counts: counts(),
                    last_assessment_action_key: BTreeMap::new(),
                    last_action_ordinal: -1,
                    total_attempts: 0,
                    total_correct: 0,
                    transfer_scenario_index: 0,
                    skipped: false,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let mut q = Self {
            format_version: 1,
            packages,
            min_gap,
            progress_target: target,
            start_time,
            target_order,
            frame: Frame {
                states,
                sessions: vec![],
                current: None,
                total_attempts: 0,
                total_correct: 0,
            },
            undo: vec![],
            events: vec![],
            evaluation_identity: None,
            progression_policies: BTreeMap::new(),
        };
        q.next()?;
        Ok(q)
    }
    /// Pin each target's resolved strategy before the first learner event.
    /// Profiles are names for compositions; they are never dispatch branches here.
    pub fn with_progression_policies(mut self, bindings: BTreeMap<String, String>) -> Result<Self> {
        if !self.events.is_empty() {
            return Err("Cannot replace an active progression policy.".into());
        }
        for (target, policy) in &bindings {
            if !self
                .packages
                .iter()
                .any(|p| &p.retention_target_id == target)
                || !matches!(
                    policy.as_str(),
                    "structured-current-checkpoint-reset-v1" | "run-reset-v1"
                )
            {
                return Err("Unsupported structured progression binding.".into());
            }
            crate::policies::existing_policy_inventory()?.progression(policy)?;
        }
        self.progression_policies = bindings;
        Ok(self)
    }
    fn complete(t: &Target) -> bool {
        t.introduced && t.protocol_progress.completed
    }
    pub fn is_done(&self) -> bool {
        self.frame
            .states
            .iter()
            .all(|t| t.skipped || Self::complete(t))
    }
    fn capture(&mut self) {
        self.undo.push(self.frame.clone());
        if self.undo.len() > 40 {
            self.undo.remove(0);
        }
    }
    fn current_capability(&self) -> Option<Capability> {
        serde_json::from_value(self.frame.current.as_ref()?.definition["capability"].clone()).ok()
    }
    fn intro(&self) -> bool {
        self.frame.current.as_ref().is_some_and(|s| {
            s.definition["kind"] == "introduction" && intent(&s.definition) == "instruction"
        })
    }
    fn candidate(&self, i: usize) -> AcquisitionCandidate {
        let t = &self.frame.states[i];
        let p = &self.packages[i];
        // Generic progress uses a sorted map; at most one pending repair is created by
        // this lifecycle, so no source JS insertion-order assumption is required here.
        let repair_basis = t
            .protocol_progress
            .pending_repairs
            .values()
            .next()
            .and_then(|r| {
                CAPS.into_iter()
                    .find(|c| checkpoint(*c) == r.checkpoint_id)
                    .map(|c| AcquisitionRepair {
                        capability: c,
                        failed_action_key: r.failed_action_id.clone(),
                        repair_count: t.repair_counts[&c],
                    })
            });
        AcquisitionCandidate {
            target_key: t.retention_target_id.clone(),
            last_step_ordinal: t.last_action_ordinal,
            repair_basis,
            inventory: p.inventory.clone(),
            introduced: t.introduced,
            gate_status: CAPS.into_iter().map(|c| (c, status(t, c).into())).collect(),
            last_assessment_action_key: t.last_assessment_action_key.clone(),
            transfer_scenario_index: t.transfer_scenario_index,
        }
    }
    fn next(&mut self) -> Result<()> {
        if self.frame.current.as_ref().is_some_and(|s| !s.settled) {
            return Ok(());
        }
        if self.is_done() {
            self.frame.current = None;
            return Ok(());
        }
        let ordinal = u32::try_from(self.frame.sessions.len())
            .map_err(|_| "Acquisition ordinal overflow.")?
            .checked_add(1)
            .ok_or("Acquisition ordinal overflow.")?;
        let pending = self
            .frame
            .states
            .iter()
            .enumerate()
            .filter(|(_, s)| !s.skipped && !Self::complete(s))
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        let candidates = pending
            .iter()
            .map(|i| self.candidate(*i))
            .collect::<Vec<_>>();
        let cmp = |a: &str, b: &str| {
            self.target_order
                .iter()
                .position(|id| id == a)
                .cmp(&self.target_order.iter().position(|id| id == b))
        };
        let Some(selection) = acquisition_fresh(
            &candidates,
            &Plan {
                ordinal,
                min_gap: self.min_gap,
            },
            &cmp,
        ) else {
            self.frame.current = None;
            return Ok(());
        };
        let i = pending[selection.candidate_index];
        self.frame.current = Some(Session {
            index: ordinal,
            package_index: i,
            definition: selection.definition,
            settled: false,
            result: None,
            transfer_scenario_index: self.frame.states[i].transfer_scenario_index,
            recall_outcome: None,
            transfer_outcome: None,
        });
        Ok(())
    }
    fn apply_observation(
        &mut self,
        c: Capability,
        kind: ObservationKind,
        suffix: &str,
    ) -> Result<()> {
        let s = self
            .frame
            .current
            .as_ref()
            .ok_or("Missing acquisition session.")?;
        let p = &self.packages[s.package_index];
        let t = &mut self.frame.states[s.package_index];
        let action = s.definition["actionKey"]
            .as_str()
            .ok_or("Invalid acquisition action identity.")?;
        let identity = self.evaluation_identity.clone().unwrap_or_else(|| {
            format!(
                "{}:{}:{}:{}",
                t.protocol_progress.protocol_run_id, s.index, action, suffix
            )
        });
        let observation = Observation {
            observation_id: format!("{identity}:observation"),
            attempt_id: format!("{identity}:attempt"),
            action_id: action.into(),
            kind,
            checkpoint_id: Some(checkpoint(c)),
            evidence_ids: if kind == ObservationKind::CheckpointSatisfied {
                vec![format!("{identity}:evidence")]
            } else {
                vec![]
            },
        };
        t.protocol_progress = decide_and_apply(
            &progress_definition(&p.inventory),
            crate::policies::existing_policy_inventory()?.progression(
                self.progression_policies
                    .get(&p.retention_target_id)
                    .map(String::as_str)
                    .unwrap_or("structured-current-checkpoint-reset-v1"),
            )?,
            &t.protocol_progress,
            &observation,
            &format!("{identity}:decision"),
        )?
        .state;
        Ok(())
    }
    fn introduction(&mut self) -> Result<()> {
        if !self.intro() || self.frame.current.as_ref().is_none_or(|s| s.settled) {
            return Ok(());
        }
        self.capture();
        let s = self.frame.current.as_mut().unwrap();
        let t = &mut self.frame.states[s.package_index];
        t.introduced = true;
        t.phase = "acquiring".into();
        t.last_action_ordinal = i64::from(s.index);
        s.settled = true;
        s.result = None;
        self.frame.sessions.push(s.clone());
        Ok(())
    }
    fn gate(
        &mut self,
        c: Capability,
        correct: bool,
        recall: Option<Recall>,
        transfer: Option<Transfer>,
    ) -> Result<()> {
        if self.current_capability() != Some(c)
            || self.frame.current.as_ref().is_none_or(|s| s.settled)
        {
            return Ok(());
        }
        self.capture();
        let repair = intent(&self.frame.current.as_ref().unwrap().definition) == "repair";
        if repair {
            self.apply_observation(c, ObservationKind::RepairCompleted, "repair")?;
            let s = self.frame.current.as_mut().unwrap();
            let t = &mut self.frame.states[s.package_index];
            increment(t.repair_counts.get_mut(&c).unwrap())?;
            t.last_action_ordinal = i64::from(s.index);
            t.phase = "acquiring".into();
            s.settled = true;
            s.result = None;
            self.frame.sessions.push(s.clone());
            return Ok(());
        }
        {
            let s = self.frame.current.as_mut().unwrap();
            s.recall_outcome = recall;
            s.transfer_outcome = transfer;
            if transfer == Some(Transfer::Repair) {
                increment(&mut self.frame.states[s.package_index].transfer_scenario_index)?;
            }
        }
        self.apply_observation(
            c,
            if correct {
                ObservationKind::CheckpointSatisfied
            } else {
                ObservationKind::CheckpointNotSatisfied
            },
            "assessment",
        )?;
        let s = self.frame.current.as_mut().unwrap();
        let t = &mut self.frame.states[s.package_index];
        s.settled = true;
        s.result = Some(correct);
        increment(&mut self.frame.total_attempts)?;
        increment(&mut t.total_attempts)?;
        t.last_assessment_action_key.insert(
            c,
            s.definition["actionKey"]
                .as_str()
                .ok_or("Invalid acquisition action identity.")?
                .into(),
        );
        if correct {
            increment(&mut t.total_correct)?;
            increment(&mut self.frame.total_correct)?;
        } else {
            increment(t.failure_counts.get_mut(&c).unwrap())?;
        }
        t.last_action_ordinal = i64::from(s.index);
        t.phase = if Self::complete(t) {
            "retaining"
        } else {
            "acquiring"
        }
        .into();
        self.frame.sessions.push(s.clone());
        Ok(())
    }
    fn mistake(&mut self) -> Result<()> {
        let Some(c) = self.current_capability() else {
            return Ok(());
        };
        if intent(&self.frame.current.as_ref().unwrap().definition) == "repair" {
            return Ok(());
        }
        self.capture();
        let settled = self.frame.current.as_ref().unwrap().settled;
        if !settled {
            let s = self.frame.current.as_mut().unwrap();
            s.settled = true;
            increment(&mut self.frame.total_attempts)?;
            increment(&mut self.frame.states[s.package_index].total_attempts)?;
        }
        self.apply_observation(
            c,
            ObservationKind::CheckpointNotSatisfied,
            "learner-correction",
        )?;
        let s = self.frame.current.as_mut().unwrap();
        let t = &mut self.frame.states[s.package_index];
        t.last_assessment_action_key.insert(
            c,
            s.definition["actionKey"]
                .as_str()
                .ok_or("Invalid acquisition action identity.")?
                .into(),
        );
        increment(t.failure_counts.get_mut(&c).unwrap())?;
        t.skipped = false;
        t.phase = "acquiring".into();
        t.last_action_ordinal = i64::from(s.index);
        s.result = Some(false);
        if !settled {
            self.frame.sessions.push(s.clone());
        }
        Ok(())
    }
    fn mastery(&mut self, target: &str, mastered: bool) {
        let Some(i) = self
            .packages
            .iter()
            .position(|p| p.retention_target_id == target)
        else {
            return;
        };
        if self.frame.states[i].declared_mastery == mastered {
            return;
        }
        self.capture();
        let t = &mut self.frame.states[i];
        t.declared_mastery = mastered;
        t.skipped = mastered;
        if let Some(s) = self
            .frame
            .current
            .as_mut()
            .filter(|s| s.package_index == i && mastered && !s.settled)
        {
            s.settled = true;
            s.result = None;
            self.frame.sessions.push(s.clone());
        }
    }
    fn inner(&mut self, event: &Event) -> Result<()> {
        match event {
            Event::Evaluated { event, attempt_id } => {
                if self.evaluation_identity.is_some()
                    || attempt_id.trim().is_empty()
                    || matches!(event.as_ref(), Event::Evaluated { .. })
                {
                    return Err("Invalid evaluation identity.".into());
                }
                self.evaluation_identity = Some(attempt_id.clone());
                self.inner(event)?;
                self.evaluation_identity = None;
            }
            Event::Next => self.next()?,
            Event::Introduction => self.introduction()?,
            Event::Recognition { correct } => {
                self.gate(Capability::ContextualRecognition, *correct, None, None)?
            }
            Event::Recall { outcome } => self.gate(
                Capability::MeaningToFormRecall,
                *outcome == Recall::Independent,
                Some(*outcome),
                None,
            )?,
            Event::Transfer { outcome } => self.gate(
                Capability::NovelContextTransfer,
                *outcome == Transfer::Success,
                None,
                Some(*outcome),
            )?,
            Event::Boundary { correct } => {
                self.gate(Capability::BoundaryDiscrimination, *correct, None, None)?
            }
            Event::Settle { correct } => {
                if self.intro() {
                    if *correct {
                        self.introduction()?;
                    }
                } else if let Some(c) = self.current_capability() {
                    self.gate(
                        c,
                        *correct,
                        None,
                        if c == Capability::NovelContextTransfer {
                            Some(if *correct {
                                Transfer::Success
                            } else {
                                Transfer::Repair
                            })
                        } else {
                            None
                        },
                    )?;
                }
            }
            Event::Mistake => self.mistake()?,
            Event::Mastery { target, mastered } => self.mastery(target, *mastered),
            Event::Skip => {
                if let Some(s) = &self.frame.current {
                    let target = self.packages[s.package_index].retention_target_id.clone();
                    self.mastery(&target, true);
                }
            }
            Event::Undo => {
                if let Some(frame) = self.undo.pop() {
                    self.frame = frame;
                }
            }
        };
        Ok(())
    }
    /// Failed commands leave the caller's state unchanged. Application-level
    /// operation identities are still required before this reaches persistence.
    pub fn execute(&mut self, event: Event) -> Result<()> {
        let mut next = self.clone();
        next.inner(&event)?;
        next.events.push(event);
        *self = next;
        Ok(())
    }
    fn session_value(&self, s: &Session) -> Value {
        let p = &self.packages[s.package_index];
        let mut action = s.definition.clone();
        action["ordinal"] = json!(s.index);
        action["totalTarget"] = json!(self.progress_target);
        action["packageId"] = json!(p.package_id);
        action["senseId"] = json!(p.sense_id);
        action["retentionTargetId"] = json!(p.retention_target_id);
        action["reason"] = json!(if intent(&s.definition) == "repair" {
            "repair"
        } else if s.definition["kind"] == "introduction" {
            "new"
        } else {
            "acquisition_ready"
        });
        let mut value = json!({"index":s.index,"totalTarget":self.progress_target,"action":action,"settled":s.settled,"result":s.result,"transferScenarioIndex":s.transfer_scenario_index});
        if let Some(o) = s.recall_outcome {
            value["recallOutcome"] = json!(o);
        }
        if let Some(o) = s.transfer_outcome {
            value["transferOutcome"] = json!(o);
        }
        value
    }
    /// Content-free view; material admission and rendering retain their own seam.
    pub fn view(&self) -> Value {
        let session = self.frame.current.as_ref().map(|s| self.session_value(s));
        let action=session.as_ref().map(|s|{let a=&s["action"];json!({"packageId":a["packageId"],"senseId":a["senseId"],"retentionTargetId":a["retentionTargetId"],"capability":a["capability"],"intent":a["intent"],"reason":a["reason"]})});
        let targets=self.packages.iter().zip(&self.frame.states).map(|(p,t)|json!({"packageId":t.package_id,"senseId":t.sense_id,"retentionTargetId":t.retention_target_id,"phase":t.phase,"introduced":t.introduced,"declaredMastery":t.declared_mastery,"graduated":Self::complete(t),"gates":required_gates(&p.inventory).into_iter().map(|c|json!({"capability":c,"status":status(t,c),"repairing":t.protocol_progress.pending_repairs.contains_key(&checkpoint(c))})).collect::<Vec<_>>()})).collect::<Vec<_>>();
        json!({"projection":{"currentAction":action,"targets":targets},"session":session,"states":self.frame.states,"done":self.is_done(),"graduated":self.frame.states.iter().filter(|t|Self::complete(t)).map(|t|&t.retention_target_id).collect::<Vec<_>>(),"stats":{"sessionsCompleted":self.frame.sessions.len(),"totalAttempts":self.frame.total_attempts,"correctAttempts":self.frame.total_correct,"accuracy":if self.frame.total_attempts==0{100.0}else{(f64::from(self.frame.total_correct)/f64::from(self.frame.total_attempts)*100.0).round()},"masteredTargetCount":self.frame.states.iter().filter(|t|t.skipped||Self::complete(t)).count(),"totalTargets":self.packages.len(),"startTime":self.start_time}})
    }
    pub fn restore(encoded: &str) -> Result<Self> {
        let saved: Self = serde_json::from_str(encoded).map_err(|e| e.to_string())?;
        if saved.format_version != 1 {
            return Err("Unsupported assurance queue version.".into());
        }
        let mut next = Self::new(
            saved.packages.clone(),
            saved.min_gap,
            Some(saved.progress_target),
            saved.start_time,
            saved.target_order.clone(),
        )?;
        next = next.with_progression_policies(saved.progression_policies.clone())?;
        for event in &saved.events {
            next.execute(event.clone())?;
        }
        if serde_json::to_value(&next).map_err(|e| e.to_string())?
            != serde_json::to_value(&saved).map_err(|e| e.to_string())?
        {
            return Err("Assurance queue snapshot history mismatch.".into());
        }
        Ok(next)
    }
}
