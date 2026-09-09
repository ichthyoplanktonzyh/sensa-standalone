//! Persisted structured encounters. UI submits learner intent, never gate credit.
use super::*;
use rusqlite::Transaction;
use sensa_core::{
    assurance as model, assurance_material as material, assurance_queue as acquisition,
};
use serde_json::{Value, json};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Intent {
    Experience {
        value: f64,
        text_scene: bool,
    },
    Draft {
        text: String,
        option_id: Option<String>,
    },
    Reveal,
    Support {
        mode: material::Support,
    },
    Submit,
    Continue,
    Undo,
    Mistake,
    Mastery,
    ReturnTarget {
        target_id: String,
    },
    Pause,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Draft {
    pub(super) text: String,
    pub(super) option_id: Option<String>,
    pub(super) support: material::Support,
    pub(super) revealed: bool,
    pub(super) evaluation: Option<material::Evaluation>,
    #[serde(default)]
    pub(super) experience_value: f64,
    #[serde(default)]
    pub(super) text_scene: bool,
}
impl Default for Draft {
    fn default() -> Self {
        Self {
            text: String::new(),
            option_id: None,
            support: material::Support::Independent,
            revealed: false,
            evaluation: None,
            experience_value: 0.0,
            text_scene: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    version: u32,
    queue: acquisition::Queue,
    draft: Draft,
    help: BTreeMap<String, material::Support>,
}
use std::collections::BTreeMap;
fn rule(_: String) -> Error {
    Error::Rule("invalid_assurance_transition")
}
fn selected(db: &Connection) -> Result<String> {
    Ok(db.query_row(
        "SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library)",
        [],
        |r| r.get(0),
    )?)
}
fn target_package(
    db: &Connection,
    target: &str,
    run: &str,
) -> Result<(acquisition::Package, String, String)> {
    let material_id: String = db.query_row(
        "SELECT material_id FROM targets WHERE id=?1",
        [target],
        |r| r.get(0),
    )?;
    if !assurance::ready(db, &material_id)? {
        return Err(Error::Rule("learning_plan_blocked"));
    }
    let (release, key, digest) = assurance::load(db, &material_id)?;
    let p = release["packages"]
        .as_array()
        .and_then(|ps| ps.iter().find(|p| p["identity"]["packageKey"] == key))
        .ok_or(Error::Rule("material_mismatch"))?;
    Ok((
        acquisition::Package {
            package_id: key,
            sense_id: p["identity"]["senseKey"]
                .as_str()
                .ok_or(Error::Rule("material_mismatch"))?
                .into(),
            retention_target_id: target.into(),
            run_id: run.into(),
            inventory: material::inventory(p).map_err(rule)?,
        },
        material_id,
        digest,
    ))
}
pub(super) fn is_selected(db: &Connection) -> Result<bool> {
    let target = selected(db)?;
    let plan = policy::refresh_target(db, &target)?;
    Ok(plan
        .plan
        .purposes
        .initial_learning
        .binding
        .binding
        .runtime_adapter_id
        == "structured")
}
pub(super) fn start(db: &Transaction<'_>, now: DateTime<Utc>, offset_minutes: i32) -> Result<()> {
    let target = selected(db)?;
    if !activity::allows(db, &target, true)? {
        return Err(Error::Rule("activity_scope_mismatch"));
    }
    let active: Option<String> = db
        .query_row(
            "SELECT id FROM assurance_sessions WHERE completed=0 AND purpose='initial_learning'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(session) = active {
        let member:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2)",params![session,target],|r|r.get(0))?;
        if !member {
            return Err(Error::Rule("assurance_session_active"));
        }
        db.execute(
            "UPDATE assurance_sessions SET paused=0 WHERE id=?1",
            [session],
        )?;
        return Ok(());
    }
    let already: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM runs WHERE target_id=?1)",
        [&target],
        |r| r.get(0),
    )?;
    if already {
        let scheduled: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM memory WHERE target_id=?1)",
            [&target],
            |r| r.get(0),
        )?;
        if !scheduled {
            let session: String = db.query_row("SELECT session_id FROM assurance_session_targets WHERE target_id=?1 ORDER BY rowid DESC LIMIT 1", [&target], |r| r.get(0))?;
            load(db, &session)?;
            // Re-open the completed cohort summary so a declaration can be cleared.
            return Ok(());
        }
        return assurance_retention::start(db, now);
    }
    let mut targets = activity::initial_cohort(db, &target, now, offset_minutes)?;
    let sid = id();
    let mut packages = vec![];
    let mut links = vec![];
    let mut strategies = BTreeMap::new();
    for target in &targets {
        let run = id();
        let (package, mid, digest) = target_package(db, target, &run)?;
        let plan = policy::commit_assurance(db, target, &run, now.timestamp_millis())?;
        strategies.insert(
            target.clone(),
            plan.plan
                .purposes
                .initial_learning
                .binding
                .binding
                .progression_policy_id
                .clone(),
        );
        let base_digest: String =
            db.query_row("SELECT digest FROM materials WHERE id=?1", [&mid], |r| {
                r.get(0)
            })?;
        db.execute(
            "INSERT INTO runs VALUES(?1,?2,?3,?4,'structured-acquisition-v1','recall',1,0,0,?5)",
            params![run, target, mid, base_digest, now.timestamp_millis()],
        )?;
        links.push((target.clone(), run, mid, digest, plan.id));
        packages.push(package);
    }
    // Target IDs are generated ASCII UUIDs; lexicographic ordering is identical to
    // the source locale collation for this admitted native identity alphabet.
    targets.sort();
    let queue = acquisition::Queue::new(packages, 2, None, now.timestamp_millis(), targets)
        .map_err(rule)?
        .with_progression_policies(strategies)
        .map_err(rule)?;
    let state = State {
        version: 1,
        queue,
        draft: Draft::default(),
        help: BTreeMap::new(),
    };
    db.execute(
        "INSERT INTO assurance_sessions VALUES(?1,'initial_learning',?2,1,0,0,?3)",
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
    let (encoded, ordinal, paused, completed): (String, u32, bool, bool) = db.query_row(
        "SELECT state,ordinal,paused,completed FROM assurance_sessions WHERE id=?1",
        [sid],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    verify_journal(db, sid, &encoded, ordinal)?;
    let mut state: State = serde_json::from_str(&encoded)?;
    if state.version != 1 {
        return Err(Error::Rule("unsupported_assurance_version"));
    }
    state.queue =
        acquisition::Queue::restore(&serde_json::to_string(&state.queue)?).map_err(rule)?;
    Ok((state, ordinal, paused, completed))
}
fn current(state: &State) -> Result<Value> {
    let view = state.queue.view();
    let s = &view["session"];
    if s.is_null() {
        return Err(Error::Rule("no_active_step"));
    }
    Ok(s.clone())
}
fn binding(db: &Connection, sid: &str, s: &Value) -> Result<(String, String, Value, String)> {
    let target = s["action"]["retentionTargetId"]
        .as_str()
        .ok_or(Error::Rule("invalid_assurance_transition"))?;
    let (mid,expected,run):(String,String,String)=db.query_row("SELECT material_id,material_digest,run_id FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2",params![sid,target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    let (release, key, digest) = assurance::load(db, &mid)?;
    if digest != expected {
        return Err(Error::Rule("material_mismatch"));
    }
    Ok((key, digest, release, run))
}
fn resource(db: &Connection, sid: &str, state: &State) -> Result<Value> {
    let s = current(state)?;
    let (key, _, release, _) = binding(db, sid, &s)?;
    let capability: model::Capability = serde_json::from_value(s["action"]["capability"].clone())?;
    material::resolve(
        &release,
        &key,
        s["action"]["senseId"]
            .as_str()
            .ok_or(Error::Rule("material_mismatch"))?,
        s["action"]["taskKey"]
            .as_str()
            .ok_or(Error::Rule("material_mismatch"))?,
        capability,
    )
    .map_err(rule)
}
fn step_key(s: &Value) -> String {
    format!("{}:{}", s["action"]["retentionTargetId"], s["index"])
}
fn evaluated(
    db: &Transaction<'_>,
    sid: &str,
    state: &mut State,
    command: &Command,
    event: acquisition::Event,
    now: DateTime<Utc>,
) -> Result<()> {
    let s = current(state)?;
    let attempt = format!("{}:assessment", command.operation_id);
    let (key, digest, _, run) = binding(db, sid, &s)?;
    let _ = key;
    if s["action"]["intent"] == "assessment"
        && let Some(e) = &state.draft.evaluation
    {
        let correct = matches!(e.outcome.as_deref(), Some("independent" | "success"));
        let independent = state.draft.support == material::Support::Independent;
        db.execute(
            "INSERT INTO assurance_evidence VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                format!("{attempt}:evidence"),
                command.operation_id,
                sid,
                s["action"]["retentionTargetId"].as_str(),
                run,
                digest,
                s["action"]["actionKey"].as_str(),
                s["action"]["taskKey"].as_str(),
                s["action"]["capability"].as_str(),
                serde_json::to_string(e)?,
                serde_json::to_string(&state.draft.support)?,
                correct,
                independent,
                now.timestamp_millis()
            ],
        )?;
    }
    state
        .queue
        .execute(acquisition::Event::Evaluated {
            event: Box::new(event),
            attempt_id: attempt,
        })
        .map_err(rule)
}
pub(super) fn record(
    db: &Transaction<'_>,
    sid: &str,
    ordinal: u32,
    intent: &Intent,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<()> {
    activity::guard_execution(db, sid)?;
    let purpose: String = db.query_row(
        "SELECT purpose FROM assurance_sessions WHERE id=?1",
        [sid],
        |r| r.get(0),
    )?;
    if purpose != "initial_learning" {
        return assurance_retention::record(db, sid, ordinal, intent, command, now);
    }
    let (mut state, expected, paused, completed) = load(db, sid)?;
    if expected != ordinal
        || ((paused || completed) && !matches!(intent, Intent::ReturnTarget { .. }))
    {
        return Err(Error::Rule("stale_step"));
    }
    let session = if matches!(intent, Intent::ReturnTarget { .. }) {
        json!({})
    } else {
        current(&state)?
    };
    let action = &session["action"];
    let teaching = action["intent"] == "instruction" || action["intent"] == "repair";
    match intent {
        Intent::ReturnTarget { target_id } => {
            let view = state.queue.view();
            if !view["states"].as_array().is_some_and(|states| {
                states
                    .iter()
                    .any(|s| s["retentionTargetId"] == *target_id && s["declaredMastery"] == true)
            }) {
                return Err(Error::Rule("no_declared_mastery"));
            }
            let other: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM assurance_sessions WHERE completed=0 AND purpose='initial_learning' AND id<>?1)",
                [sid],
                |r| r.get(0),
            )?;
            if other {
                return Err(Error::Rule("assurance_session_active"));
            }
            state
                .queue
                .execute(acquisition::Event::Mastery {
                    target: target_id.clone(),
                    mastered: false,
                })
                .map_err(rule)?;
            if state.queue.view()["session"].is_null() {
                state
                    .queue
                    .execute(acquisition::Event::Next)
                    .map_err(rule)?;
            }
            state.draft = Draft::default();
            db.execute(
                "UPDATE assurance_sessions SET completed=0,paused=0 WHERE id=?1",
                [sid],
            )?;
        }
        Intent::Experience { value, text_scene } => {
            if !value.is_finite() || !teaching {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            state.draft.experience_value = *value;
            state.draft.text_scene = *text_scene;
        }
        Intent::Draft { text, option_id } => {
            if text.len() > 8000 || option_id.as_ref().is_some_and(|s| s.len() > 500) {
                return Err(Error::Rule("answer_too_large"));
            }
            if state.draft.evaluation.is_some() {
                return Err(Error::Rule("already_answered"));
            }
            state.draft.text = text.clone();
            state.draft.option_id = option_id.clone();
        }
        Intent::Reveal => {
            if !teaching {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            state.draft.revealed = true;
        }
        Intent::Support { mode } => {
            if action["capability"] != "meaning_to_form_recall"
                || teaching
                || state.draft.evaluation.is_some()
            {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            let rank = |m: material::Support| match m {
                material::Support::Independent => 0,
                material::Support::FirstLetter => 1,
                material::Support::Choice => 2,
            };
            if rank(*mode) < rank(state.draft.support) {
                return Err(Error::Rule("support_cannot_be_reset"));
            }
            state.draft.support = *mode;
            state.help.insert(step_key(&session), *mode);
        }
        Intent::Submit => {
            if teaching || state.draft.evaluation.is_some() {
                return Err(Error::Rule("invalid_assurance_transition"));
            }
            let r = resource(db, sid, &state)?;
            let e = material::evaluate(
                &r,
                state.draft.support,
                false,
                &material::Answer {
                    text: Some(state.draft.text.clone()),
                    option_id: state.draft.option_id.clone(),
                },
            )
            .map_err(rule)?;
            state.draft.support = e.next_support;
            state.help.insert(step_key(&session), e.next_support);
            if e.outcome.is_some() {
                state.draft.evaluation = Some(e);
            } else {
                state.draft.text.clear();
            }
        }
        Intent::Continue => {
            let event = if teaching {
                if !state.draft.revealed {
                    return Err(Error::Rule("reveal_required"));
                }
                if action["intent"] == "instruction" {
                    let target = action["retentionTargetId"]
                        .as_str()
                        .ok_or(Error::Rule("no_active_run"))?;
                    let run: String=db.query_row("SELECT run_id FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2",params![sid,target],|r|r.get(0))?;
                    activity::introduce(db, target, &run, now)?;
                    acquisition::Event::Introduction
                } else {
                    acquisition::Event::Settle { correct: true }
                }
            } else {
                let e = state
                    .draft
                    .evaluation
                    .as_ref()
                    .ok_or(Error::Rule("answer_required"))?;
                let correct = matches!(e.outcome.as_deref(), Some("independent" | "success"));
                match action["capability"].as_str() {
                    Some("contextual_recognition") => acquisition::Event::Recognition { correct },
                    Some("meaning_to_form_recall") => acquisition::Event::Recall {
                        outcome: serde_json::from_value(json!(e.outcome))?,
                    },
                    Some("novel_context_transfer") => acquisition::Event::Transfer {
                        outcome: if correct {
                            acquisition::Transfer::Success
                        } else {
                            acquisition::Transfer::Repair
                        },
                    },
                    Some("boundary_discrimination") => acquisition::Event::Boundary { correct },
                    _ => return Err(Error::Rule("invalid_assurance_transition")),
                }
            };
            evaluated(db, sid, &mut state, command, event, now)?;
            state
                .queue
                .execute(acquisition::Event::Next)
                .map_err(rule)?;
            state.draft = Draft::default();
            if state.queue.is_done() {
                complete_initial(db, sid, &state, now)?;
                db.execute(
                    "UPDATE assurance_sessions SET completed=1 WHERE id=?1",
                    [sid],
                )?;
            }
        }
        Intent::Undo => {
            let before = state.queue.view();
            state
                .queue
                .execute(acquisition::Event::Undo)
                .map_err(rule)?;
            let after = state.queue.view();
            for target in before["states"]
                .as_array()
                .ok_or(Error::Rule("invalid_assurance_transition"))?
            {
                let committed: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM completions c JOIN runs r ON r.id=c.run_id WHERE r.target_id=?1)", [target["retentionTargetId"].as_str()], |r| r.get(0))?;
                if committed
                    && after["states"]
                        .as_array()
                        .and_then(|states| {
                            states
                                .iter()
                                .find(|s| s["retentionTargetId"] == target["retentionTargetId"])
                        })
                        .is_none_or(|s| s["protocolProgress"] != target["protocolProgress"])
                {
                    return Err(Error::Rule("undo_across_settlement"));
                }
            }
            if state.queue.is_done() {
                db.execute(
                    "UPDATE assurance_sessions SET completed=1 WHERE id=?1",
                    [sid],
                )?;
            }
            state.draft = Draft::default();
            if let Ok(s) = current(&state) {
                state.draft.support = state
                    .help
                    .get(&step_key(&s))
                    .copied()
                    .unwrap_or(material::Support::Independent);
            }
        }
        Intent::Mistake => {
            if action["intent"] == "assessment" {
                state.draft.evaluation = Some(material::Evaluation {
                    outcome: Some("miss".into()),
                    next_support: state.draft.support,
                    response_id: "learner_correction".into(),
                });
            }
            evaluated(
                db,
                sid,
                &mut state,
                command,
                acquisition::Event::Mistake,
                now,
            )?;
            state
                .queue
                .execute(acquisition::Event::Next)
                .map_err(rule)?;
            state.draft = Draft::default();
        }
        Intent::Mastery => {
            state
                .queue
                .execute(acquisition::Event::Skip)
                .map_err(rule)?;
            state
                .queue
                .execute(acquisition::Event::Next)
                .map_err(rule)?;
            state.draft = Draft::default();
            if state.queue.is_done() {
                complete_initial(db, sid, &state, now)?;
                db.execute(
                    "UPDATE assurance_sessions SET completed=1 WHERE id=?1",
                    [sid],
                )?;
            }
        }
        Intent::Pause => {
            db.execute("UPDATE assurance_sessions SET paused=1 WHERE id=?1", [sid])?;
        }
    }
    let encoded = serde_json::to_string(&state)?;
    db.execute(
        "UPDATE assurance_sessions SET state=?2,ordinal=ordinal+1 WHERE id=?1",
        params![sid, encoded],
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
fn complete_initial(
    db: &Transaction<'_>,
    sid: &str,
    state: &State,
    now: DateTime<Utc>,
) -> Result<()> {
    let view = state.queue.view();
    for target in view["graduated"]
        .as_array()
        .ok_or(Error::Rule("invalid_assurance_transition"))?
    {
        let target = target
            .as_str()
            .ok_or(Error::Rule("invalid_assurance_transition"))?;
        let run: String = db.query_row(
            "SELECT run_id FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2",
            params![sid, target],
            |r| r.get(0),
        )?;
        let target_state = view["states"]
            .as_array()
            .and_then(|states| states.iter().find(|s| s["retentionTargetId"] == target))
            .ok_or(Error::Rule("invalid_assurance_transition"))?;
        for credit in target_state["protocolProgress"]["checkpointCredits"]
            .as_object()
            .ok_or(Error::Rule("invalid_assurance_transition"))?
            .values()
        {
            if credit["status"] != "credited" {
                continue;
            }
            let observation = credit["lastObservationId"]
                .as_str()
                .ok_or(Error::Rule("graduation_evidence_missing"))?;
            let evidence = observation
                .strip_suffix(":observation")
                .map(|id| format!("{id}:evidence"))
                .ok_or(Error::Rule("graduation_evidence_missing"))?;
            let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM assurance_evidence WHERE id=?1 AND target_id=?2 AND run_id=?3 AND correct=1 AND independent=1)",params![evidence,target,run],|r|r.get(0))?;
            if !valid {
                return Err(Error::Rule("graduation_evidence_missing"));
            }
        }
        let existing: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM completions WHERE run_id=?1)",
            [&run],
            |r| r.get(0),
        )?;
        if existing {
            continue;
        }
        let schedule = sensa_core::scheduling::compute_review_schedule(
            &sensa_core::scheduling::ScheduleState::empty(target.into()),
            &sensa_core::scheduling::SchedulerConfig::default(),
            2,
            now,
        )
        .map_err(Error::Rule)?;
        let completion = id();
        let handoff = id();
        let encoded = serde_json::to_string(&schedule)?;
        db.execute(
            "INSERT INTO completions VALUES(?1,?2,'acquisition_graduation','behavioral',?3)",
            params![completion, run, now.timestamp_millis()],
        )?;
        db.execute(
            "INSERT INTO handoffs VALUES(?1,?2,?3,'acquisition_graduation','fsrs-retention-v1',?4)",
            params![handoff, target, completion, encoded],
        )?;
        db.execute(
            "INSERT INTO memory VALUES(?1,?2,1,?3,?4)",
            params![target, handoff, schedule.due_at.timestamp_millis(), encoded],
        )?;
        db.execute("UPDATE runs SET phase='completed' WHERE id=?1", [run])?;
    }
    Ok(())
}
pub(super) fn project(db: &Connection) -> Result<Option<Value>> {
    let row:Option<(String,String)>=db.query_row("SELECT s.id,s.purpose FROM assurance_sessions s JOIN assurance_session_targets t ON t.session_id=s.id JOIN targets target ON target.id=t.target_id WHERE target.material_id=(SELECT selected_material_id FROM library) ORDER BY s.rowid DESC LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let Some((sid, purpose)) = row else {
        return Ok(None);
    };
    if purpose != "initial_learning" {
        return Ok(Some(assurance_retention::project(db, &sid)?));
    }
    let (state, ordinal, paused, completed) = load(db, &sid)?;
    let view = state.queue.view();
    let mut result = json!({"id":sid,"purpose":purpose,"ordinal":ordinal,"paused":paused,"completed":completed,"queue":view,"draft":state.draft});
    if let Ok(s) = current(&state) {
        let (key, _, release, _) = binding(db, &sid, &s)?;
        result["teaching"] = if s["action"]["intent"] == "repair" {
            material::repair_teaching(&release, &key, &s["action"]["repairResourceRef"])
                .map_err(rule)?
        } else {
            material::teaching(&release, &key).map_err(rule)?
        };
        if s["action"]["intent"] == "assessment" {
            let mut r = resource(db, &sid, &state)?;
            if state.draft.evaluation.is_none() {
                // Only the local evaluator reads answer keys before settlement.
                if let Some(o) = r.as_object_mut() {
                    o.remove("acceptedForms");
                }
                for key in ["options", "choiceOptions"] {
                    if let Some(opts) = r[key].as_array_mut() {
                        for o in opts {
                            if let Some(o) = o.as_object_mut() {
                                o.remove("isCorrect");
                                o.remove("isTarget");
                                o.remove("feedbackTitleL1");
                                o.remove("feedbackBodyL1");
                            }
                        }
                    }
                }
                if let Some(opts) = r
                    .get_mut("scenario")
                    .and_then(|s| s.get_mut("options"))
                    .and_then(Value::as_array_mut)
                {
                    for o in opts {
                        if let Some(o) = o.as_object_mut() {
                            o.remove("isCorrect");
                            o.remove("feedbackTitleL1");
                            o.remove("feedbackBodyL1");
                        }
                    }
                }
            }
            result["resource"] = r;
        }
    }
    Ok(Some(result))
}

/// A resumed draft must be exactly the result of the last committed intent.
/// Queue restoration additionally verifies its internal semantic event replay.
pub(super) fn verify_journal(
    db: &Connection,
    sid: &str,
    encoded: &str,
    ordinal: u32,
) -> Result<()> {
    let count: u32 = db.query_row(
        "SELECT count(*) FROM assurance_events WHERE session_id=?1",
        [sid],
        |r| r.get(0),
    )?;
    if ordinal != count + 1 {
        return Err(Error::Rule("assurance_journal_mismatch"));
    }
    if count > 0 {
        let last: String = db.query_row(
            "SELECT resulting_state FROM assurance_events WHERE session_id=?1 AND ordinal=?2",
            params![sid, count],
            |r| r.get(0),
        )?;
        if last != encoded {
            return Err(Error::Rule("assurance_journal_mismatch"));
        }
    }
    Ok(())
}
