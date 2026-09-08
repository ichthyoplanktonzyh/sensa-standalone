use chrono::{DateTime, Utc};
use sensa_core::Action;
use sensa_library::{Command, CommandAction, Snapshot, execute_at, open_library};
use serde_json::{Value, json};
use std::path::Path;
use uuid::Uuid;
const PACK: &str = include_str!("fixtures/local-text-pack-v1.json");
fn now() -> DateTime<Utc> {
    "2026-09-08T08:00:00Z".parse().unwrap()
}
fn command(s: &Snapshot, action: CommandAction) -> Command {
    Command {
        operation_id: Uuid::new_v4().to_string(),
        library_id: s.library_id.clone(),
        expected_revision: s.revision,
        action,
    }
}
fn apply(path: &Path, action: CommandAction) -> Snapshot {
    let s = open_library(path).unwrap();
    execute_at(path, command(&s, action), now()).unwrap()
}
fn import(pack: &str) -> CommandAction {
    CommandAction::ImportPack {
        pack_json: pack.into(),
    }
}
fn answer(path: &Path, action: Action) -> Snapshot {
    let s = open_library(path).unwrap();
    let r = s.run.unwrap();
    apply(
        path,
        CommandAction::RecordAction {
            run_id: r.id,
            ordinal: r.ordinal,
            action,
        },
    )
}
#[test]
fn import_is_atomic_idempotent_and_independent_of_enrollment_and_progress() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("library.sqlite");
    let s = apply(&path, import(PACK));
    assert_eq!(s.catalog.len(), 2);
    assert!(!s.enrolled);
    assert!(s.run.is_none());
    assert_eq!(s.completion_count, 0);
    let ids: Vec<_> = s.catalog.iter().map(|v| v.material.id.clone()).collect();
    apply(&path, CommandAction::ConfirmQuantity { quantity: 5 });
    apply(&path, CommandAction::AddToLearning);
    let started = apply(&path, CommandAction::StartOrResume);
    answer(&path, Action::Reveal);
    let selected = apply(
        &path,
        CommandAction::SelectMaterial {
            material_id: ids[1].clone(),
        },
    );
    assert!(!selected.enrolled);
    assert!(selected.run.is_none());
    apply(&path, CommandAction::AddToLearning);
    apply(&path, CommandAction::StartOrResume);
    answer(&path, Action::Reveal);
    let done = answer(&path, Action::Good);
    assert_eq!(done.completion_count, 1);
    let first = apply(
        &path,
        CommandAction::SelectMaterial {
            material_id: ids[0].clone(),
        },
    );
    assert!(first.run.as_ref().unwrap().paused);
    assert_eq!(first.run.as_ref().unwrap().id, started.run.unwrap().id);
    assert_eq!(first.run.as_ref().unwrap().phase, sensa_core::Phase::Reveal);
    apply(&path, CommandAction::StartOrResume);
    let done = answer(&path, Action::Hard);
    assert_eq!(done.completion_count, 2);
    assert_eq!(done.handoff_count, 2);
    let again = apply(&path, import(PACK));
    assert_eq!(again.catalog.len(), 2);
    assert_eq!(again.completion_count, 2);
    assert_eq!(again.due_at_ms, done.due_at_ms);
    let before = serde_json::to_value(&again).unwrap();
    let mut bad: Value = serde_json::from_str(PACK).unwrap();
    bad["version"] = json!("2");
    bad["materials"][0]["id"] = json!(Uuid::new_v4().to_string());
    bad["materials"][0]["senseVersionId"] = json!(Uuid::new_v4().to_string());
    bad["materials"][0]["bindingVersionId"] = json!(Uuid::new_v4().to_string());
    bad["materials"][1]["scene"] = json!("改变第二项的固定情境，让这一整包冲突。");
    assert_eq!(
        execute_at(&path, command(&again, import(&bad.to_string())), now())
            .unwrap_err()
            .to_string(),
        "material_version_conflict"
    );
    assert_eq!(
        serde_json::to_value(open_library(&path).unwrap()).unwrap(),
        before
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM imported_packs", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        1
    );
}
#[test]
fn malformed_unsupported_duplicate_and_disclosing_packs_fail_without_partial_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("library.sqlite");
    let s = open_library(&path).unwrap();
    let base: Value = serde_json::from_str(PACK).unwrap();
    let mut cases = Vec::new();
    for (key, value) in [
        ("format", json!("future")),
        ("protocolVersion", json!("structured-v1")),
        ("materials", json!([])),
    ] {
        let mut p = base.clone();
        p[key] = value;
        cases.push(p);
    }
    let mut duplicate = base.clone();
    duplicate["materials"][1] = duplicate["materials"][0].clone();
    cases.push(duplicate);
    let mut disclosure = base.clone();
    disclosure["materials"][0]["scene"] = json!("这里提前出现 ＴＡＣＴＦＵＬ 的答案。");
    cases.push(disclosure);
    let mut unknown = base.clone();
    unknown["materials"][0]["extra"] = json!("not silently dropped");
    cases.push(unknown);
    for pack in cases {
        assert!(execute_at(&path, command(&s, import(&pack.to_string())), now()).is_err());
        assert_eq!(open_library(&path).unwrap().revision, s.revision);
        assert!(open_library(&path).unwrap().catalog.is_empty());
    }
}
#[test]
fn additive_v1_upgrade_preserves_completed_history() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("library.sqlite");
    apply(&path, import(PACK));
    apply(&path, CommandAction::ConfirmQuantity { quantity: 5 });
    apply(&path, CommandAction::AddToLearning);
    apply(&path, CommandAction::StartOrResume);
    answer(&path, Action::Reveal);
    let before = answer(&path, Action::Good);
    // Recreate the v1 schema shape around unchanged fact rows.
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE consumer_progress_links; DROP TABLE protocol_transitions; DROP TABLE protocol_journals; DROP TABLE retention_run_policies; DROP TABLE initial_run_policies; DROP TABLE policy_commitments; DROP TABLE target_plans; DROP TABLE target_policy_sources; DROP TABLE material_policy_sources; DROP TABLE policy_assignments; DROP TABLE relearning_needs; DROP TABLE scheduling_decisions; DROP TABLE memory_outcomes; DROP TABLE retention_completions; DROP TABLE retention_attempts; DROP TABLE retention_runs; DROP TABLE imported_packs; ALTER TABLE library DROP COLUMN selected_material_id; PRAGMA user_version=1;").unwrap();
    drop(db);
    let upgraded = open_library(&path).unwrap();
    let mut upgraded_facts = serde_json::to_value(&upgraded).unwrap();
    let mut previous_facts = serde_json::to_value(&before).unwrap();
    upgraded_facts
        .as_object_mut()
        .unwrap()
        .remove("policyState");
    previous_facts
        .as_object_mut()
        .unwrap()
        .remove("policyState");
    upgraded_facts.as_object_mut().unwrap().remove("progress");
    previous_facts.as_object_mut().unwrap().remove("progress");
    assert_eq!(upgraded_facts, previous_facts);
    assert_eq!(
        upgraded.progress.as_ref().unwrap().state,
        before.progress.as_ref().unwrap().state
    );
    assert!(upgraded.policy_state.selected.as_ref().unwrap().committed);
    assert_eq!(
        open_library(&path).unwrap().completion_id,
        before.completion_id
    );
}

#[test]
fn daily_limit_counts_targets_not_attempts_and_resume_is_allowed() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("library.sqlite");
    let mut pack: Value = serde_json::from_str(PACK).unwrap();
    let template = pack["materials"][0].clone();
    pack["materials"] = Value::Array(
        (0..6)
            .map(|_| {
                let mut m = template.clone();
                for key in ["id", "senseVersionId", "bindingVersionId"] {
                    m[key] = json!(Uuid::new_v4().to_string());
                }
                m
            })
            .collect(),
    );
    let s = apply(&path, import(&pack.to_string()));
    let ids: Vec<_> = s.catalog.iter().map(|v| v.material.id.clone()).collect();
    apply(&path, CommandAction::ConfirmQuantity { quantity: 5 });
    for material_id in &ids[..5] {
        apply(
            &path,
            CommandAction::SelectMaterial {
                material_id: material_id.clone(),
            },
        );
        apply(&path, CommandAction::AddToLearning);
        apply(&path, CommandAction::StartOrResume);
    }
    apply(
        &path,
        CommandAction::SelectMaterial {
            material_id: ids[5].clone(),
        },
    );
    let s = apply(&path, CommandAction::AddToLearning);
    assert_eq!(
        execute_at(&path, command(&s, CommandAction::StartOrResume), now())
            .unwrap_err()
            .to_string(),
        "daily_limit"
    );
    apply(
        &path,
        CommandAction::SelectMaterial {
            material_id: ids[0].clone(),
        },
    );
    apply(&path, CommandAction::StartOrResume);
    let s = apply(
        &path,
        CommandAction::SelectMaterial {
            material_id: ids[5].clone(),
        },
    );
    // +08 midnight occurs at 16:00 UTC; starting the sixth then uses a new local day.
    let result = sensa_library::execute_at_offset(
        &path,
        command(&s, CommandAction::StartOrResume),
        "2026-09-08T16:00:00Z".parse().unwrap(),
        480,
    )
    .unwrap();
    assert!(result.run.is_some());
    assert_eq!(result.completion_count, 0);
}
