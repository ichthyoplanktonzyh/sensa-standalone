#![cfg(feature = "acceptance-fixture")]
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use sensa_core::Action;
use sensa_library::{Command, CommandAction, Snapshot, execute_at, open_library};
use std::path::Path;
use uuid::Uuid;

fn now() -> DateTime<Utc> {
    "2026-09-08T08:00:00Z".parse().unwrap()
}
fn command(state: &Snapshot, action: CommandAction) -> Command {
    Command {
        operation_id: Uuid::new_v4().to_string(),
        library_id: state.library_id.clone(),
        expected_revision: state.revision,
        action,
    }
}
fn apply(path: &Path, action: CommandAction) -> Snapshot {
    let state = open_library(path).unwrap();
    execute_at(path, command(&state, action), now()).unwrap()
}
fn prepared(path: &Path) -> Snapshot {
    apply(path, CommandAction::ConfirmQuantity { quantity: 5 });
    let imported = apply(path, CommandAction::ImportAcceptanceMaterial);
    assert!(!imported.enrolled);
    assert!(imported.run.is_none());
    apply(path, CommandAction::AddToLearning);
    apply(path, CommandAction::StartOrResume)
}
fn action(state: &Snapshot, action: Action) -> CommandAction {
    let run = state.run.as_ref().unwrap();
    CommandAction::RecordAction {
        run_id: run.id.clone(),
        ordinal: run.ordinal,
        action,
    }
}

#[test]
fn restart_replay_and_atomic_failure_preserve_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let initial = prepared(&path);
    let reveal = apply(&path, action(&initial, Action::Reveal));
    let retry = apply(&path, action(&reveal, Action::Again));
    assert_eq!(retry.completion_count, 0);
    assert!(retry.due_at_ms.is_none());
    apply(&path, CommandAction::Pause);
    let resumed = apply(&path, CommandAction::StartOrResume);
    assert_eq!(
        resumed.run.as_ref().unwrap().id,
        initial.run.as_ref().unwrap().id
    );
    let reveal = apply(&path, action(&resumed, Action::Reveal));
    let finish = command(&reveal, action(&reveal, Action::Hard));
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_handoff BEFORE INSERT ON handoffs BEGIN SELECT RAISE(ABORT,'injected_storage_failure'); END;").unwrap();
    assert!(execute_at(&path, finish.clone(), now()).is_err());
    let failed = open_library(&path).unwrap();
    assert_eq!(failed.revision, reveal.revision);
    assert_eq!(
        failed.run.unwrap().attempt_count,
        reveal.run.as_ref().unwrap().attempt_count
    );
    assert_eq!(failed.completion_count, 0);
    db.execute_batch("DROP TRIGGER fail_handoff").unwrap();
    drop(db);
    let completed = execute_at(&path, finish.clone(), now()).unwrap();
    assert_eq!(completed.completion_count, 1);
    assert_eq!(completed.handoff_count, 1);
    assert_eq!(
        completed.due_at_ms,
        Some(now().timestamp_millis() + 2 * 86400000)
    );
    // Every call closes the connection; reopening must recover identical committed data.
    assert_eq!(
        serde_json::to_value(open_library(&path).unwrap()).unwrap(),
        serde_json::to_value(&completed).unwrap()
    );
    let replay = execute_at(&path, finish.clone(), now()).unwrap();
    assert_eq!(replay.completion_id, completed.completion_id);
    let mut changed = finish.clone();
    changed.action = CommandAction::Pause;
    assert_eq!(
        execute_at(&path, changed, now()).unwrap_err().to_string(),
        "operation_conflict"
    );
    let mut stale = finish;
    stale.operation_id = Uuid::new_v4().to_string();
    assert_eq!(
        execute_at(&path, stale, now()).unwrap_err().to_string(),
        "revision_conflict"
    );
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM memory", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT evidence_level FROM completions", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "non_evidentiary"
    );
}

#[test]
fn concurrent_same_operation_is_committed_once_and_libraries_are_isolated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let s = prepared(&path);
    let s = apply(&path, action(&s, Action::Reveal));
    let c = command(&s, action(&s, Action::Good));
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let p = path.clone();
            let c = c.clone();
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                execute_at(&p, c, now()).unwrap()
            })
        })
        .collect();
    let snapshots: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(snapshots[0].completion_id, snapshots[1].completion_id);
    assert_eq!(open_library(&path).unwrap().completion_count, 1);
    let other = dir.path().join("other.sqlite");
    assert_eq!(
        execute_at(&other, c, now()).unwrap_err().to_string(),
        "library_mismatch"
    );
    assert!(!open_library(&other).unwrap().enrolled);
}

#[test]
fn corrupt_material_unknown_schema_clock_and_invalid_step_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let s = prepared(&path);
    assert_eq!(
        execute_at(&path, command(&s, action(&s, Action::Good)), now())
            .unwrap_err()
            .to_string(),
        "stale_step"
    );
    assert_eq!(
        execute_at(
            &path,
            command(&s, CommandAction::Pause),
            now() - chrono::Duration::seconds(1)
        )
        .unwrap_err()
        .to_string(),
        "clock_moved_backwards"
    );
    let db = Connection::open(&path).unwrap();
    db.execute(
        "UPDATE materials SET content=replace(content,'tactful','changed')",
        [],
    )
    .unwrap();
    assert_eq!(
        execute_at(&path, command(&s, action(&s, Action::Reveal)), now())
            .unwrap_err()
            .to_string(),
        "material_mismatch"
    );
    db.pragma_update(None, "user_version", 99).unwrap();
    drop(db);
    assert_eq!(
        open_library(&path).unwrap_err().to_string(),
        "unsupported_library_version"
    );
}

#[test]
fn core_protocol_support_does_not_grant_unimplemented_storage_authority() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let initial = prepared(&path);
    let revealed = apply(&path, action(&initial, Action::Reveal));
    let db = Connection::open(&path).unwrap();
    db.execute("UPDATE runs SET protocol_version='consumer-review-v1'", [])
        .unwrap();
    let before = serde_json::to_value(open_library(&path).unwrap()).unwrap();
    assert_eq!(
        execute_at(
            &path,
            command(&revealed, action(&revealed, Action::Good)),
            now()
        )
        .unwrap_err()
        .to_string(),
        "unsupported_protocol"
    );
    assert_eq!(
        serde_json::to_value(open_library(&path).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM memory", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        0
    );
}
