#![cfg(feature = "acceptance-fixture")]
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use sensa_core::{Action, Phase};
use sensa_library::{Command, CommandAction, Snapshot, execute_at, open_library};
use std::path::Path;
use uuid::Uuid;
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
fn apply(p: &Path, a: CommandAction, t: DateTime<Utc>) -> Snapshot {
    execute_at(p, command(&open_library(p).unwrap(), a), t).unwrap()
}
fn answer(s: &Snapshot, a: Action) -> CommandAction {
    let r = s.run.as_ref().unwrap();
    CommandAction::RecordAction {
        run_id: r.id.clone(),
        ordinal: r.ordinal,
        action: a,
    }
}
fn rate(p: &Path, a: Action, t: DateTime<Utc>) -> Snapshot {
    apply(p, answer(&open_library(p).unwrap(), a), t)
}
fn prepare(p: &Path) -> Snapshot {
    apply(p, CommandAction::ConfirmQuantity { quantity: 5 }, now());
    apply(p, CommandAction::ImportAcceptanceMaterial, now());
    apply(p, CommandAction::AddToLearning, now());
    apply(p, CommandAction::StartOrResume, now());
    rate(p, Action::Reveal, now());
    rate(p, Action::Good, now())
}
fn memory(p: &Path) -> (u32, i64, String) {
    Connection::open(p)
        .unwrap()
        .query_row("SELECT revision,due_at_ms,schedule FROM memory", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap()
}
#[test]
fn due_once_wait_early_rewait_restart_and_recovery_preserve_original_rating() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("test.sqlite");
    let s = prepare(&p);
    assert_eq!(
        execute_at(
            &p,
            command(&s, CommandAction::StartRetention { early: true }),
            now()
        )
        .unwrap_err()
        .to_string(),
        "no_due_review"
    );
    let due = DateTime::from_timestamp_millis(s.due_at_ms.unwrap()).unwrap();
    let r = apply(&p, CommandAction::NextRetention, due);
    assert_eq!(
        r.run.as_ref().unwrap().protocol_version,
        "consumer-review-v1"
    );
    rate(&p, Action::Reveal, due);
    let s = rate(&p, Action::Again, due);
    assert_eq!(s.retention.review_count, 1);
    assert_eq!(s.retention.pending_count, 1);
    assert_eq!(
        s.retention.next_eligible_at_ms,
        Some((due + Duration::minutes(10)).timestamp_millis())
    );
    let original = memory(&p);
    assert_eq!(original.0, 2);
    assert_eq!(
        execute_at(
            &p,
            command(&s, CommandAction::StartRetention { early: false }),
            due + Duration::minutes(4)
        )
        .unwrap_err()
        .to_string(),
        "relearning_waiting"
    );
    let waiting = apply(&p, CommandAction::NextRetention, due + Duration::minutes(4));
    assert_eq!(
        waiting.retention.next_eligible_at_ms,
        s.retention.next_eligible_at_ms
    );
    let early = apply(
        &p,
        CommandAction::StartRetention { early: true },
        due + Duration::minutes(4),
    );
    let run = early.run.unwrap().id;
    rate(&p, Action::Reveal, due + Duration::minutes(4));
    let s = rate(&p, Action::Again, due + Duration::minutes(4));
    assert_eq!(s.run.as_ref().unwrap().phase, Phase::Waiting);
    assert_eq!(
        s.retention.next_eligible_at_ms,
        Some((due + Duration::minutes(14)).timestamp_millis())
    );
    assert_eq!(
        serde_json::to_value(&s).unwrap(),
        serde_json::to_value(open_library(&p).unwrap()).unwrap()
    );
    assert_eq!(
        execute_at(
            &p,
            command(&s, answer(&s, Action::Reveal)),
            due + Duration::minutes(14)
        )
        .unwrap_err()
        .to_string(),
        "stale_step"
    );
    let s = apply(
        &p,
        CommandAction::StartRetention { early: false },
        due + Duration::minutes(14),
    );
    assert_eq!(s.run.unwrap().id, run);
    rate(&p, Action::Reveal, due + Duration::minutes(14));
    let s = rate(&p, Action::Hard, due + Duration::minutes(14));
    assert_eq!(s.retention.relearning_count, 1);
    assert_eq!(s.retention.pending_count, 0);
    assert_eq!(memory(&p), original);
    assert_eq!(s.completion_count, 1);
    assert_eq!(s.handoff_count, 1);
    let db = Connection::open(&p).unwrap();
    assert_eq!(
        db.query_row("SELECT grade FROM memory_outcomes", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "again"
    );
    let next = DateTime::from_timestamp_millis(original.1).unwrap();
    apply(&p, CommandAction::NextRetention, next);
    rate(&p, Action::Reveal, next);
    let s = rate(&p, Action::Good, next);
    assert_eq!(s.retention.review_count, 2);
    assert_eq!(memory(&p).0, 3);
}
#[test]
fn scheduling_failure_rolls_back_and_concurrent_replay_commits_once() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("test.sqlite");
    let s = prepare(&p);
    let t = DateTime::from_timestamp_millis(s.due_at_ms.unwrap()).unwrap();
    apply(&p, CommandAction::NextRetention, t);
    let s = rate(&p, Action::Reveal, t);
    let c = command(&s, answer(&s, Action::Again));
    let db = Connection::open(&p).unwrap();
    db.execute_batch("CREATE TRIGGER fail_schedule BEFORE INSERT ON scheduling_decisions BEGIN SELECT RAISE(ABORT,'injected_failure'); END;").unwrap();
    assert!(execute_at(&p, c.clone(), t).is_err());
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        serde_json::to_value(&s).unwrap()
    );
    assert_eq!(memory(&p).0, 1);
    db.execute_batch("DROP TRIGGER fail_schedule;").unwrap();
    drop(db);
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let p = p.clone();
            let c = c.clone();
            std::thread::spawn(move || execute_at(&p, c, t).unwrap())
        })
        .collect();
    let results: Vec<_> = threads.into_iter().map(|v| v.join().unwrap()).collect();
    assert_eq!(
        serde_json::to_value(&results[0]).unwrap(),
        serde_json::to_value(&results[1]).unwrap()
    );
    assert_eq!(memory(&p).0, 2);
    let s = open_library(&p).unwrap();
    assert_eq!(s.retention.review_count, 1);
    assert_eq!(s.retention.pending_count, 1);
    assert_eq!(
        execute_at(&p, command(&s, answer(&s, Action::Good)), t)
            .unwrap_err()
            .to_string(),
        "stale_step"
    );
    let db = Connection::open(&p).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM retention_attempts", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM scheduling_decisions", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        1
    );
}
#[test]
fn review_only_preserves_initial_resume_and_pins_material() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("test.sqlite");
    let s = prepare(&p);
    let t = DateTime::from_timestamp_millis(s.due_at_ms.unwrap()).unwrap();
    let pack = include_str!("fixtures/local-text-pack-v1.json");
    apply(
        &p,
        CommandAction::ImportPack {
            pack_json: pack.into(),
        },
        now(),
    );
    let pack: serde_json::Value = serde_json::from_str(pack).unwrap();
    let material = pack["materials"][1]["id"].as_str().unwrap().to_string();
    apply(
        &p,
        CommandAction::SelectMaterial {
            material_id: material.clone(),
        },
        now(),
    );
    apply(&p, CommandAction::AddToLearning, now());
    let initial = apply(&p, CommandAction::StartOrResume, now());
    rate(&p, Action::Reveal, now());
    let s = apply(&p, CommandAction::NextRetention, t);
    assert_ne!(s.run.as_ref().unwrap().id, initial.run.as_ref().unwrap().id);
    apply(&p, CommandAction::Pause, t);
    let resumed = apply(&p, CommandAction::NextRetention, t);
    assert_eq!(resumed.run.as_ref().unwrap().id, s.run.as_ref().unwrap().id);
    // A run uses its immutable copy even if later source storage is damaged.
    Connection::open(&p).unwrap().execute("UPDATE materials SET content=replace(content,'tactful','changed') WHERE id='native-acceptance-material-v1'",[]).unwrap();
    let s = rate(&p, Action::Reveal, t);
    assert_eq!(s.material.unwrap().expression, "tactful");
    rate(&p, Action::Good, t);
    apply(
        &p,
        CommandAction::SelectMaterial {
            material_id: material,
        },
        t,
    );
    let s = apply(&p, CommandAction::StartOrResume, t);
    assert_eq!(s.run.as_ref().unwrap().id, initial.run.as_ref().unwrap().id);
    assert_eq!(s.run.unwrap().phase, Phase::Reveal);
}

#[test]
fn v2_upgrade_and_stale_due_do_not_rewrite_history() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("test.sqlite");
    let before = prepare(&p);
    let db = Connection::open(&p).unwrap();
    db.execute_batch("DROP TABLE personal_task_entries; DROP TABLE personal_content_attempts; DROP TABLE personal_learning_tasks; DROP TABLE semantic_lookups; DROP TABLE semantic_identities; DROP TABLE personal_learning_links; DROP TABLE personal_intakes; DROP TABLE personal_meanings; DROP TABLE initial_introductions; DROP TABLE local_checkins; DROP TABLE activity_results; DROP TABLE activity_executions; DROP TABLE activity_scope; DROP TABLE learning_activities; DROP TABLE activity_clock; DROP TABLE assurance_cycles; DROP TABLE assurance_evidence; DROP TABLE assurance_events; DROP TABLE assurance_session_targets; DROP TABLE assurance_sessions; DROP TABLE runtime_media; DROP TABLE assurance_materials; DROP TABLE runtime_releases; DROP TABLE consumer_progress_links; DROP TABLE protocol_transitions; DROP TABLE protocol_journals; DROP TABLE retention_run_policies; DROP TABLE initial_run_policies; DROP TABLE policy_commitments; DROP TABLE target_plans; DROP TABLE target_policy_sources; DROP TABLE material_policy_sources; DROP TABLE policy_assignments; DROP TABLE relearning_needs; DROP TABLE scheduling_decisions; DROP TABLE memory_outcomes; DROP TABLE retention_completions; DROP TABLE retention_attempts; DROP TABLE retention_runs; PRAGMA user_version=2;").unwrap();
    drop(db);
    let upgraded = open_library(&p).unwrap();
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
    let t = DateTime::from_timestamp_millis(before.due_at_ms.unwrap()).unwrap();
    apply(&p, CommandAction::NextRetention, t);
    let s = rate(&p, Action::Reveal, t);
    let db = Connection::open(&p).unwrap();
    db.execute("UPDATE memory SET revision=revision+1", [])
        .unwrap();
    let before = serde_json::to_value(open_library(&p).unwrap()).unwrap();
    assert_eq!(
        execute_at(&p, command(&s, answer(&s, Action::Good)), t)
            .unwrap_err()
            .to_string(),
        "stale_due"
    );
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM memory_outcomes", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM retention_attempts", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        1
    );
}
