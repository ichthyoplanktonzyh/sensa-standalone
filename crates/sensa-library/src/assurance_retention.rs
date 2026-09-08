//! Due-trigger transactions around the migrated ReviewQueue. Local undo cannot
//! retract the first durable Memory Outcome or replay it as another rating.
use super::assurance_runtime::{Draft, Intent};
use super::*;
use rusqlite::Transaction;
use sensa_core::{assurance_material as material, assurance_review as review, scheduling::*};
use serde_json::{Value, json};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    version: u32,
    queue: review::Queue,
    draft: Draft,
}
fn rule(_: String) -> Error {
    Error::Rule("invalid_assurance_transition")
}
fn at(ms: i64) -> Result<DateTime<Utc>> {
    DateTime::from_timestamp_millis(ms).ok_or(Error::Rule("clock_out_of_range"))
}
pub(super) fn start(db: &Transaction<'_>, now: DateTime<Utc>) -> Result<()> {
    let selected: String = db.query_row(
        "SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library)",
        [],
        |r| r.get(0),
    )?;
    let active: Option<String> = db
        .query_row(
            "SELECT id FROM assurance_sessions WHERE completed=0",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(s) = active {
        let member: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2)", params![s,selected], |r| r.get(0))?;
        if !member {
            return Err(Error::Rule("assurance_session_active"));
        }
        db.execute("UPDATE assurance_sessions SET paused=0 WHERE id=?1", [s])?;
        return Ok(());
    }
    let mut stmt=db.prepare("SELECT t.id,t.material_id,m.revision,m.due_at_ms,m.schedule,p.plan_id FROM targets t JOIN memory m ON m.target_id=t.id JOIN policy_commitments p ON p.target_id=t.id WHERE m.due_at_ms<=?1 OR EXISTS(SELECT 1 FROM assurance_cycles c WHERE c.target_id=t.id AND c.completed=0) ORDER BY t.id")?;
    let rows = stmt
        .query_map([now.timestamp_millis()], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u32>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let sid = id();
    let mut candidates = vec![];
    let mut links = vec![];
    for (target, mid, revision, due, _, plan_id) in rows {
        let plan: String = db.query_row(
            "SELECT content FROM target_plans WHERE id=?1",
            [&plan_id],
            |r| r.get(0),
        )?;
        let plan: sensa_core::planning::LearningPlan = serde_json::from_str(&plan)?;
        if plan
            .purposes
            .retention_review
            .binding
            .binding
            .runtime_adapter_id
            != "structured"
        {
            continue;
        }
        crate::composition::validate_structured_profile(&plan.profile)
            .map_err(|_| Error::Rule("learning_plan_blocked"))?;
        for (purpose, p) in [
            ("retention_review", &plan.purposes.retention_review),
            ("relearning", &plan.purposes.relearning),
        ] {
            crate::composition::validate_structured_spec(purpose, &p.binding)
                .map_err(|_| Error::Rule("learning_plan_blocked"))?;
        }
        if !assurance::ready(db, &mid)? {
            return Err(Error::Rule("learning_plan_blocked"));
        }
        let (release, key, digest) = assurance::load(db, &mid)?;
        let p = release["packages"]
            .as_array()
            .and_then(|ps| ps.iter().find(|p| p["identity"]["packageKey"] == key))
            .ok_or(Error::Rule("material_mismatch"))?;
        let cycle: Option<(String, String)> = db
            .query_row(
                "SELECT content,run_id FROM assurance_cycles WHERE target_id=?1 AND completed=0",
                [&target],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (phase, relearning, run) = if let Some((content, run)) = cycle {
            (
                "relearning",
                Some(serde_json::from_str::<Value>(&content)?),
                run,
            )
        } else {
            let run = id();
            let (content, base_digest): (String, String) = db.query_row(
                "SELECT content,digest FROM materials WHERE id=?1",
                [&mid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            db.execute("INSERT INTO retention_runs VALUES(?1,?2,?3,?4,?5,'evidence-oriented-retention-review-v1','recall',1,0,0,?6,?7,?8)",params![run,target,mid,base_digest,content,now.timestamp_millis(),revision,due])?;
            db.execute(
                "INSERT INTO retention_run_policies VALUES(?1,?2)",
                params![run, plan_id],
            )?;
            ("retaining", None, run)
        };
        candidates.push(review::Candidate {
            package_id: key,
            sense_id: p["identity"]["senseKey"]
                .as_str()
                .ok_or(Error::Rule("material_mismatch"))?
                .into(),
            retention_target_id: target.clone(),
            outcome_key: format!("native-review:{target}:{revision}:{due}"),
            inventory: material::inventory(p).map_err(rule)?,
            phase: phase.into(),
            relearning,
            diagnostic_facts: Default::default(),
        });
        links.push((target, run, mid, digest, plan_id));
    }
    if !candidates.iter().any(|c| c.retention_target_id == selected) {
        return Err(Error::Rule("no_due_review"));
    }
    let mut order = candidates
        .iter()
        .map(|c| c.retention_target_id.clone())
        .collect::<Vec<_>>();
    order.sort();
    let queue =
        review::Queue::new(candidates, order, 2, None, now.timestamp_millis()).map_err(rule)?;
    let state = State {
        version: 1,
        queue,
        draft: Draft::default(),
    };
    db.execute(
        "INSERT INTO assurance_sessions VALUES(?1,'retention_review',?2,1,0,0,?3)",
        params![sid, serde_json::to_string(&state)?, now.timestamp_millis()],
    )?;
    for (target, run, mid, digest, plan) in links {
        db.execute(
            "INSERT INTO assurance_session_targets VALUES(?1,?2,?3,?4,?5,?6)",
            params![sid, target, run, mid, digest, plan],
        )?;
    }
    Ok(())
}
fn load(db: &Connection, sid: &str) -> Result<(State, u32, bool, bool)> {
    let (raw, n, paused, done): (String, u32, bool, bool) = db.query_row(
        "SELECT state,ordinal,paused,completed FROM assurance_sessions WHERE id=?1",
        [sid],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    assurance_runtime::verify_journal(db, sid, &raw, n)?;
    let mut state: State = serde_json::from_str(&raw)?;
    if state.version != 1 {
        return Err(Error::Rule("unsupported_assurance_version"));
    }
    state.queue = review::Queue::restore(&serde_json::to_string(&state.queue)?).map_err(rule)?;
    Ok((state, n, paused, done))
}
fn current(state: &State) -> Result<Value> {
    let v = state.queue.view();
    if v["session"].is_null() {
        return Err(Error::Rule("no_active_step"));
    }
    Ok(v["session"].clone())
}
fn binding(
    db: &Connection,
    sid: &str,
    s: &Value,
) -> Result<(String, String, Value, String, String)> {
    let target = s["action"]["retentionTargetId"]
        .as_str()
        .ok_or(Error::Rule("invalid_assurance_transition"))?;
    let (mid,digest,run,plan):(String,String,String,String)=db.query_row("SELECT material_id,material_digest,run_id,plan_id FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2",params![sid,target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    let (release, key, current) = assurance::load(db, &mid)?;
    if current != digest {
        return Err(Error::Rule("material_mismatch"));
    }
    Ok((key, digest, release, run, plan))
}
fn resource(db: &Connection, sid: &str, state: &State) -> Result<Value> {
    let s = current(state)?;
    let (key, _, release, _, _) = binding(db, sid, &s)?;
    material::resolve(
        &release,
        &key,
        s["action"]["senseId"]
            .as_str()
            .ok_or(Error::Rule("material_mismatch"))?,
        s["action"]["taskKey"]
            .as_str()
            .ok_or(Error::Rule("material_mismatch"))?,
        serde_json::from_value(s["action"]["capability"].clone())?,
    )
    .map_err(rule)
}
fn settle_effects(
    db: &Transaction<'_>,
    sid: &str,
    effects: &[Value],
    now: DateTime<Utc>,
) -> Result<()> {
    for e in effects {
        let action = &e["action"];
        let target = action["retentionTargetId"]
            .as_str()
            .ok_or(Error::Rule("invalid_assurance_transition"))?;
        if e["type"] == "retention_outcome" {
            let (run,plan):(String,String)=db.query_row("SELECT run_id,plan_id FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2",params![sid,target],|r|Ok((r.get(0)?,r.get(1)?)))?;
            let exists: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM memory_outcomes WHERE run_id=?1)",
                [&run],
                |r| r.get(0),
            )?;
            if exists {
                continue;
            }
            let (revision, due, encoded): (u32, i64, String) = db.query_row(
                "SELECT revision,due_at_ms,schedule FROM memory WHERE target_id=?1",
                [target],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            let (trigger, trigger_due): (u32, i64) = db.query_row(
                "SELECT trigger_revision,trigger_due_at_ms FROM retention_runs WHERE id=?1",
                [&run],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            if revision != trigger || due != trigger_due || now < at(due)? {
                return Err(Error::Rule("stale_due"));
            }
            let old: ReviewSchedule = serde_json::from_str(&encoded)?;
            let correct = e["result"]["correct"] == true;
            let outcome = &e["result"]["memoryOutcome"];
            let next = compute_review_schedule(
                &ScheduleState::with_schedule(target.into(), &old),
                &SchedulerConfig::default(),
                if correct { 2 } else { 0 },
                now,
            )
            .map_err(Error::Rule)?;
            let encoded = serde_json::to_string(&next)?;
            let completion = id();
            let outcome_id = id();
            db.execute("INSERT INTO retention_completions VALUES(?1,?2,'review_completed','behavioral',?3)",params![completion,run,now.timestamp_millis()])?;
            db.execute(
                "INSERT INTO memory_outcomes VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'behavioral',?9)",
                params![
                    outcome_id,
                    run,
                    target,
                    completion,
                    revision,
                    due,
                    outcome["grade"].as_str(),
                    outcome["basis"].as_str(),
                    now.timestamp_millis()
                ],
            )?;
            db.execute(
                "INSERT INTO scheduling_decisions VALUES(?1,?2,'fsrs-retention-v1',?3,?4)",
                params![id(), outcome_id, encoded, now.timestamp_millis()],
            )?;
            if db.execute("UPDATE memory SET revision=revision+1,due_at_ms=?2,schedule=?3 WHERE target_id=?1 AND revision=?4 AND due_at_ms=?5",params![target,next.due_at.timestamp_millis(),encoded,revision,due])?!=1{return Err(Error::Rule("stale_due"));}
            db.execute(
                "UPDATE retention_runs SET phase='completed' WHERE id=?1",
                [&run],
            )?;
            if !e["relearningCycle"].is_null() {
                let cycle = &e["relearningCycle"];
                let rerun = id();
                let need = id();
                let (mid, base_digest, content): (String, String, String) = db.query_row(
                    "SELECT material_id,material_digest,content FROM retention_runs WHERE id=?1",
                    [&run],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?;
                db.execute("INSERT INTO retention_runs VALUES(?1,?2,?3,?4,?5,'targeted-structured-relearning-v1','recall',1,0,0,?6,NULL,NULL)",params![rerun,target,mid,base_digest,content,now.timestamp_millis()])?;
                db.execute(
                    "INSERT INTO retention_run_policies VALUES(?1,?2)",
                    params![rerun, plan],
                )?;
                db.execute(
                    "INSERT INTO relearning_needs VALUES(?1,?2,?3,?4,?5,NULL)",
                    params![need, target, outcome_id, rerun, now.timestamp_millis()],
                )?;
                db.execute("INSERT INTO assurance_cycles VALUES(?1,?2,?3,?4,?5,0) ON CONFLICT(target_id) DO UPDATE SET cycle_id=excluded.cycle_id,content=excluded.content,need_id=excluded.need_id,run_id=excluded.run_id,completed=0",params![target,cycle["cycleId"].as_str(),serde_json::to_string(cycle)?,need,rerun])?;
            }
        } else if e["type"] == "relearning_progress" {
            let row:Option<(String,String,String,bool)>=db.query_row("SELECT cycle_id,need_id,run_id,completed FROM assurance_cycles WHERE target_id=?1",[target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
            let Some((cycle, need, run, completed)) = row else {
                continue;
            };
            if completed || e["cycle"]["cycleId"] != cycle {
                continue;
            }
            if e["event"] == "retest_passed" {
                db.execute(
                    "UPDATE assurance_cycles SET completed=1 WHERE target_id=?1",
                    [target],
                )?;
                db.execute(
                    "UPDATE relearning_needs SET resolved_at_ms=?2 WHERE id=?1",
                    params![need, now.timestamp_millis()],
                )?;
                db.execute("INSERT INTO retention_completions VALUES(?1,?2,'relearning_completion','behavioral',?3)",params![id(),run,now.timestamp_millis()])?;
                db.execute(
                    "UPDATE retention_runs SET phase='completed' WHERE id=?1",
                    [run],
                )?;
            } else {
                db.execute(
                    "UPDATE assurance_cycles SET content=?2 WHERE target_id=?1",
                    params![target, serde_json::to_string(&e["cycle"])?],
                )?;
            }
        }
    }
    Ok(())
}
pub(super) fn record(
    db: &Transaction<'_>,
    sid: &str,
    ordinal: u32,
    intent: &Intent,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<()> {
    let (mut state, expected, paused, completed) = load(db, sid)?;
    if expected != ordinal || paused || completed {
        return Err(Error::Rule("stale_step"));
    }
    let session = current(&state)?;
    let repair = session["action"]["intent"] == "repair";
    let mut effects = vec![];
    match intent {
        Intent::Experience { value, text_scene } => {
            if !value.is_finite() || !repair {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            state.draft.experience_value = *value;
            state.draft.text_scene = *text_scene;
        }
        Intent::Draft { text, option_id } => {
            if text.len() > 8000
                || option_id.as_ref().is_some_and(|id| id.len() > 500)
                || session["settled"] == true
            {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            state.draft.text = text.clone();
            state.draft.option_id = option_id.clone();
        }
        Intent::Reveal => {
            if !repair {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            state.draft.revealed = true;
        }
        Intent::Support { .. } => return Err(Error::Rule("independent_retest_required")),
        Intent::Submit => {
            if repair || session["settled"] == true {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            let r = resource(db, sid, &state)?;
            let e = material::evaluate(
                &r,
                material::Support::Independent,
                true,
                &material::Answer {
                    text: Some(state.draft.text.clone()),
                    option_id: state.draft.option_id.clone(),
                },
            )
            .map_err(rule)?;
            let correct = matches!(e.outcome.as_deref(), Some("independent" | "success"));
            let attempt = format!("{}:assessment", command.operation_id);
            let (_, digest, _, mut run, _) = binding(db, sid, &session)?;
            if session["candidatePhase"] == "relearning" {
                run = db.query_row(
                    "SELECT run_id FROM assurance_cycles WHERE target_id=?1",
                    [session["action"]["retentionTargetId"].as_str()],
                    |r| r.get(0),
                )?;
            }
            effects=state.queue.execute(review::Event::Settle{result:json!({"assessmentId":attempt,"kind":session["assessmentKind"],"focusDimension":"","correct":correct,"responseId":e.response_id,"memoryOutcome":null,"evidenceEligible":false})}).map_err(rule)?;
            // Queue receipts may preserve the first due response after local undo. Record
            // this raw response without substituting it for that already committed result.
            db.execute("INSERT INTO assurance_evidence VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'\"independent\"',?11,1,?12)",params![format!("{attempt}:evidence"),command.operation_id,sid,session["action"]["retentionTargetId"].as_str(),run,digest,session["action"]["actionKey"].as_str(),session["action"]["taskKey"].as_str(),session["action"]["capability"].as_str(),serde_json::to_string(&e)?,correct,now.timestamp_millis()])?;
            state.draft.evaluation = Some(e);
        }
        Intent::Continue => {
            if repair {
                if !state.draft.revealed {
                    return Err(Error::Rule("reveal_required"));
                }
                effects = state.queue.execute(review::Event::Repair).map_err(rule)?;
            } else if session["settled"] != true {
                return Err(Error::Rule("answer_required"));
            }
            state.queue.execute(review::Event::Next).map_err(rule)?;
            state.draft = Draft::default();
        }
        Intent::Undo => {
            state.queue.execute(review::Event::Undo).map_err(rule)?;
            state.draft = Draft::default();
        }
        Intent::Mastery => {
            state.queue.execute(review::Event::Exclude).map_err(rule)?;
            state.queue.execute(review::Event::Next).map_err(rule)?;
            state.draft = Draft::default();
        }
        Intent::ReturnTarget { .. } => return Err(Error::Rule("invalid_assurance_transition")),
        Intent::Mistake => return Err(Error::Rule("independent_retest_required")),
        Intent::Pause => {
            db.execute("UPDATE assurance_sessions SET paused=1 WHERE id=?1", [sid])?;
        }
    }
    settle_effects(db, sid, &effects, now)?;
    let done = state.queue.view()["done"] == true;
    let encoded = serde_json::to_string(&state)?;
    db.execute(
        "UPDATE assurance_sessions SET state=?2,ordinal=ordinal+1,completed=?3 WHERE id=?1",
        params![sid, encoded, done],
    )?;
    db.execute(
        "INSERT INTO assurance_events VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            command.operation_id,
            sid,
            ordinal,
            serde_json::to_string(intent)?,
            encoded,
            now.timestamp_millis()
        ],
    )?;
    Ok(())
}
pub(super) fn project(db: &Connection, sid: &str) -> Result<Value> {
    let (state, ordinal, paused, completed) = load(db, sid)?;
    let view = state.queue.view();
    let mut result = json!({"id":sid,"purpose":"retention_review","ordinal":ordinal,"paused":paused,"completed":completed,"queue":view,"draft":state.draft});
    if let Ok(s) = current(&state) {
        let (key, _, release, _, _) = binding(db, sid, &s)?;
        result["teaching"] = if s["action"]["intent"] == "repair" {
            material::repair_teaching(&release, &key, &s["action"]["repairResourceRef"])
                .map_err(rule)?
        } else {
            material::teaching(&release, &key).map_err(rule)?
        };
        if s["action"]["intent"] != "repair" {
            result["resource"] = resource(db, sid, &state)?;
        }
        if s["candidatePhase"] == "relearning" {
            result["purpose"] = json!("relearning");
        }
    }
    Ok(result)
}
