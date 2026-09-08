//! Retention application adapter. Commands share the library transaction/CAS ledger.
//! Initial material is explicitly reused in a purpose-pinned immutable run snapshot.
use super::*;
use sensa_core::protocol::{RELEARNING_PROTOCOL, REVIEW_PROTOCOL, consumer_purpose};
use sensa_core::scheduling::{ReviewSchedule, ScheduleState};
use sensa_core::settlement::{DueTrigger, ReviewMemory};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionView {
    pub next_eligible_at_ms: Option<i64>,
    pub review_count: u32,
    pub relearning_count: u32,
    pub pending_count: u32,
}

pub(super) fn project(db: &Connection, state: &mut Snapshot) -> Result<()> {
    state.retention = RetentionView {
        next_eligible_at_ms: db.query_row("SELECT n.next_eligible_at_ms FROM relearning_needs n JOIN targets t ON t.id=n.target_id WHERE t.material_id=(SELECT selected_material_id FROM library) AND n.resolved_at_ms IS NULL",[],|r|r.get(0)).optional()?,
        review_count: db.query_row("SELECT count(*) FROM memory_outcomes",[],|r|r.get(0))?,
        relearning_count: db.query_row("SELECT count(*) FROM retention_completions WHERE kind='relearning_completion'",[],|r|r.get(0))?,
        pending_count: db.query_row("SELECT count(*) FROM relearning_needs WHERE resolved_at_ms IS NULL",[],|r|r.get(0))?,
    };
    let row: Option<(String,String,u32,u32,bool,String,String)> = db.query_row("SELECT id,phase,ordinal,attempt_count,paused,protocol_version,content FROM retention_runs WHERE material_id=(SELECT selected_material_id FROM library) ORDER BY rowid DESC LIMIT 1", [], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?;
    if let Some((id, phase, ordinal, attempt_count, paused, protocol, content)) = row {
        state.run = Some(RunView {
            id,
            phase: serde_json::from_value(serde_json::Value::String(phase))?,
            ordinal,
            attempt_count,
            paused,
            protocol_version: protocol,
        });
        state.material = Some(serde_json::from_str(&content)?);
    }
    Ok(())
}
fn at(ms: i64) -> Result<DateTime<Utc>> {
    DateTime::from_timestamp_millis(ms).ok_or(Error::Rule("clock_out_of_range"))
}

pub(super) fn start(
    db: &Connection,
    state: &Snapshot,
    now: DateTime<Utc>,
    early: bool,
) -> Result<()> {
    if !state.enrolled || state.completion_id.is_none() {
        return Err(Error::Rule("no_due_review"));
    }
    let target: String = db.query_row(
        "SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library)",
        [],
        |r| r.get(0),
    )?;
    let need: Option<(String,Option<String>,i64)> = db.query_row("SELECT id,run_id,next_eligible_at_ms FROM relearning_needs WHERE target_id=?1 AND resolved_at_ms IS NULL",[&target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    if let Some(run) = &state.run
        && run.phase != Phase::Completed
    {
        if run.protocol_version == PROTOCOL {
            return Err(Error::Rule("no_due_review"));
        }
        if run.phase == Phase::Waiting {
            let (_, _, eligible) = need.as_ref().ok_or(Error::Rule("need_unavailable"))?;
            if now.timestamp_millis() < *eligible && !early {
                return Err(Error::Rule("relearning_waiting"));
            }
            db.execute(
                "UPDATE retention_runs SET phase='recall',paused=0 WHERE id=?1",
                [&run.id],
            )?;
        } else {
            db.execute("UPDATE retention_runs SET paused=0 WHERE id=?1", [&run.id])?;
        }
        return Ok(());
    }
    let (protocol, revision, due) = if let Some((_, _, eligible)) = &need {
        if now.timestamp_millis() < *eligible && !early {
            return Err(Error::Rule("relearning_waiting"));
        }
        (RELEARNING_PROTOCOL, None, None)
    } else {
        let (revision, due): (u32, i64) = db.query_row(
            "SELECT revision,due_at_ms FROM memory WHERE target_id=?1",
            [&target],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if now.timestamp_millis() < due {
            return Err(Error::Rule("no_due_review"));
        }
        (REVIEW_PROTOCOL, Some(revision), Some(due))
    };
    let (material,digest,content): (String,String,String) = db.query_row("SELECT m.id,m.digest,m.content FROM materials m JOIN targets t ON t.material_id=m.id WHERE t.id=?1",[&target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    if format!("{:x}", Sha256::digest(content.as_bytes())) != digest {
        return Err(Error::Rule("material_mismatch"));
    }
    let run = id();
    db.execute(
        "INSERT INTO retention_runs VALUES(?1,?2,?3,?4,?5,?6,'recall',1,0,0,?7,?8,?9)",
        params![
            run,
            target,
            material,
            digest,
            content,
            protocol,
            now.timestamp_millis(),
            revision,
            due
        ],
    )?;
    if let Some((need, _, _)) = need {
        db.execute(
            "UPDATE relearning_needs SET run_id=?2 WHERE id=?1",
            params![need, run],
        )?;
    }
    Ok(())
}

pub(super) fn record(
    db: &Connection,
    run: &RunView,
    command: &Command,
    action: Action,
    now: DateTime<Utc>,
) -> Result<()> {
    let (target,protocol,content,digest,revision,due): (String,String,String,String,Option<u32>,Option<i64>) = db.query_row("SELECT target_id,protocol_version,content,material_digest,trigger_revision,trigger_due_at_ms FROM retention_runs WHERE id=?1",[&run.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?;
    consumer_purpose(&protocol).map_err(Error::Rule)?;
    if format!("{:x}", Sha256::digest(content.as_bytes())) != digest {
        return Err(Error::Rule("material_mismatch"));
    }
    let next = transition(&protocol, run.phase, action).map_err(Error::Rule)?;
    let phase = serde_json::to_value(next)?
        .as_str()
        .ok_or(Error::Rule("invalid_phase"))?
        .to_owned();
    db.execute(
        "INSERT INTO retention_attempts VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            id(),
            command.operation_id,
            run.id,
            run.ordinal,
            serde_json::to_string(&action)?,
            phase,
            now.timestamp_millis()
        ],
    )?;
    db.execute("UPDATE retention_runs SET phase=?2,ordinal=ordinal+?3,attempt_count=attempt_count+1 WHERE id=?1",params![run.id,phase,if next==Phase::Completed {0} else {1}])?;
    if action == Action::Reveal {
        return Ok(());
    }
    let context = if protocol == REVIEW_PROTOCOL {
        let (rev, due_at, schedule): (u32, i64, String) = db.query_row(
            "SELECT revision,due_at_ms,schedule FROM memory WHERE target_id=?1",
            [&target],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let schedule: ReviewSchedule = serde_json::from_str(&schedule)?;
        SettlementContext::RetentionReview {
            memory: ReviewMemory {
                revision: rev.to_string(),
                due_at: at(due_at)?,
                schedule: ScheduleState::with_schedule(target.clone(), &schedule),
            },
            trigger: DueTrigger {
                memory_revision: revision.ok_or(Error::Rule("stale_due"))?.to_string(),
                due_at: at(due.ok_or(Error::Rule("stale_due"))?)?,
            },
        }
    } else if protocol == RELEARNING_PROTOCOL {
        SettlementContext::Relearning
    } else {
        return Err(Error::Rule("unsupported_protocol"));
    };
    let decision = decide_consumer_settlement(&target, &protocol, action, now, &context)
        .map_err(Error::Rule)?;
    match decision {
        Settlement::WaitRelearning {next_eligible_at} => {
            if db.execute("UPDATE relearning_needs SET next_eligible_at_ms=?2 WHERE run_id=?1 AND resolved_at_ms IS NULL",params![run.id,next_eligible_at.timestamp_millis()])?!=1 {return Err(Error::Rule("need_unavailable"));}
        }
        Settlement::ReviewCompleted {evidence_level,outcome_basis,rating,schedule,next_eligible_at} => {
            let completion=id(); let outcome=id(); let serialized=serde_json::to_string(&schedule)?;
            db.execute("INSERT INTO retention_completions VALUES(?1,?2,'review_completed',?3,?4)",params![completion,run.id,evidence_level,now.timestamp_millis()])?;
            let grade=serde_json::to_value(rating)?.as_str().ok_or(Error::Rule("invalid_rating"))?.to_owned();
            db.execute("INSERT INTO memory_outcomes VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![outcome,run.id,target,completion,revision,due,grade,outcome_basis,evidence_level,now.timestamp_millis()])?;
            db.execute("INSERT INTO scheduling_decisions VALUES(?1,?2,?3,?4,?5)",params![id(),outcome,SCHEDULING_POLICY,serialized,now.timestamp_millis()])?;
            if db.execute("UPDATE memory SET revision=revision+1,due_at_ms=?2,schedule=?3 WHERE target_id=?1 AND revision=?4 AND due_at_ms=?5",params![target,schedule.due_at.timestamp_millis(),serialized,revision,due])?!=1 {return Err(Error::Rule("stale_due"));}
            if let Some(eligible)=next_eligible_at {db.execute("INSERT INTO relearning_needs VALUES(?1,?2,?3,NULL,?4,NULL)",params![id(),target,outcome,eligible.timestamp_millis()])?;}
        }
        Settlement::RelearningCompletion {evidence_level} => {
            db.execute("INSERT INTO retention_completions VALUES(?1,?2,'relearning_completion',?3,?4)",params![id(),run.id,evidence_level,now.timestamp_millis()])?;
            if db.execute("UPDATE relearning_needs SET resolved_at_ms=?2 WHERE run_id=?1 AND resolved_at_ms IS NULL",params![run.id,now.timestamp_millis()])?!=1 {return Err(Error::Rule("need_unavailable"));}
        }
        _=>return Err(Error::Rule("invalid_settlement")),
    }
    Ok(())
}

/// Review-only selection never resumes an initial run or consumes new-study quota.
pub(super) fn next(db: &Connection, now: DateTime<Utc>) -> Result<()> {
    let candidate: Option<(String,bool)> = db.query_row(
        "SELECT t.material_id,
          CASE WHEN n.id IS NOT NULL AND n.next_eligible_at_ms>?1 AND (r.id IS NULL OR r.phase='waiting') THEN 1 ELSE 0 END AS waiting
         FROM targets t JOIN memory m ON m.target_id=t.id
         LEFT JOIN relearning_needs n ON n.target_id=t.id AND n.resolved_at_ms IS NULL
         LEFT JOIN retention_runs r ON r.target_id=t.id AND r.phase<>'completed'
         WHERE r.id IS NOT NULL OR n.id IS NOT NULL OR m.due_at_ms<=?1
         ORDER BY waiting, CASE WHEN r.id IS NOT NULL AND r.phase<>'waiting' THEN 0 WHEN n.id IS NOT NULL THEN 1 ELSE 2 END,
         COALESCE(n.next_eligible_at_ms,m.due_at_ms), t.id LIMIT 1",
        [now.timestamp_millis()], |r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let (material, waiting) = candidate.ok_or(Error::Rule("no_due_review"))?;
    db.execute("UPDATE runs SET paused=1 WHERE phase<>'completed'", [])?;
    db.execute(
        "UPDATE retention_runs SET paused=1 WHERE phase<>'completed'",
        [],
    )?;
    db.execute("UPDATE library SET selected_material_id=?1", [material])?;
    if !waiting {
        start(db, &read(db)?, now, false)?;
    }
    Ok(())
}
