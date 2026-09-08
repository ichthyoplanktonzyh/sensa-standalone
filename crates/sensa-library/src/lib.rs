//! Single-device application transactions. All writes go through execute().
//! The acceptance material is opt-in; this is not a production package importer.
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use sensa_core::{Action, PROTOCOL, Phase, SCHEDULING_POLICY, initial_schedule, transition};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    time::{Duration, SystemTime},
};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
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
    ConfirmQuantity {
        quantity: u32,
    },
    ImportAcceptanceMaterial,
    AddToLearning,
    StartOrResume,
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
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    pub id: String,
    pub phase: Phase,
    pub ordinal: u32,
    pub attempt_count: u32,
    pub paused: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub library_id: String,
    pub revision: u32,
    pub daily_new_limit: Option<u32>,
    pub material: Option<Material>,
    pub enrolled: bool,
    pub run: Option<RunView>,
    pub completion_id: Option<String>,
    pub due_at_ms: Option<i64>,
    pub completion_count: u32,
    pub handoff_count: u32,
}

fn id() -> String {
    Uuid::new_v4().to_string()
}
fn connection(path: &Path) -> Result<Connection> {
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
    } else if version != 1 || application != APPLICATION {
        return Err(Error::Rule("unsupported_library_version"));
    }
    tx.commit()?;
    Ok(db)
}

fn read(db: &Connection) -> Result<Snapshot> {
    let (library_id, revision, daily_new_limit) =
        db.query_row("SELECT id,revision,daily_new_limit FROM library", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
    let material: Option<String> = db
        .query_row("SELECT content FROM materials LIMIT 1", [], |r| r.get(0))
        .optional()?;
    let run = db
        .query_row(
            "SELECT id,phase,ordinal,attempt_count,paused FROM runs LIMIT 1",
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
                })
            },
        )
        .optional()?;
    Ok(Snapshot {
        library_id,
        revision,
        daily_new_limit,
        material: material.map(|s| serde_json::from_str(&s)).transpose()?,
        enrolled: db.query_row("SELECT count(*)>0 FROM targets", [], |r| r.get(0))?,
        run,
        completion_id: db
            .query_row("SELECT id FROM completions LIMIT 1", [], |r| r.get(0))
            .optional()?,
        due_at_ms: db
            .query_row("SELECT due_at_ms FROM memory LIMIT 1", [], |r| r.get(0))
            .optional()?,
        completion_count: db.query_row("SELECT count(*) FROM completions", [], |r| r.get(0))?,
        handoff_count: db.query_row("SELECT count(*) FROM handoffs", [], |r| r.get(0))?,
    })
}

pub fn open_library(path: &Path) -> Result<Snapshot> {
    let mut db = connection(path)?;
    let tx = db.transaction()?;
    let snapshot = read(&tx)?;
    tx.commit()?;
    Ok(snapshot)
}

pub fn execute(path: &Path, command: Command) -> Result<Snapshot> {
    execute_at(path, command, DateTime::<Utc>::from(SystemTime::now()))
}

/// Explicit time is a testable application dependency, not a UI-supplied result.
/// Runtime bridge calls execute(), which obtains device time itself.
pub fn execute_at(path: &Path, command: Command, now: DateTime<Utc>) -> Result<Snapshot> {
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
    match &command.action {
        CommandAction::ConfirmQuantity { quantity } => {
            if ![5, 10, 15, 20, 30].contains(quantity) {
                return Err(Error::Rule("invalid_quantity"));
            }
            tx.execute("UPDATE library SET daily_new_limit=?1", [quantity])?;
        }
        CommandAction::ImportAcceptanceMaterial => {
            let material = acceptance_material()?;
            let content = serde_json::to_string(&material)?;
            let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
            tx.execute(
                "INSERT INTO materials VALUES(?1,?2,?3) ON CONFLICT(id) DO NOTHING",
                params![material.id, digest, content],
            )?;
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
        }
        CommandAction::StartOrResume => {
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
            if let Some(run) = &state.run {
                if run.phase == Phase::Completed {
                    return Err(Error::Rule("review_not_implemented"));
                }
                tx.execute("UPDATE runs SET paused=0 WHERE id=?1", [&run.id])?;
            } else {
                let (target,material,digest): (String,String,String) = tx.query_row("SELECT t.id,m.id,m.digest FROM targets t JOIN materials m ON m.id=t.material_id LIMIT 1", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
                tx.execute(
                    "INSERT INTO runs VALUES(?1,?2,?3,?4,?5,'recall',1,0,0,?6)",
                    params![
                        id(),
                        target,
                        material,
                        digest,
                        PROTOCOL,
                        now.timestamp_millis()
                    ],
                )?;
            }
        }
        CommandAction::Pause => {
            let run = state.run.as_ref().ok_or(Error::Rule("no_active_run"))?;
            if run.phase == Phase::Completed {
                return Err(Error::Rule("no_active_run"));
            }
            tx.execute("UPDATE runs SET paused=1 WHERE id=?1", [&run.id])?;
        }
        CommandAction::RecordAction {
            run_id,
            ordinal,
            action,
        } => {
            let run = state.run.as_ref().ok_or(Error::Rule("no_active_run"))?;
            if run.id != *run_id || run.ordinal != *ordinal || run.paused {
                return Err(Error::Rule("stale_step"));
            }
            let (target,protocol,content,expected_digest): (String,String,String,String) = tx.query_row("SELECT r.target_id,r.protocol_version,m.content,r.material_digest FROM runs r JOIN materials m ON m.id=r.material_id WHERE r.id=?1", [run_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
            if format!("{:x}", Sha256::digest(content.as_bytes())) != expected_digest {
                return Err(Error::Rule("material_mismatch"));
            }
            let next = transition(&protocol, run.phase, *action).map_err(Error::Rule)?;
            let phase = serde_json::to_value(next)?
                .as_str()
                .ok_or(Error::Rule("invalid_phase"))?
                .to_owned();
            tx.execute(
                "INSERT INTO attempts VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    id(),
                    command.operation_id,
                    run_id,
                    ordinal,
                    serde_json::to_string(action)?,
                    phase,
                    now.timestamp_millis()
                ],
            )?;
            tx.execute("UPDATE runs SET phase=?2,ordinal=ordinal+?3,attempt_count=attempt_count+1 WHERE id=?1", params![run_id,phase,if next == Phase::Completed {0} else {1}])?;
            if next == Phase::Completed {
                let completion = id();
                let handoff = id();
                let schedule = initial_schedule(now).map_err(Error::Rule)?;
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
