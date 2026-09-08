//! Durable protocol-local transitions. Only trusted Rust evaluators supply
//! Observations; no UI command accepts Decisions, credit or scheduling effects.
//! The caller owns the enclosing transaction and must propagate any error.
use super::{Error, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sensa_core::progression::{
    self as core, Decision, Definition, Observation, ProgressionPolicy, State,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pin {
    pub definition: Definition,
    pub progression_policy_id: String,
    pub evaluation_contract_id: String,
    pub plan_id: String,
    pub material_digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct View {
    pub pin: Pin,
    pub revision: u32,
    pub state: State,
}
fn invalid(_: String) -> Error {
    Error::Rule("invalid_protocol_progress")
}

/// Reconstruct from immutable decisions, then check the cached state. Restore
/// never asks today's evaluator to reinterpret historical observations.
pub fn load(db: &Connection, run: &str) -> Result<View> {
    let (format, pin, revision, encoded): (u32, String, u32, String) = db.query_row(
        "SELECT format_version,pin,revision,state FROM protocol_journals WHERE run_id=?1",
        [run],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    if format != 1 {
        return Err(Error::Rule("unsupported_progress_version"));
    }
    let pin: Pin = serde_json::from_str(&pin)?;
    let mut state = core::create_state(run, &pin.definition).map_err(invalid)?;
    let mut query = db.prepare("SELECT ordinal,observation_id,observation,decision FROM protocol_transitions WHERE run_id=?1 ORDER BY ordinal")?;
    let events = query.query_map([run], |r| {
        Ok((
            r.get::<_, u32>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut count = 0;
    for row in events {
        let (ordinal, id, observation, decision) = row?;
        count += 1;
        let observation: Observation = serde_json::from_str(&observation)?;
        let decision: Decision = serde_json::from_str(&decision)?;
        if ordinal != count
            || observation.observation_id != id
            || decision.observation_id != id
            || decision.progression_policy_id != pin.progression_policy_id
        {
            return Err(Error::Rule("progress_history_mismatch"));
        }
        let result = core::apply_decision(&pin.definition, &state, &decision).map_err(invalid)?;
        if !result.applied {
            return Err(Error::Rule("progress_history_mismatch"));
        }
        state = result.state;
    }
    if count != revision || state != serde_json::from_str::<State>(&encoded)? {
        return Err(Error::Rule("progress_history_mismatch"));
    }
    Ok(View {
        pin,
        revision,
        state,
    })
}

/// Transaction-bound storage seam for registered native Runtime adapters.
/// Caller-supplied effects are deliberately absent from this interface.
pub struct Journal<'a> {
    tx: &'a Transaction<'a>,
}
impl<'a> Journal<'a> {
    pub fn new(tx: &'a Transaction<'a>) -> Self {
        Self { tx }
    }
    pub fn create(&self, run: &str, pin: &Pin) -> Result<View> {
        if [
            &pin.progression_policy_id,
            &pin.evaluation_contract_id,
            &pin.plan_id,
            &pin.material_digest,
        ]
        .iter()
        .any(|v| v.trim().is_empty())
        {
            return Err(Error::Rule("invalid_progress_pin"));
        }
        let exists: bool = self.tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM protocol_journals WHERE run_id=?1)",
            [run],
            |r| r.get(0),
        )?;
        if exists {
            let old = load(self.tx, run)?;
            if old.pin != *pin {
                return Err(Error::Rule("progress_pin_conflict"));
            }
            return Ok(old);
        }
        let state = core::create_state(run, &pin.definition).map_err(invalid)?;
        self.tx.execute(
            "INSERT INTO protocol_journals VALUES(?1,1,?2,0,?3)",
            params![
                run,
                serde_json::to_string(pin)?,
                serde_json::to_string(&state)?
            ],
        )?;
        Ok(View {
            pin: pin.clone(),
            revision: 0,
            state,
        })
    }
    pub fn record(
        &self,
        run: &str,
        expected_revision: u32,
        policy: &dyn ProgressionPolicy,
        observation: &Observation,
        now: i64,
        provenance: &str,
    ) -> Result<View> {
        let before = load(self.tx, run)?;
        if policy.id() != before.pin.progression_policy_id {
            return Err(Error::Rule("progress_policy_mismatch"));
        }
        let existing: Option<(String,String,i64,String)> = self.tx.query_row(
            "SELECT run_id,observation,occurred_at_ms,provenance FROM protocol_transitions WHERE observation_id=?1",
            [&observation.observation_id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        if let Some((owner, encoded, time, origin)) = existing {
            if owner != run
                || serde_json::from_str::<Observation>(&encoded)? != *observation
                || time != now
                || origin != provenance
            {
                return Err(Error::Rule("observation_identity_conflict"));
            }
            // Replay precedes revision and completed-state checks, including after restart.
            return Ok(before);
        }
        if before.revision != expected_revision {
            return Err(Error::Rule("stale_progress"));
        }
        let decision_id = format!("{}:transition", observation.observation_id);
        let result = core::decide_and_apply(
            &before.pin.definition,
            policy,
            &before.state,
            observation,
            &decision_id,
        )
        .map_err(invalid)?;
        let revision = before
            .revision
            .checked_add(1)
            .ok_or(Error::Rule("progress_revision_overflow"))?;
        self.tx.execute(
            "INSERT INTO protocol_transitions VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                observation.observation_id,
                run,
                revision,
                serde_json::to_string(observation)?,
                serde_json::to_string(&result.decision)?,
                now,
                provenance
            ],
        )?;
        if self.tx.execute(
            "UPDATE protocol_journals SET revision=?2,state=?3 WHERE run_id=?1 AND revision=?4",
            params![
                run,
                revision,
                serde_json::to_string(&result.state)?,
                expected_revision
            ],
        )? != 1
        {
            return Err(Error::Rule("stale_progress"));
        }
        Ok(View {
            pin: before.pin,
            revision,
            state: result.state,
        })
    }
}
