//! Formal activity orchestration around the existing purpose-specific executors.
//! Scope and intent constrain planning; summaries only collect committed results.
use super::*;
use rusqlite::Transaction;
use serde_json::{Value, json};
use std::collections::BTreeSet;
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Mixed,
    ReviewOnly,
}
impl Mode {
    fn key(self) -> &'static str {
        match self {
            Self::Mixed => "mixed",
            Self::ReviewOnly => "review_only",
        }
    }
}
#[derive(Clone)]
struct Candidate {
    target: String,
    material: String,
    kind: &'static str,
    rank: u8,
    time: i64,
}
fn day(now: DateTime<Utc>, offset: i32) -> Result<(String, i64)> {
    let delta = chrono::Duration::minutes(i64::from(offset));
    let local = now
        .checked_add_signed(delta)
        .ok_or(Error::Rule("clock_out_of_range"))?;
    let start = local
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or(Error::Rule("clock_out_of_range"))?
        .and_utc()
        .checked_sub_signed(delta)
        .ok_or(Error::Rule("clock_out_of_range"))?;
    Ok((
        local.format("%Y-%m-%d").to_string(),
        start.timestamp_millis(),
    ))
}
pub(super) fn allows(db: &Connection, target: &str, initial: bool) -> Result<bool> {
    let active: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM learning_activities WHERE status='active')",
        [],
        |r| r.get(0),
    )?;
    if !active {
        return curriculum::allows(db, target, initial);
    }
    Ok(db.query_row("SELECT EXISTS(SELECT 1 FROM learning_activities a JOIN activity_scope s ON s.activity_id=a.id WHERE a.status='active' AND s.target_id=?1 AND (?2=0 OR (a.mode='mixed' AND (s.new_eligible=1 OR EXISTS(SELECT 1 FROM runs WHERE target_id=?1)))))",params![target,initial],|r|r.get(0))?)
}
/// Reservations constrain admission, but only accepted introductions count as learning.
pub(super) fn quota(
    db: &Connection,
    now: DateTime<Utc>,
    offset: i32,
    reservations: bool,
) -> Result<u32> {
    let (_, start) = day(now, offset)?;
    Ok(db.query_row("SELECT (SELECT count(*) FROM initial_introductions WHERE occurred_at_ms>=?1 AND occurred_at_ms<?2) + CASE WHEN ?3 THEN (SELECT count(*) FROM runs r WHERE started_at_ms>=?1 AND started_at_ms<?2 AND NOT EXISTS(SELECT 1 FROM initial_introductions i WHERE i.target_id=r.target_id)) ELSE 0 END", params![start,start+86400000,reservations], |r|r.get(0))?)
}
pub(super) fn introduce(
    db: &Connection,
    target: &str,
    run: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM initial_introductions WHERE target_id=?1)",
        [target],
        |r| r.get(0),
    )?;
    if exists {
        return Ok(());
    }
    let offset = db.query_row("SELECT offset_minutes FROM activity_clock", [], |r| {
        r.get(0)
    })?;
    let limit: u32 = db.query_row("SELECT daily_new_limit FROM library", [], |r| r.get(0))?;
    if quota(db, now, offset, false)? >= limit {
        return Err(Error::Rule("daily_limit"));
    }
    db.execute(
        "INSERT INTO initial_introductions VALUES(?1,?2,?3,'accepted_introduction_v7')",
        params![target, run, now.timestamp_millis()],
    )?;
    Ok(())
}
/// Explicit material navigation leaves the foreground activity; its scope/history remain resumable.
pub(super) fn leave(db: &Connection) -> Result<()> {
    pause_executors(db)?;
    db.execute(
        "UPDATE learning_activities SET status='paused' WHERE status='active'",
        [],
    )?;
    db.execute("UPDATE activity_clock SET current_activity=NULL", [])?;
    Ok(())
}
pub(super) fn guard_execution(db: &Connection, execution: &str) -> Result<()> {
    let allowed: bool=db.query_row("SELECT NOT EXISTS(SELECT 1 FROM learning_activities WHERE status='active') OR EXISTS(SELECT 1 FROM learning_activities WHERE status='active' AND current_execution=?1)",[execution],|r|r.get(0))?;
    if !allowed {
        return Err(Error::Rule("activity_execution_mismatch"));
    }
    Ok(())
}
/// The planner owns the full admitted set. The structured adapter only orders it.
pub(super) fn initial_cohort(
    db: &Connection,
    target: &str,
    now: DateTime<Utc>,
    offset_minutes: i32,
) -> Result<Vec<String>> {
    let limit: u32 = db.query_row("SELECT daily_new_limit FROM library", [], |r| r.get(0))?;
    let count = quota(db, now, offset_minutes, true)?;
    if count >= limit {
        return Err(Error::Rule("daily_limit"));
    }
    let mut targets = vec![target.to_owned()];
    let mut stmt=db.prepare("SELECT id FROM targets WHERE id<>?1 AND NOT EXISTS(SELECT 1 FROM runs WHERE runs.target_id=targets.id) ORDER BY id")?;
    let active: Option<String> = db
        .query_row(
            "SELECT id FROM learning_activities WHERE status='active'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let ranks = scope_ranks(db, active.as_deref())?;
    let mut ordered = stmt
        .query_map([target], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    ordered.sort_by_key(|id| (ranks.get(id).map(|r| r.1).unwrap_or(i64::MAX), id.clone()));
    for id in ordered {
        if !allows(db, &id, true)? {
            continue;
        }
        if targets.len() >= (limit - count) as usize {
            break;
        }
        let p = policy::refresh_target(db, &id)?;
        if p.plan
            .purposes
            .initial_learning
            .binding
            .binding
            .runtime_adapter_id
            == "structured"
            && p.plan.purposes.initial_learning.provisioned
            && p.plan.purposes.initial_learning.readiness.status
                == sensa_core::planning::Readiness::Ready
        {
            targets.push(id);
        }
    }
    Ok(targets)
}
fn scope_ranks(
    db: &Connection,
    scope: Option<&str>,
) -> Result<std::collections::BTreeMap<String, (bool, i64)>> {
    let scope_content = if let Some(aid) = scope {
        db.query_row("SELECT c.content FROM curriculum_scopes c JOIN learning_activities a ON a.scope_revision=c.revision WHERE a.id=?1 AND EXISTS(SELECT 1 FROM activity_scope_sources WHERE activity_id=a.id)",[aid],|r|r.get::<_,String>(0)).optional()?.map(|s|serde_json::from_str::<Value>(&s)).transpose()?.unwrap_or(json!({"members":[]}))
    } else {
        curriculum::current(db)?.1
    };
    let ranks = scope_content["members"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, m)| {
            (
                m["targetId"].as_str().unwrap().to_owned(),
                (m["newEligible"] == true, i as i64),
            )
        })
        .collect();
    Ok(ranks)
}
fn candidates(
    db: &Connection,
    mode: Mode,
    scope: Option<&str>,
    now: DateTime<Utc>,
    offset: i32,
) -> Result<(Vec<Candidate>, u32)> {
    let used = quota(db, now, offset, true)?;
    let ranks = scope_ranks(db, scope)?;

    let mut stmt=db.prepare("SELECT t.id,t.material_id,r.id,r.phase,r.started_at_ms,n.next_eligible_at_ms,m.due_at_ms FROM targets t LEFT JOIN runs r ON r.target_id=t.id LEFT JOIN relearning_needs n ON n.target_id=t.id AND n.resolved_at_ms IS NULL LEFT JOIN memory m ON m.target_id=t.id WHERE ?1 IS NULL OR EXISTS(SELECT 1 FROM activity_scope s WHERE s.activity_id=?1 AND s.target_id=t.id) ORDER BY t.id")?;
    let rows = stmt
        .query_map([scope], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<i64>>(6)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut out = vec![];
    for (target, material, run, phase, started, need, due) in rows {
        let declared:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM assurance_sessions s, json_each(s.state,'$.queue.frame.states') t WHERE json_extract(t.value,'$.retentionTargetId')=?1 AND json_extract(t.value,'$.declaredMastery')=1 AND s.rowid=(SELECT max(s2.rowid) FROM assurance_sessions s2 JOIN assurance_session_targets t2 ON t2.session_id=s2.id WHERE t2.target_id=?1 AND s2.purpose='initial_learning'))",[&target],|r|r.get(0))?;
        if scope.is_none() && !ranks.contains_key(&target) {
            continue;
        }
        if declared {
            continue;
        }
        let active:Option<(String,i64,String)>=db.query_row("SELECT phase,started_at_ms,protocol_version FROM retention_runs WHERE target_id=?1 AND phase<>'completed' ORDER BY rowid DESC LIMIT 1",[&target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let (kind, rank, time, purpose) = if let Some((p, t, protocol)) = &active
            && p != "waiting"
        {
            if protocol.contains("relearning") {
                ("relearning", 0, *t, "relearning")
            } else {
                ("retention", 0, *t, "retention_review")
            }
        } else if mode == Mode::Mixed && run.is_some() && phase.as_deref() != Some("completed") {
            ("initial", 0, started.unwrap_or(0), "initial_learning")
        } else if let Some(n) = need {
            (
                if n <= now.timestamp_millis() {
                    "relearning"
                } else {
                    "waiting"
                },
                1,
                n,
                "relearning",
            )
        } else if let Some(d) = due
            && d <= now.timestamp_millis()
        {
            ("retention", 2, d, "retention_review")
        } else if mode == Mode::Mixed && run.is_none() {
            ("new", 3, 0, "initial_learning")
        } else {
            continue;
        };
        if kind == "new"
            && !if let Some(aid) = scope {
                db.query_row(
                    "SELECT new_eligible FROM activity_scope WHERE activity_id=?1 AND target_id=?2",
                    params![aid, target],
                    |r| r.get::<_, bool>(0),
                )?
            } else {
                ranks.get(&target).is_some_and(|r| r.0)
            }
        {
            continue;
        }
        let plan:Option<String>=db.query_row("SELECT content FROM target_plans WHERE id=COALESCE((SELECT plan_id FROM policy_commitments WHERE target_id=?1),(SELECT id FROM target_plans WHERE target_id=?1 ORDER BY revision DESC LIMIT 1))",[&target],|r|r.get(0)).optional()?;
        let ready = plan
            .map(|p| serde_json::from_str::<Value>(&p))
            .transpose()?
            .is_some_and(|p| p["purposes"][purpose]["readiness"]["status"] == "ready");
        let pinned = active.is_some() || run.is_some() && phase.as_deref() != Some("completed");
        if !pinned && (!ready || !provisioning::material_current(db, &target)?) {
            continue;
        }
        let time = if kind == "new" {
            ranks.get(&target).map(|r| r.1).unwrap_or(0)
        } else {
            time
        };
        out.push(Candidate {
            target,
            material,
            kind,
            rank,
            time,
        });
    }
    out.sort_by(|a, b| (a.rank, a.time, &a.target).cmp(&(b.rank, b.time, &b.target)));
    Ok((out, used))
}
fn pause_executors(db: &Connection) -> Result<()> {
    db.execute("UPDATE runs SET paused=1 WHERE phase<>'completed'", [])?;
    db.execute(
        "UPDATE retention_runs SET paused=1 WHERE phase<>'completed'",
        [],
    )?;
    db.execute(
        "UPDATE assurance_sessions SET paused=1 WHERE completed=0",
        [],
    )?;
    Ok(())
}
pub(super) fn fresh(
    db: &Transaction<'_>,
    mode: Mode,
    command: &Command,
    now: DateTime<Utc>,
    offset: i32,
) -> Result<()> {
    db.execute("UPDATE learning_activities SET status='ended',ended_at_ms=?2 WHERE mode=?1 AND status IN ('active','paused')",params![mode.key(),now.timestamp_millis()])?;
    start(db, mode, command, now, offset)
}
pub(super) fn start(
    db: &Transaction<'_>,
    mode: Mode,
    command: &Command,
    now: DateTime<Utc>,
    offset: i32,
) -> Result<()> {
    policy::refresh(db)?;
    let limit: Option<u32> =
        db.query_row("SELECT daily_new_limit FROM library", [], |r| r.get(0))?;
    if limit.is_none() {
        return Err(Error::Rule("quantity_required"));
    }
    pause_executors(db)?;
    db.execute(
        "UPDATE learning_activities SET status='paused' WHERE status='active'",
        [],
    )?;
    let old:Option<String>=db.query_row("SELECT id FROM learning_activities WHERE mode=?1 AND status='paused' ORDER BY rowid DESC LIMIT 1",[mode.key()],|r|r.get(0)).optional()?;
    let fresh = old.is_none();
    let aid = old.unwrap_or_else(id);
    db.execute("INSERT INTO learning_activities VALUES(?1,?2,'active',(SELECT revision FROM library),NULL,NULL,NULL,?3,NULL) ON CONFLICT(id) DO UPDATE SET status='active'",params![aid,mode.key(),now.timestamp_millis()])?;
    // Empty scopes are valid immutable snapshots too; only populate a new activity.
    if fresh {
        curriculum::freeze(db, &aid)?;
    }
    db.execute("UPDATE activity_clock SET current_activity=?1", [&aid])?;
    select(db, &aid, false, command, now, offset)
}
fn active(db: &Connection, aid: &str) -> Result<Mode> {
    let (mode, status): (String, String) = db.query_row(
        "SELECT mode,status FROM learning_activities WHERE id=?1",
        [aid],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if status != "active" {
        return Err(Error::Rule("activity_not_active"));
    }
    Ok(if mode == "mixed" {
        Mode::Mixed
    } else {
        Mode::ReviewOnly
    })
}
fn executable(db: &Connection, aid: &str) -> Result<bool> {
    let row: (Option<String>, Option<String>) = db.query_row(
        "SELECT current_execution,execution_kind FROM learning_activities WHERE id=?1",
        [aid],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let Some(eid) = row.0 else { return Ok(false) };
    Ok(match row.1.as_deref() {
        Some("assurance") => db.query_row(
            "SELECT completed=0 AND paused=0 FROM assurance_sessions WHERE id=?1",
            [eid],
            |r| r.get(0),
        )?,
        Some("initial") => db.query_row(
            "SELECT phase<>'completed' AND paused=0 FROM runs WHERE id=?1",
            [eid],
            |r| r.get(0),
        )?,
        Some("retention") => db.query_row(
            "SELECT phase NOT IN ('completed','waiting') AND paused=0 FROM retention_runs WHERE id=?1",
            [eid],
            |r| r.get(0),
        )?,
        _ => false,
    })
}
pub(super) fn next(
    db: &Transaction<'_>,
    aid: &str,
    early: bool,
    command: &Command,
    now: DateTime<Utc>,
    offset: i32,
) -> Result<()> {
    active(db, aid)?;
    if executable(db, aid)? {
        return Err(Error::Rule("pending_result"));
    }
    select(db, aid, early, command, now, offset)
}
fn select(
    db: &Transaction<'_>,
    aid: &str,
    early: bool,
    command: &Command,
    now: DateTime<Utc>,
    offset: i32,
) -> Result<()> {
    let mode = active(db, aid)?;
    let (candidates, used) = candidates(db, mode, Some(aid), now, offset)?;
    let limit: u32 = db.query_row("SELECT daily_new_limit FROM library", [], |r| r.get(0))?;
    let candidate = candidates
        .iter()
        .find(|c| c.kind != "waiting" && (c.kind != "new" || used < limit))
        .or_else(|| {
            early
                .then(|| candidates.iter().find(|c| c.kind == "waiting"))
                .flatten()
        });
    let Some(c) = candidate else {
        db.execute("UPDATE learning_activities SET current_target=NULL,current_execution=NULL,execution_kind=NULL WHERE id=?1",[aid])?;
        return Ok(());
    };
    db.execute("UPDATE library SET selected_material_id=?1", [&c.material])?;
    let state = read(db)?;
    if c.kind == "new" || c.kind == "initial" {
        start_selected(db, &state, now, offset)?;
    } else {
        retention::start(db, &state, now, early && c.kind == "waiting")?;
    }
    let state = read(db)?;
    let (execution, kind) = if let Some(a) = &state.assurance
        && a["completed"] != true
    {
        (
            a["id"]
                .as_str()
                .ok_or(Error::Rule("no_active_run"))?
                .to_owned(),
            "assurance",
        )
    } else {
        let r = state.run.as_ref().ok_or(Error::Rule("no_active_run"))?;
        (
            r.id.clone(),
            if r.protocol_version == PROTOCOL {
                "initial"
            } else {
                "retention"
            },
        )
    };
    db.execute("UPDATE learning_activities SET current_target=?2,current_execution=?3,execution_kind=?4 WHERE id=?1",params![aid,c.target,execution,kind])?;
    db.execute("INSERT INTO activity_executions VALUES(?1,?2,?3,?4,?5,(SELECT coalesce(max(rowid),0) FROM completions),(SELECT coalesce(max(rowid),0) FROM retention_completions)) ON CONFLICT(activity_id,execution_id) DO UPDATE SET entry_operation_id=excluded.entry_operation_id",params![aid,execution,kind,command.operation_id,now.timestamp_millis()])?;
    Ok(())
}
pub(super) fn stop(db: &Transaction<'_>, aid: &str, end: bool, now: DateTime<Utc>) -> Result<()> {
    active(db, aid)?;
    pause_executors(db)?;
    db.execute("UPDATE learning_activities SET status=?2,ended_at_ms=CASE WHEN ?2='ended' THEN ?3 ELSE NULL END WHERE id=?1",params![aid,if end{"ended"}else{"paused"},now.timestamp_millis()])?;
    Ok(())
}
pub(super) fn capture_results(db: &Connection, initial: i64, retention: i64) -> Result<()> {
    for (table, run_table, baseline, kind) in [
        ("completions", "runs", "initial_baseline", "initial"),
        (
            "retention_completions",
            "retention_runs",
            "retention_baseline",
            "retention",
        ),
    ] {
        let sql = format!(
            "INSERT OR IGNORE INTO activity_results SELECT c.id,a.id,r.target_id,c.kind,c.occurred_at_ms FROM {table} c JOIN {run_table} r ON r.id=c.run_id JOIN activity_executions e ON ((e.execution_kind='{kind}' AND e.execution_id=r.id) OR (e.execution_kind='assurance' AND EXISTS(SELECT 1 FROM assurance_session_targets s WHERE s.session_id=e.execution_id AND (s.run_id=r.id OR ('{kind}'='retention' AND s.target_id=r.target_id AND EXISTS(SELECT 1 FROM assurance_cycles cy WHERE cy.target_id=s.target_id AND cy.run_id=r.id)))))) JOIN learning_activities a ON a.id=e.activity_id AND a.status='active' WHERE c.rowid>e.{baseline} AND c.rowid>?1"
        );
        db.execute(
            &sql,
            [if kind == "initial" {
                initial
            } else {
                retention
            }],
        )?;
    }
    Ok(())
}
pub(super) fn check_in(
    db: &Transaction<'_>,
    aid: Option<&str>,
    execution: Option<&str>,
    entry: Option<&str>,
    command: &Command,
    now: DateTime<Utc>,
    offset: i32,
) -> Result<()> {
    let formal = aid.is_some();
    if formal {
        let aid = aid.unwrap();
        active(db, aid)?;
        let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM activity_executions e JOIN learning_activities a ON a.id=e.activity_id WHERE a.id=?1 AND a.current_execution=e.execution_id AND e.execution_id=?2 AND e.entry_operation_id=?3)",params![aid,execution,entry],|r|r.get(0))?;
        if !valid || !executable(db, aid)? {
            return Err(Error::Rule("invalid_checkin_source"));
        }
    } else if execution.is_some() || entry.is_some() {
        return Err(Error::Rule("invalid_checkin_source"));
    }
    let (date, _) = day(now, offset)?;
    db.execute("INSERT INTO local_checkins VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(local_date) DO NOTHING",params![date,if formal{"formal_learning"}else{"manual"},now.timestamp_millis(),offset,aid,execution,entry,command.operation_id])?;
    Ok(())
}
fn summary(db: &Connection, aid: &str) -> Result<Value> {
    let mut q = db.prepare(
        "SELECT target_id,kind FROM activity_results WHERE activity_id=?1 ORDER BY target_id",
    )?;
    let results = q
        .query_map([aid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let ids = |kinds: &[&str]| {
        results
            .iter()
            .filter(|(_, k)| kinds.contains(&k.as_str()))
            .map(|(id, _)| id.clone())
            .collect::<BTreeSet<_>>()
    };
    let initial = ids(&["study_completion", "acquisition_graduation"]);
    let reviewed = ids(&["review_completed"]);
    let restored = ids(&["relearning_completion"]);
    let distinct = initial
        .union(&reviewed)
        .cloned()
        .chain(restored.iter().cloned())
        .collect::<BTreeSet<_>>();
    let mut q=db.prepare("SELECT DISTINCT n.target_id,n.next_eligible_at_ms FROM relearning_needs n JOIN activity_scope s ON s.target_id=n.target_id WHERE s.activity_id=?1 AND n.resolved_at_ms IS NULL ORDER BY n.target_id")?;
    let needs = q
        .query_map([aid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let now: i64 = db.query_row("SELECT last_time_ms FROM library", [], |r| r.get(0))?;
    Ok(
        json!({"initialTargetIds":initial,"reviewTargetIds":reviewed,"restoredTargetIds":restored,"distinctTargetCount":distinct.len(),"needsRecallTargetIds":needs.iter().map(|n|&n.0).collect::<Vec<_>>(),"waitingTargetIds":needs.iter().filter(|n|n.1>now).map(|n|&n.0).collect::<Vec<_>>(),"nextEligibleAtMs":needs.iter().filter(|n|n.1>now).map(|n|n.1).min()}),
    )
}
type ActivityRow = (String, String, String, Option<String>, Option<String>, i64);

pub(super) fn project(db: &Connection) -> Result<Value> {
    let (ms, offset): (i64, i32) = db.query_row(
        "SELECT last_time_ms,offset_minutes FROM library,activity_clock",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let now = DateTime::from_timestamp_millis(ms).ok_or(Error::Rule("clock_out_of_range"))?;
    let (date, _) = day(now, offset)?;
    let current:Option<ActivityRow>=db.query_row("SELECT id,mode,status,current_execution,execution_kind,scope_revision FROM learning_activities WHERE id=(SELECT current_activity FROM activity_clock)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional()?;
    let (items, used) = candidates(db, Mode::Mixed, None, now, offset)?;
    let limit: u32 = db.query_row("SELECT coalesce(daily_new_limit,0) FROM library", [], |r| {
        r.get(0)
    })?;
    let introduced = quota(db, now, offset, false)?;
    let count = |kind: &str| items.iter().filter(|c| c.kind == kind).count();
    let mut q = db.prepare(
        "SELECT local_date,source FROM local_checkins ORDER BY local_date DESC LIMIT 366",
    )?;
    let checkins = q
        .query_map([], |r| {
            Ok(json!({"date":r.get::<_,String>(0)?,"source":r.get::<_,String>(1)?}))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut q = db.prepare(
        "SELECT id,mode,status,started_at_ms FROM learning_activities ORDER BY rowid DESC LIMIT 30",
    )?;
    let history=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?)))?.map(|r|{let (id,mode,status,start)=r?;Ok(json!({"id":id,"mode":mode,"status":status,"startedAtMs":start,"summary":summary(db,&id)?}))}).collect::<Result<Vec<_>>>()?;
    let activity = if let Some((id, mode, status, execution, kind, scope)) = current {
        let entry:Option<String>=db.query_row("SELECT entry_operation_id FROM activity_executions WHERE activity_id=?1 AND execution_id=?2",params![id,execution],|r|r.get(0)).optional()?;
        let (remaining, reserved) = candidates(
            db,
            if mode == "mixed" {
                Mode::Mixed
            } else {
                Mode::ReviewOnly
            },
            Some(&id),
            now,
            offset,
        )?;
        let immediate = remaining
            .iter()
            .any(|c| c.kind != "waiting" && (c.kind != "new" || reserved < limit));
        let empty_reason = if immediate {
            "work_available"
        } else if remaining.iter().any(|c| c.kind == "waiting") {
            "waiting"
        } else if remaining.iter().any(|c| c.kind == "new") {
            "daily_limit"
        } else {
            "scope_complete"
        };
        Some(
            json!({"immediateAvailable":immediate,"emptyReason":empty_reason,"id":id,"mode":mode,"status":status,"executionId":execution,"executionKind":kind,"entryOperationId":entry,"scopeRevision":scope,"canAnswer":executable(db,&id)?,"summary":summary(db,&id)?}),
        )
    } else {
        None
    };
    Ok(
        json!({"date":date,"offsetMinutes":offset,"newStartedToday":introduced,"newReservedToday":used.saturating_sub(introduced),"counts":{"newAvailable":count("new").min(limit.saturating_sub(used) as usize),"initialContinuations":count("initial"),"dueReviews":count("retention"),"relearningReady":count("relearning"),"relearningWaiting":count("waiting"),"distinctExecutableTargets":items.iter().filter(|c|c.kind!="waiting" && c.kind!="new").map(|c|&c.target).collect::<BTreeSet<_>>().len()+count("new").min(limit.saturating_sub(used) as usize)},"activity":activity,"checkins":checkins,"history":history}),
    )
}
