//! Versioned four-stage orchestration migrated from Sensa's Web queue.
//! This module consumes evaluated results, not UI answers or material generation.
//! It returns protocol-local progress; only an application adapter may commit
//! real Evidence, Completion or scheduling facts.
use crate::progression::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const CHECKPOINTS: [&str; 4] = [
    "four-stage:meaning-choice",
    "four-stage:context-recall",
    "four-stage:sound-choice",
    "four-stage:final-recall",
];
pub const PRESENTATIONS: [&str; 4] = [
    "meaning_choice",
    "context_recall",
    "sound_choice",
    "final_recall",
];
pub fn definition() -> Definition {
    Definition {
        protocol_id: "interleaved-four-stage-acquisition".into(),
        protocol_version: "v1".into(),
        checkpoints: CHECKPOINTS
            .iter()
            .map(|id| CheckpointDefinition {
                checkpoint_id: (*id).into(),
                capability_objective_ids: vec!["sense-expression-connection".into()],
                required_for_completion: true,
            })
            .collect(),
        completion_policy: CompletionPolicy::AllRequiredCheckpoints {
            require_same_progress_epoch: true,
        },
    }
}
fn component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub target_id: String,
    pub progress: State,
    pub last_session_ordinal: i64,
    pub attempts: u32,
    pub mistakes: u32,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Assessment,
    Feedback,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    pub session_ordinal: u32,
    pub target_id: String,
    pub checkpoint_id: String,
    pub presentation: String,
    pub phase: Phase,
    pub result: Option<bool>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Projection {
    pub target_count: usize,
    pub graduated_target_ids: Vec<String>,
    pub targets: Vec<Target>,
    pub current_session: Option<Session>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Event {
    Settle { satisfied: bool },
    Feedback,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Queue {
    format_version: u32,
    events: Vec<Event>,
    run_id: String,
    target_ids: Vec<String>,
    min_gap: u32,
    targets: Vec<Target>,
    current_session: Option<Session>,
    session_ordinal: u32,
}
impl Queue {
    pub fn new(ids: Vec<String>, run: String, min_gap: u32) -> Result<Self> {
        if ids.iter().collect::<BTreeSet<_>>().len() != ids.len() {
            return Err("Interleaved four-stage run contains duplicate Target identities.".into());
        }
        for id in &ids {
            require_identity(id, "Learning Target identity")?;
        }
        require_identity(&run, "Protocol Run identity")?;
        let targets = ids
            .iter()
            .map(|id| {
                Ok(Target {
                    target_id: id.clone(),
                    progress: create_state(&format!("{run}:{}", component(id)), &definition())?,
                    last_session_ordinal: -1,
                    attempts: 0,
                    mistakes: 0,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let mut queue = Self {
            format_version: 1,
            events: vec![],
            run_id: run,
            target_ids: ids,
            min_gap,
            targets,
            current_session: None,
            session_ordinal: 0,
        };
        queue.next_session()?;
        Ok(queue)
    }
    pub fn is_done(&self) -> bool {
        self.targets.iter().all(|t| t.progress.completed)
    }
    pub fn projection(&self) -> Projection {
        Projection {
            target_count: self.targets.len(),
            graduated_target_ids: self
                .targets
                .iter()
                .filter(|t| t.progress.completed)
                .map(|t| t.target_id.clone())
                .collect(),
            targets: self.targets.clone(),
            current_session: self.current_session.clone(),
        }
    }
    fn checkpoint(target: &Target) -> Result<usize> {
        CHECKPOINTS
            .iter()
            .position(|id| {
                target.progress.checkpoint_credits.get(*id).is_none_or(|c| {
                    c.status != CreditStatus::Credited
                        || c.credited_in_epoch != Some(target.progress.progress_epoch)
                })
            })
            .ok_or_else(|| "Invalid four-stage progress.".into())
    }
    pub fn next_session(&mut self) -> Result<Option<Session>> {
        if let Some(s) = &self.current_session {
            if s.phase == Phase::Assessment {
                return Ok(Some(s.clone()));
            }
            return Err("Feedback must be completed before the next Encounter.".into());
        }
        if self.is_done() {
            return Ok(None);
        }
        let next = self
            .session_ordinal
            .checked_add(1)
            .ok_or("Four-stage ordinal overflow.")?;
        let pending = self
            .targets
            .iter()
            .enumerate()
            .filter(|(_, t)| !t.progress.completed)
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        let mut candidates = pending
            .iter()
            .copied()
            .filter(|i| {
                self.targets[*i].last_session_ordinal < 0
                    || i64::from(next) - self.targets[*i].last_session_ordinal
                        > i64::from(self.min_gap)
            })
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            candidates = pending;
        }
        let mut ranked = candidates
            .into_iter()
            .map(|i| {
                Ok((
                    Self::checkpoint(&self.targets[i])?,
                    self.targets[i].last_session_ordinal,
                    i,
                ))
            })
            .collect::<Result<Vec<_>>>()?;
        ranked.sort();
        let (checkpoint, _, i) = ranked[0];
        self.session_ordinal = next;
        self.current_session = Some(Session {
            session_ordinal: next,
            target_id: self.targets[i].target_id.clone(),
            checkpoint_id: CHECKPOINTS[checkpoint].into(),
            presentation: PRESENTATIONS[checkpoint].into(),
            phase: Phase::Assessment,
            result: None,
        });
        Ok(self.current_session.clone())
    }
    pub fn settle(&mut self, satisfied: bool) -> Result<Option<Session>> {
        let Some(mut session) = self
            .current_session
            .clone()
            .filter(|s| s.phase == Phase::Assessment)
        else {
            return Ok(self.current_session.clone());
        };
        let i = self
            .targets
            .iter()
            .position(|t| t.target_id == session.target_id)
            .ok_or("Invalid four-stage target.")?;
        let target = &self.targets[i];
        let identity = format!(
            "{}:{}:{}",
            target.progress.protocol_run_id, session.session_ordinal, session.checkpoint_id
        );
        let observation = Observation {
            observation_id: format!("{identity}:assessment"),
            attempt_id: format!("{identity}:attempt"),
            action_id: format!("{identity}:action"),
            kind: if satisfied {
                ObservationKind::CheckpointSatisfied
            } else {
                ObservationKind::CheckpointNotSatisfied
            },
            checkpoint_id: Some(session.checkpoint_id.clone()),
            evidence_ids: if satisfied {
                vec![format!("{identity}:evidence")]
            } else {
                vec![]
            },
        };
        let result = decide_and_apply(
            &definition(),
            &CheckpointPolicy::new("run-reset-v1", FailureReset::Run)?,
            &target.progress,
            &observation,
            &format!("{identity}:transition"),
        )?;
        let attempts = target
            .attempts
            .checked_add(1)
            .ok_or("Four-stage attempt overflow.")?;
        let mistakes = target
            .mistakes
            .checked_add(u32::from(!satisfied))
            .ok_or("Four-stage mistake overflow.")?;
        let target = &mut self.targets[i];
        target.progress = result.state;
        target.last_session_ordinal = i64::from(session.session_ordinal);
        target.attempts = attempts;
        target.mistakes = mistakes;
        session.phase = Phase::Feedback;
        session.result = Some(satisfied);
        self.current_session = Some(session);
        self.events.push(Event::Settle { satisfied });
        Ok(self.current_session.clone())
    }
    pub fn complete_feedback(&mut self) -> Result<Option<Session>> {
        let Some(session) = self
            .current_session
            .clone()
            .filter(|s| s.phase == Phase::Feedback)
        else {
            return Ok(self.current_session.clone());
        };
        // Clone first: a failure while selecting the next session must not commit repair alone.
        let mut next = self.clone();
        if session.result == Some(false) {
            let target = next
                .targets
                .iter_mut()
                .find(|t| t.target_id == session.target_id)
                .ok_or("Invalid four-stage target.")?;
            let identity = format!(
                "{}:{}:{}",
                target.progress.protocol_run_id, session.session_ordinal, session.checkpoint_id
            );
            let observation = Observation {
                observation_id: format!("{identity}:repair"),
                attempt_id: format!("{identity}:repair-attempt"),
                action_id: format!("{identity}:feedback-action"),
                kind: ObservationKind::RepairCompleted,
                checkpoint_id: Some(session.checkpoint_id),
                evidence_ids: vec![],
            };
            target.progress = decide_and_apply(
                &definition(),
                &CheckpointPolicy::new("run-reset-v1", FailureReset::Run)?,
                &target.progress,
                &observation,
                &format!("{identity}:repair-transition"),
            )?
            .state;
        }
        next.current_session = None;
        let result = next.next_session()?;
        next.events.push(Event::Feedback);
        *self = next;
        Ok(result)
    }
    /// Validate persisted execution state against its evaluated-result trace.
    /// Replay uses this pinned v1 orchestration; it does not re-grade responses.
    pub fn restore(encoded: &str) -> Result<Self> {
        let saved: Self = serde_json::from_str(encoded).map_err(|e| e.to_string())?;
        if saved.format_version != 1 {
            return Err("Unsupported four-stage snapshot version.".into());
        }
        let mut restored = Self::new(
            saved.target_ids.clone(),
            saved.run_id.clone(),
            saved.min_gap,
        )?;
        for event in &saved.events {
            match event {
                Event::Settle { satisfied } => {
                    restored.settle(*satisfied)?;
                }
                Event::Feedback => {
                    restored.complete_feedback()?;
                }
            }
        }
        if restored != saved {
            return Err("Four-stage snapshot history mismatch.".into());
        }
        Ok(restored)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewMode {
    Review,
    Relearning,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Answer {
    Known,
    Vague,
    Forgotten,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outcome {
    pub basis: String,
    pub grade: String,
    pub evidence_level: String,
    pub evidence_ids: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub target_id: String,
    pub mode: ReviewMode,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewSession {
    pub ordinal: u32,
    pub target_id: String,
    pub mode: ReviewMode,
    pub phase: Phase,
    pub answer: Option<Answer>,
    pub memory_outcome: Option<Outcome>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ReviewEvent {
    Settle { answer: Answer },
    Feedback,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewQueue {
    format_version: u32,
    candidates: Vec<Candidate>,
    events: Vec<ReviewEvent>,
    pending: VecDeque<Candidate>,
    current: Option<ReviewSession>,
    ordinal: u32,
    outcomes: BTreeMap<String, Outcome>,
    completed: BTreeSet<String>,
}
impl ReviewQueue {
    pub fn new(candidates: Vec<Candidate>) -> Result<Self> {
        if candidates
            .iter()
            .map(|c| &c.target_id)
            .collect::<BTreeSet<_>>()
            .len()
            != candidates.len()
        {
            return Err("Interleaved review contains duplicate Target identities.".into());
        }
        let mut q = Self {
            format_version: 1,
            candidates: candidates.clone(),
            events: vec![],
            pending: candidates.into(),
            current: None,
            ordinal: 0,
            outcomes: BTreeMap::new(),
            completed: BTreeSet::new(),
        };
        q.next_session()?;
        Ok(q)
    }
    pub fn current(&self) -> Option<ReviewSession> {
        self.current.clone()
    }
    pub fn outcomes(&self) -> &BTreeMap<String, Outcome> {
        &self.outcomes
    }
    pub fn is_done(&self) -> bool {
        self.pending.is_empty() && self.current.is_none()
    }
    pub fn next_session(&mut self) -> Result<Option<ReviewSession>> {
        if let Some(s) = &self.current {
            if s.phase == Phase::Assessment {
                return Ok(Some(s.clone()));
            }
            return Err("Review feedback must complete before advancing.".into());
        }
        let Some(candidate) = self.pending.front() else {
            return Ok(None);
        };
        let ordinal = self
            .ordinal
            .checked_add(1)
            .ok_or("Review ordinal overflow.")?;
        self.current = Some(ReviewSession {
            ordinal,
            target_id: candidate.target_id.clone(),
            mode: candidate.mode.clone(),
            phase: Phase::Assessment,
            answer: None,
            memory_outcome: None,
        });
        self.pending.pop_front();
        self.ordinal = ordinal;
        Ok(self.current())
    }
    pub fn settle(&mut self, answer: Answer) -> Result<Option<ReviewSession>> {
        let Some(mut s) = self
            .current
            .clone()
            .filter(|s| s.phase == Phase::Assessment)
        else {
            return Ok(self.current());
        };
        if s.mode == ReviewMode::Review {
            if self.outcomes.contains_key(&s.target_id) {
                return Err(format!(
                    "Due Review for {} already produced a Memory Outcome.",
                    s.target_id
                ));
            }
            let outcome = Outcome {
                basis: "learner_rated".into(),
                grade: match answer {
                    Answer::Known => "good",
                    Answer::Vague => "hard",
                    Answer::Forgotten => "again",
                }
                .into(),
                evidence_level: "self_report".into(),
                evidence_ids: vec![],
            };
            self.outcomes.insert(s.target_id.clone(), outcome.clone());
            s.memory_outcome = Some(outcome);
        }
        if answer == Answer::Forgotten {
            self.pending.push_back(Candidate {
                target_id: s.target_id.clone(),
                mode: ReviewMode::Relearning,
            });
        } else {
            self.completed.insert(s.target_id.clone());
        }
        s.phase = Phase::Feedback;
        s.answer = Some(answer.clone());
        self.current = Some(s);
        self.events.push(ReviewEvent::Settle { answer });
        Ok(self.current())
    }
    pub fn complete_feedback(&mut self) -> Result<Option<ReviewSession>> {
        if self
            .current
            .as_ref()
            .is_none_or(|s| s.phase != Phase::Feedback)
        {
            return Ok(self.current());
        }
        let mut next = self.clone();
        next.current = None;
        let session = next.next_session()?;
        next.events.push(ReviewEvent::Feedback);
        *self = next;
        Ok(session)
    }
    pub fn restore(encoded: &str) -> Result<Self> {
        let saved: Self = serde_json::from_str(encoded).map_err(|e| e.to_string())?;
        if saved.format_version != 1 {
            return Err("Unsupported four-stage review snapshot version.".into());
        }
        let mut restored = Self::new(saved.candidates.clone())?;
        for event in &saved.events {
            match event {
                ReviewEvent::Settle { answer } => {
                    restored.settle(answer.clone())?;
                }
                ReviewEvent::Feedback => {
                    restored.complete_feedback()?;
                }
            }
        }
        if saved != restored {
            return Err("Four-stage review snapshot history mismatch.".into());
        }
        Ok(restored)
    }
}
