//! High-assurance review/relearning queue. Effects are proposals for an application
//! transaction, never direct scheduler writes. Local undo retains outcome receipts.
use crate::assurance::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub package_id: String,
    pub sense_id: String,
    pub retention_target_id: String,
    /// Pinned host identity for this due encounter (independent of Action).
    pub outcome_key: String,
    pub inventory: Inventory,
    pub phase: String,
    pub relearning: Option<Value>,
    #[serde(default)]
    pub diagnostic_facts: Diagnostics,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Event {
    Next,
    Settle { result: Value },
    Repair,
    Exclude,
    Undo,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Session {
    candidate: usize,
    phase: String,
    cycle: Option<Value>,
    action: Value,
    assessment_kind: String,
    step_kind: String,
    settled: bool,
    result: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    candidate: usize,
    phase: String,
    cycle: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    pending: Vec<Pending>,
    current: Option<Session>,
    targets: Vec<Value>,
    completed: u32,
    ordinal: u32,
    attempts: u32,
    correct: u32,
    last: BTreeMap<String, i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Queue {
    version: u32,
    candidates: Vec<Candidate>,
    order: Vec<String>,
    min_gap: u32,
    progress_target: u32,
    start_time: i64,
    total: u32,
    frame: Frame,
    undo: Vec<Frame>,
    receipts: BTreeMap<String, Value>,
    events: Vec<Event>,
}
fn cap(v: &Value) -> Option<Capability> {
    serde_json::from_value(v.clone()).ok()
}
fn cycle_cap(v: &Option<Value>) -> Option<Capability> {
    let v = v.as_ref()?;
    if v["repairTarget"]["kind"] != "capability" {
        return None;
    }
    cap(&v["repairTarget"]["capability"])
}
fn classification(c: Capability) -> (&'static str, &'static str) {
    match c {
        Capability::ContextualRecognition => ("context_recognition", "语境辨义"),
        Capability::MeaningToFormRecall => ("meaning_to_form_recall", "词形提取"),
        Capability::NovelContextTransfer => ("novel_context_transfer", "新语境迁移"),
        Capability::BoundaryDiscrimination => ("boundary_contrast", "义项边界"),
    }
}
impl Queue {
    pub fn new(
        candidates: Vec<Candidate>,
        order: Vec<String>,
        min_gap: u32,
        progress_target: Option<u32>,
        start_time: i64,
    ) -> Result<Self> {
        let mut ids = BTreeSet::new();
        for c in &candidates {
            if c.retention_target_id.trim().is_empty() {
                return Err(format!(
                    "Package {} has an empty Retention Target identity.",
                    c.package_id
                ));
            }
            if !ids.insert(c.retention_target_id.clone()) {
                return Err(format!(
                    "Duplicate Retention Target identity: {}",
                    c.retention_target_id
                ));
            }
            if c.phase != "retaining" && c.phase != "relearning" {
                return Err("Invalid retention phase.".into());
            }
            if c.outcome_key.is_empty() {
                return Err("Missing due outcome identity.".into());
            }
            if c.phase == "relearning" && c.relearning.is_none() {
                return Err(format!(
                    "Relearning candidate {} lacks a Relearning Cycle.",
                    c.retention_target_id
                ));
            }
            if let Some(r) = &c.relearning
                && r["retentionTargetId"] != c.retention_target_id
            {
                return Err(format!(
                    "Relearning Cycle {} belongs to another Retention Target.",
                    r["cycleId"].as_str().unwrap_or("")
                ));
            }
        }
        if order.len() != ids.len() || order.iter().cloned().collect::<BTreeSet<_>>() != ids {
            return Err("Invalid retention target collation.".into());
        }
        let mut q = Self {
            version: 1,
            candidates,
            order,
            min_gap,
            progress_target: 1,
            start_time,
            total: 0,
            frame: Frame {
                pending: vec![],
                current: None,
                targets: vec![],
                completed: 0,
                ordinal: 0,
                attempts: 0,
                correct: 0,
                last: BTreeMap::new(),
            },
            undo: vec![],
            receipts: BTreeMap::new(),
            events: vec![],
        };
        for (i, c) in q.candidates.iter().enumerate() {
            let pending = Pending {
                candidate: i,
                phase: c.phase.clone(),
                cycle: c.relearning.clone(),
            };
            let projected = q.project_candidate(&pending)?;
            let executable = if let Some(b) = &projected.repair_basis {
                retention_repair(&projected, b).is_some()
            } else {
                retention_next(
                    &projected,
                    &Plan {
                        ordinal: 1,
                        min_gap,
                    },
                )
                .is_some()
            };
            if !executable {
                continue;
            }
            q.frame.targets.push(json!({"packageId":c.package_id,"senseId":c.sense_id,"retentionTargetId":c.retention_target_id,"status":if c.phase=="retaining"{"review_pending"}else if c.relearning.as_ref().is_some_and(|r|r["stage"]=="retest_pending"){"relearning_retest"}else{"relearning_repair"},"currentCapability":cycle_cap(&c.relearning),"memoryOutcome":null,"reviewSettled":c.phase=="relearning","relearningCompleted":false}));
            q.frame.pending.push(pending);
        }
        q.total = q
            .frame
            .pending
            .len()
            .try_into()
            .map_err(|_| "Too many retention targets.")?;
        q.progress_target = progress_target.unwrap_or(q.total).max(1);
        q.next()?;
        Ok(q)
    }
    fn project_candidate(&self, p: &Pending) -> Result<RetentionCandidate> {
        let c = &self.candidates[p.candidate];
        let cycle = if p.phase == "relearning" {
            p.cycle.clone()
        } else {
            None
        };
        let capability = cycle_cap(&cycle);
        let count = cycle
            .as_ref()
            .and_then(|r| r["repairCount"].as_u64())
            .unwrap_or(0);
        let count = u32::try_from(count).map_err(|_| "Repair count overflow.")?;
        Ok(RetentionCandidate {
            target_key: c.retention_target_id.clone(),
            last_step_ordinal: *self.frame.last.get(&c.retention_target_id).unwrap_or(&-1),
            inventory: c.inventory.clone(),
            retaining: p.phase == "retaining",
            diagnostic_facts: c.diagnostic_facts.clone(),
            repair_basis: capability
                .filter(|_| {
                    cycle
                        .as_ref()
                        .is_some_and(|r| r["stage"] == "repair_pending")
                })
                .map(|capability| RetentionRepair {
                    capability,
                    failed_review_action_key: cycle.as_ref().unwrap()["failedReviewActionKey"]
                        .as_str()
                        .unwrap_or("")
                        .into(),
                    repair_count: count,
                }),
            retest: capability
                .filter(|_| {
                    cycle
                        .as_ref()
                        .is_some_and(|r| r["stage"] == "retest_pending")
                })
                .map(|capability| Retest {
                    capability,
                    repair_count: count,
                }),
        })
    }
    fn next(&mut self) -> Result<()> {
        if self.frame.current.as_ref().is_some_and(|s| !s.settled) {
            return Ok(());
        }
        self.frame.current = None;
        if self.frame.pending.is_empty() {
            return Ok(());
        }
        let ordinal = self
            .frame
            .ordinal
            .checked_add(1)
            .ok_or("Retention ordinal overflow.")?;
        let cs = self
            .frame
            .pending
            .iter()
            .map(|p| self.project_candidate(p))
            .collect::<Result<Vec<_>>>()?;
        let cmp = |a: &str, b: &str| {
            self.order
                .iter()
                .position(|id| id == a)
                .cmp(&self.order.iter().position(|id| id == b))
        };
        let Some(choice) = retention_fresh(
            &cs,
            &Plan {
                ordinal,
                min_gap: self.min_gap,
            },
            &cmp,
        ) else {
            return Ok(());
        };
        let p = self.frame.pending.remove(choice.candidate_index);
        let c = &self.candidates[p.candidate];
        let mut action = choice.definition;
        let capability = cap(&action["capability"]).ok_or("Invalid retention capability.")?;
        let repair = intent(&action) == "repair";
        action["ordinal"] = json!(ordinal);
        action["totalTarget"] = json!(self.progress_target);
        action["packageId"] = json!(c.package_id);
        action["senseId"] = json!(c.sense_id);
        action["retentionTargetId"] = json!(c.retention_target_id);
        action["reason"] = json!(if repair {
            "repair"
        } else if p.phase == "relearning" {
            "relearning"
        } else {
            "due"
        });
        let status = if p.phase == "retaining" {
            "reviewing"
        } else if repair {
            "relearning_repair"
        } else {
            "relearning_retest"
        };
        let id = c.retention_target_id.clone();
        let target = self.target(&id)?;
        target["status"] = json!(status);
        target["currentCapability"] = json!(capability);
        self.frame.current = Some(Session {
            candidate: p.candidate,
            phase: p.phase,
            cycle: p.cycle,
            assessment_kind: classification(capability).0.into(),
            step_kind: action["stepKind"].as_str().unwrap_or("").into(),
            action,
            settled: false,
            result: None,
        });
        Ok(())
    }
    fn target(&mut self, id: &str) -> Result<&mut Value> {
        self.frame
            .targets
            .iter_mut()
            .find(|t| t["retentionTargetId"] == id)
            .ok_or("Missing retention projection.".into())
    }
    fn capture(&mut self) {
        self.undo.push(self.frame.clone());
        if self.undo.len() > 40 {
            self.undo.remove(0);
        }
    }
    fn cycle(&self, s: &Session) -> Value {
        let c = &self.candidates[s.candidate];
        json!({"cycleId":c.outcome_key,"packageId":c.package_id,"senseId":c.sense_id,"retentionTargetId":c.retention_target_id,"repairTarget":{"kind":"capability","capability":s.action["capability"]},"failedReviewOutcomeKey":c.outcome_key,"failedReviewActionKey":s.action["actionKey"],"stage":"repair_pending","repairCount":0,"lastActionOrdinal":s.action["ordinal"]})
    }
    fn enqueue(&mut self, s: &Session) {
        self.frame.pending.push(Pending {
            candidate: s.candidate,
            phase: s.phase.clone(),
            cycle: s.cycle.clone(),
        });
    }
    fn step_finished(&mut self, s: &Session) -> Result<()> {
        self.frame.ordinal =
            serde_json::from_value(s.action["ordinal"].clone()).map_err(|e| e.to_string())?;
        self.frame.last.insert(
            self.candidates[s.candidate].retention_target_id.clone(),
            i64::from(self.frame.ordinal),
        );
        Ok(())
    }
    fn effect(&self, s: &Session, event: &str, cycle: &Value) -> Value {
        json!({"type":"relearning_progress","event":event,"candidateIndex":s.candidate,"candidatePhase":s.phase,"candidateCycle":s.cycle,"action":s.action,"cycle":cycle})
    }
    fn settle(&mut self, result: &Value) -> Result<Vec<Value>> {
        let Some(mut s) = self.frame.current.clone().filter(|s| !s.settled) else {
            return Ok(vec![]);
        };
        if intent(&s.action) == "repair" {
            return Err("A repair Action must be completed through completeRepair().".into());
        }
        if result["kind"] != s.assessment_kind {
            return Err(format!(
                "Review result kind {} does not match {}.",
                result["kind"].as_str().unwrap_or(""),
                s.assessment_kind
            ));
        }
        let capability = cap(&s.action["capability"]).ok_or("Invalid retention capability.")?;
        let retention = s.phase == "retaining"
            && s.action["kind"] == "retention_review"
            && capability != Capability::BoundaryDiscrimination;
        let retest = s.phase == "relearning" && s.action["kind"] == "relearning_gate";
        let c = &self.candidates[s.candidate];
        let key = c.outcome_key.clone();
        let id = c.retention_target_id.clone();
        let mut effective = if retention {
            self.receipts.get(&key).unwrap_or(result).clone()
        } else {
            result.clone()
        };
        let correct = effective["correct"]
            .as_bool()
            .ok_or("Invalid review correctness.")?;
        let outcome = if retention {
            review_outcome(capability, correct)
        } else {
            None
        };
        let failed = retention && !correct;
        let cycle = if failed { Some(self.cycle(&s)) } else { None };
        let before = s.clone();
        effective["focusDimension"] = json!(classification(capability).1);
        effective["memoryOutcome"] = json!(outcome);
        effective["evidenceEligible"] = json!(retention);
        self.capture();
        s.settled = true;
        s.result = Some(effective.clone());
        s.step_kind = "review_feedback".into();
        self.step_finished(&s)?;
        self.frame.attempts = self
            .frame
            .attempts
            .checked_add(1)
            .ok_or("Retention counter overflow.")?;
        if correct {
            self.frame.correct = self
                .frame
                .correct
                .checked_add(1)
                .ok_or("Retention counter overflow.")?;
        }
        let mut effects = vec![];
        if retention {
            if failed {
                s.phase = "relearning".into();
                s.cycle = cycle.clone();
                self.enqueue(&s);
            } else {
                self.frame.completed += 1;
            }
            if !self.receipts.contains_key(&key) {
                self.receipts.insert(key.clone(), effective.clone());
                effects.push(json!({"type":"retention_outcome","outcomeKey":key,"candidateIndex":before.candidate,"candidatePhase":before.phase,"candidateCycle":before.cycle,"action":s.action,"result":effective,"relearningCycle":cycle}));
            }
            let t = self.target(&id)?;
            t["status"] = json!(if failed {
                "relearning_repair"
            } else {
                "retaining"
            });
            t["currentCapability"] = json!(capability);
            t["memoryOutcome"] = json!(outcome);
            t["reviewSettled"] = json!(true);
        } else if retest && let Some(mut cycle) = before.cycle.clone() {
            if correct {
                s.phase = "retaining".into();
                s.cycle = None;
                self.frame.completed += 1;
                effects.push(self.effect(&before, "retest_passed", &cycle));
            } else {
                cycle["stage"] = json!("repair_pending");
                s.phase = "relearning".into();
                s.cycle = Some(cycle.clone());
                self.enqueue(&s);
                effects.push(self.effect(&before, "retest_failed", &cycle));
            }
            let t = self.target(&id)?;
            t["status"] = json!(if correct {
                "retaining"
            } else {
                "relearning_repair"
            });
            t["currentCapability"] = json!(capability);
            t["relearningCompleted"] = json!(correct);
        }
        self.frame.current = Some(s);
        Ok(effects)
    }
    fn repair(&mut self) -> Result<Vec<Value>> {
        let Some(mut s) = self
            .frame
            .current
            .clone()
            .filter(|s| !s.settled && intent(&s.action) == "repair")
        else {
            return Ok(vec![]);
        };
        let Some(mut cycle) = s.cycle.clone() else {
            return Ok(vec![]);
        };
        let count = cycle["repairCount"]
            .as_u64()
            .ok_or("Invalid repair count.")?
            .checked_add(1)
            .ok_or("Repair count overflow.")?;
        self.capture();
        cycle["stage"] = json!("retest_pending");
        cycle["repairCount"] = json!(count);
        cycle["lastActionOrdinal"] = s.action["ordinal"].clone();
        s.phase = "relearning".into();
        s.cycle = Some(cycle.clone());
        s.settled = true;
        s.result = None;
        self.step_finished(&s)?;
        self.enqueue(&s);
        let effect = self.effect(&s, "repair_completed", &cycle);
        let id = self.candidates[s.candidate].retention_target_id.clone();
        let t = self.target(&id)?;
        t["status"] = json!("relearning_retest");
        t["currentCapability"] = json!(cycle_cap(&s.cycle));
        self.frame.current = Some(s);
        Ok(vec![effect])
    }
    fn inner(&mut self, e: &Event) -> Result<Vec<Value>> {
        match e {
            Event::Next => self.next()?,
            Event::Settle { result } => return self.settle(result),
            Event::Repair => return self.repair(),
            Event::Undo => {
                if let Some(frame) = self.undo.pop() {
                    self.frame = frame;
                }
            }
            Event::Exclude => {
                if let Some(s) = self.frame.current.clone() {
                    self.capture();
                    let id = self.candidates[s.candidate].retention_target_id.clone();
                    let t = self.target(&id)?;
                    t["status"] = json!("declared_mastery");
                    t["currentCapability"] = Value::Null;
                    self.frame.current = None;
                }
            }
        };
        Ok(vec![])
    }
    /// Returns effect proposals atomically with in-memory state. A durable adapter
    /// must commit both in one transaction; this API alone is not durable delivery.
    pub fn execute(&mut self, event: Event) -> Result<Vec<Value>> {
        let mut q = self.clone();
        let effects = q.inner(&event)?;
        q.events.push(event);
        *self = q;
        Ok(effects)
    }
    pub fn view(&self) -> Value {
        let session=self.frame.current.as_ref().map(|s|json!({"index":s.action["ordinal"],"totalTarget":self.progress_target,"candidateIndex":s.candidate,"candidatePhase":s.phase,"candidateCycle":s.cycle,"action":s.action,"assessmentKind":s.assessment_kind,"stepKind":s.step_kind,"settled":s.settled,"result":s.result}));
        let action=self.frame.current.as_ref().map(|s|{let a=&s.action;json!({"packageId":a["packageId"],"senseId":a["senseId"],"retentionTargetId":a["retentionTargetId"],"capability":a["capability"],"intent":a["intent"],"reason":a["reason"]})});
        json!({"session":session,"projection":{"currentAction":action,"targets":self.frame.targets},"done":self.frame.pending.is_empty()&&self.frame.current.is_none(),"stats":{"totalTargets":self.total,"completedTargets":self.frame.completed,"totalAttempts":self.frame.attempts,"correctAttempts":self.frame.correct,"accuracy":if self.frame.attempts==0{100.0}else{(f64::from(self.frame.correct)/f64::from(self.frame.attempts)*100.0).round()},"startTime":self.start_time}})
    }
    pub fn restore(raw: &str) -> Result<Self> {
        let saved: Self = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        if saved.version != 1 {
            return Err("Unsupported retention queue version.".into());
        }
        let mut q = Self::new(
            saved.candidates.clone(),
            saved.order.clone(),
            saved.min_gap,
            Some(saved.progress_target),
            saved.start_time,
        )?;
        for e in &saved.events {
            q.execute(e.clone())?;
        }
        if serde_json::to_value(&q).map_err(|e| e.to_string())?
            != serde_json::to_value(&saved).map_err(|e| e.to_string())?
        {
            return Err("Retention snapshot history mismatch.".into());
        }
        Ok(q)
    }
}
