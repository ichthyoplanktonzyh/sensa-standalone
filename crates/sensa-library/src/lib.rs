//! Single-device application transactions. Learning fact writes go through execute().
//! Replaceable pronunciation byte caches use a separate verified resource API.
//! The acceptance material is opt-in; this is not a production package importer.
pub mod activity;
pub mod anchor;
mod assurance;
mod assurance_retention;
pub mod assurance_runtime;
pub mod composition;
mod consumer_progress;
pub mod curriculum;
pub mod history;
pub mod pack;
pub mod personal;
pub mod policy;
pub mod progress;
pub mod pronunciation;
pub mod provisioning;
pub mod retention;
pub mod semantic;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use sensa_core::settlement::{Settlement, SettlementContext, decide_consumer_settlement};
use sensa_core::{Action, PROTOCOL, Phase, SCHEDULING_POLICY, transition};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid_runtime_composition: {0}")]
    Composition(String),
    #[error("{0}")]
    Rule(&'static str),
    #[error("local_storage_failed")]
    Storage(#[from] rusqlite::Error),
    #[error("invalid_local_data")]
    Json(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub operation_id: String,
    pub library_id: String,
    pub expected_revision: u32,
    pub action: CommandAction,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CommandAction {
    Curriculum {
        action: curriculum::Action,
    },
    Anchor {
        action: Box<anchor::Action>,
    },
    Provisioning {
        action: Box<provisioning::Action>,
    },
    Semantic {
        action: Box<semantic::Action>,
    },
    Personal {
        action: Box<personal::Action>,
    },
    AssuranceEvent {
        session_id: String,
        ordinal: u32,
        intent: assurance_runtime::Intent,
    },
    ActivityFresh {
        mode: activity::Mode,
    },
    ActivityStart {
        mode: activity::Mode,
    },
    ActivityNext {
        activity_id: String,
        early: bool,
    },
    ActivityPause {
        activity_id: String,
    },
    ActivityEnd {
        activity_id: String,
    },
    CheckIn {
        activity_id: Option<String>,
        execution_id: Option<String>,
        entry_operation_id: Option<String>,
    },
    RefreshActivity,
    ConfirmQuantity {
        quantity: u32,
    },
    ImportAcceptanceMaterial,
    ImportRuntimeRelease {
        release_json: String,
    },
    ImportPack {
        pack_json: String,
    },
    SelectMaterial {
        material_id: String,
    },
    SetPolicy {
        scope: sensa_core::planning::AssignmentScope,
        policy: Option<sensa_core::planning::PolicyRef>,
    },
    RefreshPlans,
    AddToLearning,
    StartOrResume,
    NextRetention,
    StartRetention {
        early: bool,
    },
    RecordAction {
        run_id: String,
        ordinal: u32,
        action: Action,
    },
    Pause,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub id: String,
    pub sense_version_id: String,
    pub binding_version_id: String,
    pub scene: String,
    pub sense: String,
    pub expression: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pronunciation: Option<pronunciation::Reference>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    pub id: String,
    pub phase: Phase,
    pub ordinal: u32,
    pub attempt_count: u32,
    pub paused: bool,
    #[serde(default = "initial_protocol")]
    pub protocol_version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub material: Material,
    pub enrolled: bool,
    pub completed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub library_id: String,
    #[serde(default)]
    pub catalog: Vec<CatalogItem>,
    pub revision: u32,
    pub daily_new_limit: Option<u32>,
    pub material: Option<Material>,
    pub enrolled: bool,
    pub run: Option<RunView>,
    pub completion_id: Option<String>,
    pub due_at_ms: Option<i64>,
    pub completion_count: u32,
    pub handoff_count: u32,
    #[serde(default)]
    pub retention: retention::RetentionView,
    #[serde(default)]
    pub policy_state: policy::PolicyView,
    #[serde(default)]
    pub progress: Option<progress::View>,
    #[serde(default)]
    pub structured_material: bool,
    #[serde(default)]
    pub assurance: Option<serde_json::Value>,
    #[serde(default)]
    pub learning: serde_json::Value,
    #[serde(default)]
    pub personal: serde_json::Value,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub curriculum: serde_json::Value,
}

fn initial_protocol() -> String {
    PROTOCOL.into()
}

fn id() -> String {
    Uuid::new_v4().to_string()
}
fn connection(path: &Path) -> Result<Connection> {
    composition::validate().map_err(Error::Composition)?;
    let mut db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(5))?;
    db.pragma_update(None, "foreign_keys", true)?;
    db.pragma_update(None, "synchronous", "FULL")?;
    // This slice uses SQLite's rollback journal: transaction durability does not
    // depend on a JS runtime, an in-memory singleton, or cloud acknowledgement.
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: u32 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
    let application: u32 = tx.pragma_query_value(None, "application_id", |r| r.get(0))?;
    const APPLICATION: u32 = 0x53454e53;
    if version == 0 && application == 0 {
        let count: u32 = tx.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )?;
        if count != 0 {
            return Err(Error::Rule("not_a_sensa_library"));
        }
        tx.execute_batch(include_str!("schema.sql"))?;
        tx.pragma_update(None, "application_id", APPLICATION)?;
        tx.execute(
            "INSERT INTO library VALUES(?1,?2,0,NULL,0)",
            params![id(), id()],
        )?;
    } else if ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].contains(&version)
        || application != APPLICATION
    {
        return Err(Error::Rule("unsupported_library_version"));
    }
    if version <= 1 {
        tx.execute_batch("ALTER TABLE library ADD COLUMN selected_material_id TEXT REFERENCES materials(id);
            UPDATE library SET selected_material_id=(SELECT id FROM materials ORDER BY rowid LIMIT 1);
            CREATE TABLE imported_packs(id TEXT NOT NULL,version TEXT NOT NULL,digest TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(id,version));
            PRAGMA user_version=2;")?;
    }
    if version <= 2 {
        tx.execute_batch(include_str!("retention.sql"))?;
    }
    if version <= 3 {
        tx.execute_batch(include_str!("policy.sql"))?;
        policy::migrate_legacy(&tx)?;
    }
    if version <= 4 {
        tx.execute_batch(include_str!("progress.sql"))?;
        consumer_progress::migrate(&tx)?;
    }
    if version <= 5 {
        tx.execute_batch(include_str!("assurance.sql"))?;
    }
    if version <= 6 {
        tx.execute_batch(include_str!("activity.sql"))?;
    }
    if version <= 7 {
        tx.execute_batch(include_str!("personal.sql"))?;
    }
    if version <= 8 {
        tx.execute_batch(include_str!("semantic.sql"))?;
    }
    if version <= 9 {
        tx.execute_batch(include_str!("provisioning.sql"))?;
    }
    if version <= 10 {
        tx.execute_batch(include_str!("anchor.sql"))?;
    }
    if version <= 11 {
        tx.execute_batch(include_str!("curriculum.sql"))?;
        curriculum::register_packs(&tx)?;
        curriculum::refresh(&tx)?;
    }
    tx.commit()?;
    Ok(db)
}

fn read(db: &Connection) -> Result<Snapshot> {
    let (library_id, revision, daily_new_limit) =
        db.query_row("SELECT id,revision,daily_new_limit FROM library", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
    let mut material: Option<String> = db
        .query_row(
            "SELECT content FROM materials WHERE id=(SELECT selected_material_id FROM library)",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let run = db
        .query_row(
            "SELECT id,phase,ordinal,attempt_count,paused,protocol_version FROM runs WHERE target_id=(SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library))",
            [],
            |r| {
                let raw: String = r.get(1)?;
                let phase = match raw.as_str() {
                    "recall" => Phase::Recall,
                    "reveal" => Phase::Reveal,
                    "completed" => Phase::Completed,
                    _ => return Err(rusqlite::Error::InvalidQuery),
                };
                Ok(RunView {
                    id: r.get(0)?,
                    phase,
                    ordinal: r.get(2)?,
                    attempt_count: r.get(3)?,
                    paused: r.get(4)?,
                    protocol_version: r.get(5)?,
                })
            },
        )
        .optional()?;
    if let Some(r) = &run
        && r.phase != Phase::Completed
    {
        material = Some(db.query_row(
            "SELECT m.content FROM materials m JOIN runs r ON r.material_id=m.id WHERE r.id=?1",
            [&r.id],
            |r| r.get(0),
        )?);
    }
    let catalog = {
        let mut query=db.prepare("SELECT m.content, EXISTS(SELECT 1 FROM targets t WHERE t.material_id=m.id), EXISTS(SELECT 1 FROM runs r JOIN targets t ON t.id=r.target_id WHERE t.material_id=m.id AND r.phase='completed') FROM materials m WHERE json_extract(m.content,'$.source') NOT LIKE 'on-demand:%' OR EXISTS(SELECT 1 FROM targets t WHERE t.material_id=m.id) ORDER BY m.rowid")?;
        let rows = query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, bool>(1)?,
                r.get::<_, bool>(2)?,
            ))
        })?;
        let mut items = Vec::new();
        for row in rows {
            let (content, enrolled, completed) = row?;
            items.push(CatalogItem {
                material: serde_json::from_str(&content)?,
                enrolled,
                completed,
            });
        }
        items
    };
    let mut snapshot = Snapshot {
        library_id,
        catalog,
        revision,
        daily_new_limit,
        material: material.map(|s| serde_json::from_str(&s)).transpose()?,
        enrolled: db.query_row("SELECT count(*)>0 FROM targets WHERE material_id=(SELECT selected_material_id FROM library)", [], |r| r.get(0))?,
        run,
        completion_id: db
            .query_row("SELECT c.id FROM completions c JOIN runs r ON r.id=c.run_id WHERE r.target_id=(SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library))", [], |r| r.get(0))
            .optional()?,
        due_at_ms: db
            .query_row("SELECT mem.due_at_ms FROM memory mem JOIN targets t ON t.id=mem.target_id WHERE t.material_id=(SELECT selected_material_id FROM library)", [], |r| r.get(0))
            .optional()?,
        completion_count: db.query_row("SELECT count(*) FROM completions", [], |r| r.get(0))?,
        handoff_count: db.query_row("SELECT count(*) FROM handoffs", [], |r| r.get(0))?,
        retention: retention::RetentionView::default(),
        policy_state: policy::view(db)?,
        progress: None,
        structured_material: false,
        assurance: None,
        learning: serde_json::Value::Null,
        personal: serde_json::Value::Null,
        curriculum: serde_json::Value::Null,
    };
    if let Some(material) = &snapshot.material {
        snapshot.structured_material = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM assurance_materials WHERE material_id=?1)",
            [&material.id],
            |r| r.get(0),
        )?;
        if snapshot.structured_material {
            assurance::load(db, &material.id)?;
        }
    }
    retention::project(db, &mut snapshot)?;
    snapshot.assurance = assurance_runtime::project(db)?;
    snapshot.progress = snapshot
        .run
        .as_ref()
        .filter(|r| sensa_core::protocol::consumer_purpose(&r.protocol_version).is_ok())
        .map(|r| progress::load(db, &r.id))
        .transpose()?;
    snapshot.learning = activity::project(db)?;
    snapshot.personal = personal::project(db)?;
    snapshot.curriculum = curriculum::project(db)?;
    Ok(snapshot)
}

pub fn open_library(path: &Path) -> Result<Snapshot> {
    let mut db = connection(path)?;
    let tx = db.transaction()?;
    let snapshot = read(&tx)?;
    tx.commit()?;
    Ok(snapshot)
}

pub fn execute(path: &Path, command: Command) -> Result<Snapshot> {
    let now = chrono::Local::now();
    execute_at_offset(
        path,
        command,
        now.with_timezone(&Utc),
        now.offset().local_minus_utc() / 60,
    )
}

/// Explicit time is a testable application dependency, not a UI-supplied result.
/// Runtime bridge calls execute(), which obtains device time itself.
pub fn execute_at(path: &Path, command: Command, now: DateTime<Utc>) -> Result<Snapshot> {
    execute_at_offset(path, command, now, 0)
}

/// Host time-zone offset is a testable dependency; it is never a UI command field.
/// A future stored Study Plan zone can replace this device-local default.
pub fn execute_at_offset(
    path: &Path,
    command: Command,
    now: DateTime<Utc>,
    offset_minutes: i32,
) -> Result<Snapshot> {
    if !(-840..=840).contains(&offset_minutes) {
        return Err(Error::Rule("invalid_time_zone"));
    }
    if Uuid::parse_str(&command.operation_id).is_err() {
        return Err(Error::Rule("invalid_operation_id"));
    }
    let mut db = connection(path)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let state = read(&tx)?;
    if command.library_id != state.library_id {
        return Err(Error::Rule("library_mismatch"));
    }
    let encoded = serde_json::to_string(&command)?;
    let old: Option<(String, String)> = tx
        .query_row(
            "SELECT command,result FROM operations WHERE id=?1",
            [&command.operation_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((payload, result)) = old {
        if payload != encoded {
            return Err(Error::Rule("operation_conflict"));
        }
        return Ok(serde_json::from_str(&result)?);
    }
    if state.revision != command.expected_revision {
        return Err(Error::Rule("revision_conflict"));
    }
    let last: i64 = tx.query_row("SELECT last_time_ms FROM library", [], |r| r.get(0))?;
    if now.timestamp_millis() < last {
        return Err(Error::Rule("clock_moved_backwards"));
    }
    tx.execute(
        "UPDATE activity_clock SET offset_minutes=?1",
        [offset_minutes],
    )?;
    let initial_baseline: i64 =
        tx.query_row("SELECT coalesce(max(rowid),0) FROM completions", [], |r| {
            r.get(0)
        })?;
    let retention_baseline: i64 = tx.query_row(
        "SELECT coalesce(max(rowid),0) FROM retention_completions",
        [],
        |r| r.get(0),
    )?;
    let run_baseline: i64 =
        tx.query_row("SELECT coalesce(max(rowid),0) FROM runs", [], |r| r.get(0))?;
    let introduction_baseline: i64 = tx.query_row(
        "SELECT coalesce(max(rowid),0) FROM initial_introductions",
        [],
        |r| r.get(0),
    )?;
    match &command.action {
        CommandAction::Curriculum { action } => curriculum::apply(&tx, action)?,
        CommandAction::Anchor { action } => anchor::apply(&tx, action, &command, now)?,
        CommandAction::Provisioning { action } => provisioning::apply(&tx, action, &command, now)?,
        CommandAction::Semantic { action } => semantic::apply(&tx, action, &command, now)?,
        CommandAction::Personal { action } => personal::apply(&tx, action, &command, now)?,
        CommandAction::ActivityFresh { mode } => {
            activity::fresh(&tx, *mode, &command, now, offset_minutes)?;
        }
        CommandAction::ActivityStart { mode } => {
            activity::start(&tx, *mode, &command, now, offset_minutes)?
        }
        CommandAction::ActivityNext { activity_id, early } => {
            activity::next(&tx, activity_id, *early, &command, now, offset_minutes)?
        }
        CommandAction::ActivityPause { activity_id } => {
            activity::stop(&tx, activity_id, false, now)?
        }
        CommandAction::ActivityEnd { activity_id } => activity::stop(&tx, activity_id, true, now)?,
        CommandAction::CheckIn {
            activity_id,
            execution_id,
            entry_operation_id,
        } => activity::check_in(
            &tx,
            activity_id.as_deref(),
            execution_id.as_deref(),
            entry_operation_id.as_deref(),
            &command,
            now,
            offset_minutes,
        )?,
        CommandAction::RefreshActivity => {}
        CommandAction::AssuranceEvent {
            session_id,
            ordinal,
            intent,
        } => {
            assurance_runtime::record(&tx, session_id, *ordinal, intent, &command, now)?;
        }
        CommandAction::ConfirmQuantity { quantity } => {
            if ![5, 10, 15, 20, 30].contains(quantity) {
                return Err(Error::Rule("invalid_quantity"));
            }
            tx.execute("UPDATE library SET daily_new_limit=?1", [quantity])?;
        }
        CommandAction::ImportRuntimeRelease { release_json } => {
            assurance::import(&tx, release_json)?;
        }
        CommandAction::ImportPack { pack_json } => {
            let pack = pack::LearningPack::parse(pack_json)?;
            let content = serde_json::to_string(&pack)?;
            let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
            let previous: Option<String> = tx
                .query_row(
                    "SELECT digest FROM imported_packs WHERE id=?1 AND version=?2",
                    params![pack.id, pack.version],
                    |r| r.get(0),
                )
                .optional()?;
            if previous.as_ref().is_some_and(|v| v != &digest) {
                return Err(Error::Rule("pack_version_conflict"));
            }
            for material in &pack.materials {
                let content = serde_json::to_string(material)?;
                let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
                let existing: Option<String> = tx
                    .query_row(
                        "SELECT digest FROM materials WHERE id=?1",
                        [&material.id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if existing.as_ref().is_some_and(|v| v != &digest) {
                    return Err(Error::Rule("material_version_conflict"));
                }
                let collision: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM materials WHERE id<>?1 AND json_extract(content,'$.senseVersionId')=?2 AND json_extract(content,'$.bindingVersionId')=?3)",params![material.id,material.sense_version_id,material.binding_version_id],|r|r.get(0))?;
                if collision {
                    return Err(Error::Rule("target_material_conflict"));
                }
                tx.execute(
                    "INSERT INTO materials VALUES(?1,?2,?3) ON CONFLICT(id) DO NOTHING",
                    params![material.id, digest, content],
                )?;
            }
            tx.execute(
                "INSERT INTO imported_packs VALUES(?1,?2,?3,?4) ON CONFLICT(id,version) DO NOTHING",
                params![pack.id, pack.version, digest, content],
            )?;
            tx.execute(
                "UPDATE library SET selected_material_id=COALESCE(selected_material_id,?1)",
                [&pack.materials[0].id],
            )?;
            policy::register_pack(&tx, &pack)?;
            curriculum::register_packs(&tx)?;
            policy::refresh(&tx)?;
        }
        CommandAction::SelectMaterial { material_id } => {
            activity::leave(&tx)?;
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM materials WHERE id=?1)",
                [material_id],
                |r| r.get(0),
            )?;
            if !exists {
                return Err(Error::Rule("material_unavailable"));
            }
            let historical:bool=tx.query_row("SELECT json_extract(content,'$.source') LIKE 'on-demand:%' AND NOT EXISTS(SELECT 1 FROM targets t WHERE t.material_id=materials.id) FROM materials WHERE id=?1",[material_id],|r|r.get(0))?;
            if historical {
                return Err(Error::Rule("historical_material_only"));
            }
            tx.execute(
                "UPDATE assurance_sessions SET paused=1 WHERE completed=0",
                [],
            )?;
            tx.execute("UPDATE runs SET paused=1 WHERE phase<>'completed'", [])?;
            tx.execute(
                "UPDATE retention_runs SET paused=1 WHERE phase<>'completed'",
                [],
            )?;
            tx.execute("UPDATE library SET selected_material_id=?1", [material_id])?;
        }
        CommandAction::ImportAcceptanceMaterial => {
            let material = acceptance_material()?;
            let content = serde_json::to_string(&material)?;
            let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
            tx.execute(
                "INSERT INTO materials VALUES(?1,?2,?3) ON CONFLICT(id) DO NOTHING",
                params![material.id, digest, content],
            )?;
            tx.execute(
                "UPDATE library SET selected_material_id=COALESCE(selected_material_id,?1)",
                [&material.id],
            )?;
        }
        CommandAction::SetPolicy { scope, policy } => {
            policy::set(&tx, scope, policy.as_ref(), now.timestamp_millis())?;
        }
        CommandAction::RefreshPlans => {
            policy::refresh(&tx)?;
        }
        CommandAction::AddToLearning => {
            let material = state
                .material
                .as_ref()
                .ok_or(Error::Rule("material_unavailable"))?;
            if state.daily_new_limit.is_none() {
                return Err(Error::Rule("quantity_required"));
            }
            tx.execute("INSERT INTO targets VALUES(?1,?2,?3,?4,'lightweight','v1') ON CONFLICT(sense_version_id,binding_version_id) DO NOTHING",
                params![id(),material.id,material.sense_version_id,material.binding_version_id])?;
            let target: String = tx.query_row(
                "SELECT id FROM targets WHERE material_id=?1",
                [&material.id],
                |r| r.get(0),
            )?;
            policy::enroll(&tx, &target)?;
            curriculum::supplement(&tx, &target)?;
        }
        CommandAction::NextRetention => {
            activity::leave(&tx)?;
            retention::next(&tx, now)?;
        }
        CommandAction::StartRetention { early } => {
            activity::leave(&tx)?;
            retention::start(&tx, &state, now, *early)?;
        }
        CommandAction::StartOrResume => {
            activity::leave(&tx)?;
            start_selected(&tx, &state, now, offset_minutes)?;
        }
        CommandAction::Pause => {
            let run = state.run.as_ref().ok_or(Error::Rule("no_active_run"))?;
            if run.phase == Phase::Completed {
                return Err(Error::Rule("no_active_run"));
            }
            if run.protocol_version == PROTOCOL {
                tx.execute("UPDATE runs SET paused=1 WHERE id=?1", [&run.id])?;
            } else {
                tx.execute("UPDATE retention_runs SET paused=1 WHERE id=?1", [&run.id])?;
            }
        }
        CommandAction::RecordAction {
            run_id,
            ordinal,
            action,
        } => {
            activity::guard_execution(&tx, run_id)?;
            let run = state.run.as_ref().ok_or(Error::Rule("no_active_run"))?;
            if run.id != *run_id || run.ordinal != *ordinal || run.paused {
                return Err(Error::Rule("stale_step"));
            }
            if run.protocol_version != PROTOCOL {
                let initial: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM runs WHERE id=?1)",
                    [run_id],
                    |r| r.get(0),
                )?;
                if initial {
                    return Err(Error::Rule("unsupported_protocol"));
                }
                retention::record(&tx, run, &command, *action, now)?;
            } else {
                let (target,protocol,content,expected_digest): (String,String,String,String) = tx.query_row("SELECT r.target_id,r.protocol_version,m.content,r.material_digest FROM runs r JOIN materials m ON m.id=r.material_id WHERE r.id=?1", [run_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
                if format!("{:x}", Sha256::digest(content.as_bytes())) != expected_digest {
                    return Err(Error::Rule("material_mismatch"));
                }
                // Historical initial runs cannot be relabeled to gain review authority.
                // Retention has its own due trigger and purpose-pinned snapshot.
                if protocol != PROTOCOL {
                    return Err(Error::Rule("unsupported_protocol"));
                }
                policy::validate_run(&tx, run_id, &protocol, false)?;
                if *action == Action::Reveal {
                    activity::introduce(&tx, &target, run_id, now)?;
                }
                let next = transition(&protocol, run.phase, *action).map_err(Error::Rule)?;
                let phase = serde_json::to_value(next)?
                    .as_str()
                    .ok_or(Error::Rule("invalid_phase"))?
                    .to_owned();
                let attempt_id = id();
                tx.execute(
                    "INSERT INTO attempts VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        attempt_id,
                        command.operation_id,
                        run_id,
                        ordinal,
                        serde_json::to_string(action)?,
                        phase,
                        now.timestamp_millis()
                    ],
                )?;
                tx.execute("UPDATE runs SET phase=?2,ordinal=ordinal+?3,attempt_count=attempt_count+1 WHERE id=?1", params![run_id,phase,if next == Phase::Completed {0} else {1}])?;
                consumer_progress::record(
                    &tx,
                    run_id,
                    &attempt_id,
                    *ordinal,
                    next,
                    now.timestamp_millis(),
                    false,
                )?;
                if next == Phase::Completed {
                    let completion = id();
                    let handoff = id();
                    let Settlement::StudyCompletion { schedule, .. } = decide_consumer_settlement(
                        &target,
                        &protocol,
                        *action,
                        now,
                        &SettlementContext::InitialLearning,
                    )
                    .map_err(Error::Rule)?
                    else {
                        return Err(Error::Rule("invalid_settlement"));
                    };
                    let serialized = serde_json::to_string(&schedule)?;
                    tx.execute(
                    "INSERT INTO completions VALUES(?1,?2,'study_completion','non_evidentiary',?3)",
                    params![completion, run_id, now.timestamp_millis()],
                )?;
                    tx.execute(
                        "INSERT INTO handoffs VALUES(?1,?2,?3,'protocol_completion',?4,?5)",
                        params![handoff, target, completion, SCHEDULING_POLICY, serialized],
                    )?;
                    tx.execute(
                        "INSERT INTO memory VALUES(?1,?2,1,?3,?4)",
                        params![
                            target,
                            handoff,
                            schedule.due_at.timestamp_millis(),
                            serialized
                        ],
                    )?;
                }
            }
        }
    }
    curriculum::capture_started(&tx, run_baseline, introduction_baseline)?;
    curriculum::refresh(&tx)?;
    activity::capture_results(&tx, initial_baseline, retention_baseline)?;
    tx.execute(
        "UPDATE activity_clock SET offset_minutes=?1",
        [offset_minutes],
    )?;
    tx.execute(
        "UPDATE library SET revision=revision+1,last_time_ms=?1",
        [now.timestamp_millis()],
    )?;
    let result = read(&tx)?;
    tx.execute(
        "INSERT INTO operations VALUES(?1,?2,?3)",
        params![
            command.operation_id,
            encoded,
            serde_json::to_string(&result)?
        ],
    )?;
    tx.commit()?;
    Ok(result)
}

#[cfg(feature = "acceptance-fixture")]
fn acceptance_material() -> Result<Material> {
    Ok(Material {
        pronunciation: None,
        id: "native-acceptance-material-v1".into(),
        sense_version_id: "native-acceptance-tactful-sense-v1".into(),
        binding_version_id: "native-acceptance-tactful-binding-v1".into(),
        scene: "同事的方案有问题，你既要说明事实，也想照顾他的感受。".into(),
        sense: "表达真实意见时照顾对方感受，避免让对方难堪。".into(),
        expression: "tactful".into(),
        source: "合成验收材料 · 非正式学习包".into(),
    })
}
#[cfg(not(feature = "acceptance-fixture"))]
fn acceptance_material() -> Result<Material> {
    Err(Error::Rule("acceptance_fixture_disabled"))
}
/// Reads only packaged media belonging to the currently projected encounter.
/// No network, arbitrary media path or filesystem write is involved.
pub fn read_assurance_media(path: &Path, session_id: &str, reference: &str) -> Result<Vec<u8>> {
    let db = connection(path)?;
    let tx = db.unchecked_transaction()?;
    let snapshot = read(&tx)?;
    let view = snapshot.assurance.ok_or(Error::Rule("no_active_run"))?;
    if view["id"] != session_id {
        return Err(Error::Rule("stale_step"));
    }
    let target = view["queue"]["session"]["action"]["retentionTargetId"]
        .as_str()
        .ok_or(Error::Rule("no_active_step"))?;
    let mid: String = tx.query_row(
        "SELECT material_id FROM assurance_session_targets WHERE session_id=?1 AND target_id=?2",
        params![session_id, target],
        |r| r.get(0),
    )?;
    let (release, _, _) = assurance::load(&tx, &mid)?;
    let digest_ref = reference
        .strip_prefix("/golden-audio/")
        .and_then(|s| s.strip_suffix(".mp3"))
        .map(|s| format!("sha256:{s}"));
    let m = release["media"]
        .as_array()
        .and_then(|ms| {
            ms.iter().find(|m| {
                m["mediaKey"] == reference || digest_ref.as_ref().is_some_and(|d| m["sha256"] == *d)
            })
        })
        .ok_or(Error::Rule("media_unavailable"))?;
    let digest = m["sha256"]
        .as_str()
        .ok_or(Error::Rule("media_unavailable"))?;
    let bytes: Vec<u8> = tx.query_row(
        "SELECT bytes FROM runtime_media WHERE digest=?1",
        [digest],
        |r| r.get(0),
    )?;
    if format!("sha256:{:x}", Sha256::digest(&bytes)) != digest {
        return Err(Error::Rule("material_mismatch"));
    }
    tx.commit()?;
    Ok(bytes)
}

fn start_selected(
    tx: &rusqlite::Transaction<'_>,
    state: &Snapshot,
    now: DateTime<Utc>,
    offset_minutes: i32,
) -> Result<()> {
    if assurance_runtime::is_selected(tx)? {
        assurance_runtime::start(tx, now, offset_minutes)?;
    } else {
        if let Some(material) = &state.material {
            let digest: String = tx.query_row(
                "SELECT digest FROM materials WHERE id=?1",
                [&material.id],
                |r| r.get(0),
            )?;
            if format!(
                "{:x}",
                Sha256::digest(serde_json::to_string(material)?.as_bytes())
            ) != digest
            {
                return Err(Error::Rule("material_mismatch"));
            }
        }
        if !state.enrolled {
            return Err(Error::Rule("no_targets"));
        }
        if state.daily_new_limit.is_none() {
            return Err(Error::Rule("quantity_required"));
        }
        let target: String = tx.query_row(
            "SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library)",
            [],
            |r| r.get(0),
        )?;
        if !activity::allows(tx, &target, true)? {
            return Err(Error::Rule("target_outside_study_scope"));
        }
        if let Some(run) = &state.run {
            if run.phase == Phase::Completed || run.protocol_version != PROTOCOL {
                retention::start(tx, state, now, false)?;
            } else {
                tx.execute("UPDATE runs SET paused=0 WHERE id=?1", [&run.id])?;
            }
        } else {
            let count = activity::quota(tx, now, offset_minutes, true)?;
            if count >= state.daily_new_limit.unwrap_or(0) {
                return Err(Error::Rule("daily_limit"));
            }
            let (target,material,digest): (String,String,String) = tx.query_row("SELECT t.id,m.id,m.digest FROM targets t JOIN materials m ON m.id=t.material_id WHERE m.id=(SELECT selected_material_id FROM library)", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
            if !provisioning::material_current(tx, &target)? {
                return Err(Error::Rule("learning_material_preparing"));
            }
            let run_id = id();
            policy::commit_initial(tx, &target, &run_id, now.timestamp_millis())?;
            tx.execute(
                "INSERT INTO runs VALUES(?1,?2,?3,?4,?5,'recall',1,0,0,?6)",
                params![
                    run_id,
                    target,
                    material,
                    digest,
                    PROTOCOL,
                    now.timestamp_millis()
                ],
            )?;
            consumer_progress::start(tx, &run_id, false)?;
        }
    }

    Ok(())
}
