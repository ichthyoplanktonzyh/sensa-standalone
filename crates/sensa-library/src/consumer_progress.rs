//! Consumer evaluation adapter; raw learner actions remain the only UI input.
use super::*;
use rusqlite::Transaction;
use sensa_core::progression::{CompletionPolicy, Definition, Observation, ObservationKind};

pub(super) fn start(tx: &Transaction<'_>, run: &str, retention: bool) -> Result<()> {
    let sql = if retention {
        "SELECT r.protocol_version,r.material_digest,p.plan_id FROM retention_runs r JOIN retention_run_policies p ON p.run_id=r.id WHERE r.id=?1"
    } else {
        "SELECT r.protocol_version,r.material_digest,p.plan_id FROM runs r JOIN initial_run_policies p ON p.run_id=r.id WHERE r.id=?1"
    };
    let (protocol, digest, plan): (String, String, String) =
        tx.query_row(sql, [run], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    policy::validate_run(tx, run, &protocol, retention)?;
    let pin = progress::Pin {
        definition: Definition {
            protocol_id: protocol.clone(),
            protocol_version: protocol,
            checkpoints: vec![],
            completion_policy: CompletionPolicy::ProtocolCompletion,
        },
        progression_policy_id: "completion-only-v1".into(),
        evaluation_contract_id: "native-consumer-observation-v1".into(),
        plan_id: plan,
        material_digest: digest,
    };
    progress::Journal::new(tx).create(run, &pin)?;
    tx.execute(
        "INSERT INTO consumer_progress_links VALUES(?1,?2,?3) ON CONFLICT(run_id) DO NOTHING",
        params![run, (!retention).then_some(run), retention.then_some(run)],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn record(
    tx: &Transaction<'_>,
    run: &str,
    attempt: &str,
    ordinal: u32,
    next: Phase,
    now: i64,
    legacy: bool,
) -> Result<()> {
    let before = progress::load(tx, run)?;
    if before.pin.evaluation_contract_id != "native-consumer-observation-v1" {
        return Err(Error::Rule("unsupported_progress_evaluator"));
    }
    let observation = Observation {
        observation_id: format!("{attempt}:observation"),
        attempt_id: attempt.into(),
        action_id: format!("{run}:step:{ordinal}"),
        kind: if next == Phase::Completed {
            ObservationKind::ProtocolCompleted
        } else {
            ObservationKind::PracticeCompleted
        },
        checkpoint_id: None,
        evidence_ids: vec![],
    };
    let registry =
        composition::native_registry().map_err(|_| Error::Rule("invalid_runtime_composition"))?;
    let policy = registry
        .progression(&before.pin.progression_policy_id)
        .map_err(|_| Error::Rule("progress_policy_mismatch"))?;
    let after = progress::Journal::new(tx).record(
        run,
        before.revision,
        policy,
        &observation,
        now,
        if legacy {
            "legacy_attempt_v4"
        } else {
            "native_evaluation_v1"
        },
    )?;
    if after.state.completed != (next == Phase::Completed) {
        return Err(Error::Rule("progress_completion_mismatch"));
    }
    Ok(())
}

/// Reconstruct derived journal facts from existing versioned consumer attempts.
/// Original attempts, completions, memory and operation receipts are untouched.
pub(super) fn migrate(tx: &Transaction<'_>) -> Result<()> {
    for (runs, attempts, retention) in [
        ("runs", "attempts", false),
        ("retention_runs", "retention_attempts", true),
    ] {
        let mut q = tx.prepare(&format!(
            "SELECT id,phase,attempt_count FROM {runs} ORDER BY rowid"
        ))?;
        let rows = q
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, u32>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(q);
        for (run, phase, count) in rows {
            start(tx, &run, retention)?;
            let mut q = tx.prepare(&format!("SELECT id,ordinal,action,next_phase,occurred_at_ms FROM {attempts} WHERE run_id=?1 ORDER BY ordinal"))?;
            let rows = q
                .query_map([&run], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, u32>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(q);
            let protocol = progress::load(tx, &run)?.pin.definition.protocol_version;
            let mut previous = Phase::Recall;
            for (attempt, ordinal, action, next, time) in rows {
                // Waiting resumes via a separate command; the next attempt starts in Recall.
                if previous == Phase::Waiting {
                    previous = Phase::Recall;
                }
                let action: Action = serde_json::from_str(&action)?;
                let next: Phase = serde_json::from_value(serde_json::Value::String(next))?;
                if transition(&protocol, previous, action).map_err(Error::Rule)? != next {
                    return Err(Error::Rule("progress_history_mismatch"));
                }
                record(tx, &run, &attempt, ordinal, next, time, true)?;
                previous = next;
            }
            let view = progress::load(tx, &run)?;
            if view.revision != count || view.state.completed != (phase == "completed") {
                return Err(Error::Rule("progress_history_mismatch"));
            }
        }
    }
    Ok(())
}
