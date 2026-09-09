use chrono::{DateTime, Utc};
use rusqlite::Connection;
use sensa_core::progression::*;
use sensa_library::progress::{self, Journal, Pin};
use sensa_library::{Command, CommandAction, Snapshot, execute_at, open_library};
use uuid::Uuid;

fn pin() -> Pin {
    Pin {
        definition: Definition {
            protocol_id: "acceptance-two-checkpoints".into(),
            protocol_version: "1".into(),
            checkpoints: ["a", "b"]
                .into_iter()
                .map(|id| CheckpointDefinition {
                    checkpoint_id: id.into(),
                    capability_objective_ids: vec![],
                    required_for_completion: true,
                })
                .collect(),
            completion_policy: CompletionPolicy::AllRequiredCheckpoints {
                require_same_progress_epoch: true,
            },
        },
        progression_policy_id: "acceptance-run-reset-v1".into(),
        evaluation_contract_id: "acceptance-evaluator-v1".into(),
        plan_id: "acceptance-plan".into(),
        material_digest: "acceptance-digest".into(),
    }
}
fn observation(id: &str, kind: ObservationKind, checkpoint: &str) -> Observation {
    Observation {
        observation_id: id.into(),
        attempt_id: format!("{id}:attempt"),
        action_id: format!("{id}:action"),
        kind,
        checkpoint_id: Some(checkpoint.into()),
        evidence_ids: vec![],
    }
}
#[test]
fn checkpoint_reset_repair_reassessment_and_complete_survive_disk_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("journal.sqlite");
    open_library(&path).unwrap();
    let policy = CheckpointPolicy::new("acceptance-run-reset-v1", FailureReset::Run).unwrap();
    let events = [
        observation("1", ObservationKind::CheckpointSatisfied, "a"),
        observation("2", ObservationKind::CheckpointNotSatisfied, "b"),
        observation("3", ObservationKind::RepairCompleted, "b"),
        observation("4", ObservationKind::CheckpointSatisfied, "b"),
        observation("5", ObservationKind::CheckpointSatisfied, "a"),
    ];
    let mut expected = create_state("run", &pin().definition).unwrap();
    for (index, o) in events.iter().enumerate() {
        // A new connection and transaction for every learner interaction.
        let mut db = Connection::open(&path).unwrap();
        let tx = db.transaction().unwrap();
        let journal = Journal::new(&tx);
        journal.create("run", &pin()).unwrap();
        let view = journal
            .record("run", index as u32, &policy, o, 10, "acceptance")
            .unwrap();
        expected = decide_and_apply(
            &pin().definition,
            &policy,
            &expected,
            o,
            &format!("{}:transition", o.observation_id),
        )
        .unwrap()
        .state;
        assert_eq!(view.state, expected);
        tx.commit().unwrap();
        drop(db);
        let db = Connection::open(&path).unwrap();
        assert_eq!(progress::load(&db, "run").unwrap(), view);
        if index == 1 {
            assert_eq!(view.state.progress_epoch, 1);
            assert_eq!(
                view.state.checkpoint_credits["a"].status,
                CreditStatus::Unresolved
            );
            assert!(view.state.pending_repairs.contains_key("b"));
        }
        if index == 2 {
            assert!(!view.state.completed);
            assert_eq!(view.state.reassessment_required_checkpoint_ids, vec!["b"]);
        }
    }
    assert!(expected.completed);
    let mut db = Connection::open(&path).unwrap();
    let tx = db.transaction().unwrap();
    let journal = Journal::new(&tx);
    let replay = journal
        .record("run", 0, &policy, &events[4], 10, "acceptance")
        .unwrap();
    assert_eq!(replay.revision, 5);
    assert_eq!(replay.state, expected);
    let mut conflicting = events[4].clone();
    conflicting.kind = ObservationKind::CheckpointNotSatisfied;
    assert_eq!(
        journal
            .record("run", 5, &policy, &conflicting, 10, "acceptance")
            .unwrap_err()
            .to_string(),
        "observation_identity_conflict"
    );
    assert_eq!(
        tx.query_row("SELECT count(*) FROM protocol_transitions", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        5
    );
}
#[test]
fn pins_revisions_cross_run_identities_and_corrupt_cache_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("journal.sqlite");
    open_library(&p).unwrap();
    let mut db = Connection::open(&p).unwrap();
    let tx = db.transaction().unwrap();
    let journal = Journal::new(&tx);
    let policy = CheckpointPolicy::new("acceptance-run-reset-v1", FailureReset::Run).unwrap();
    journal.create("a", &pin()).unwrap();
    journal.create("b", &pin()).unwrap();
    let mut changed = pin();
    changed.definition.protocol_version = "2".into();
    assert_eq!(
        journal.create("a", &changed).unwrap_err().to_string(),
        "progress_pin_conflict"
    );
    let o = observation("event", ObservationKind::CheckpointSatisfied, "a");
    assert_eq!(
        journal
            .record("a", 2, &policy, &o, 0, "acceptance")
            .unwrap_err()
            .to_string(),
        "stale_progress"
    );
    let wrong = CheckpointPolicy::new("other-version", FailureReset::Run).unwrap();
    assert_eq!(
        journal
            .record("a", 0, &wrong, &o, 0, "acceptance")
            .unwrap_err()
            .to_string(),
        "progress_policy_mismatch"
    );
    journal
        .record("a", 0, &policy, &o, 0, "acceptance")
        .unwrap();
    assert_eq!(
        journal
            .record("b", 0, &policy, &o, 0, "acceptance")
            .unwrap_err()
            .to_string(),
        "observation_identity_conflict"
    );
    tx.commit().unwrap();
    db.execute(
        "UPDATE protocol_journals SET state=json_set(state,'$.completed',1) WHERE run_id='a'",
        [],
    )
    .unwrap();
    assert!(progress::load(&db, "a").is_err());
}
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
fn setup(p: &std::path::Path) -> Snapshot {
    let mut s = open_library(p).unwrap();
    for action in [
        CommandAction::ConfirmQuantity { quantity: 5 },
        CommandAction::ImportPack {
            pack_json: include_str!("fixtures/local-text-pack-v1.json").into(),
        },
        CommandAction::AddToLearning,
        CommandAction::StartOrResume,
    ] {
        s = execute_at(p, command(&s, action), now()).unwrap();
    }
    s
}
#[test]
fn failed_journal_update_rolls_back_attempt_completion_and_schedule_together() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("journal.sqlite");
    let s = setup(&p);
    let r = s.run.as_ref().unwrap();
    let reveal = command(
        &s,
        CommandAction::RecordAction {
            run_id: r.id.clone(),
            ordinal: r.ordinal,
            action: sensa_core::Action::Reveal,
        },
    );
    let s = execute_at(&p, reveal, now()).unwrap();
    let r = s.run.as_ref().unwrap();
    let good = command(
        &s,
        CommandAction::RecordAction {
            run_id: r.id.clone(),
            ordinal: r.ordinal,
            action: sensa_core::Action::Good,
        },
    );
    let db = Connection::open(&p).unwrap();
    db.execute_batch("CREATE TRIGGER fail_progress BEFORE UPDATE ON protocol_journals BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(execute_at(&p, good.clone(), now()).is_err());
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        serde_json::to_value(&s).unwrap()
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM protocol_transitions", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(s.completion_count, 0);
    db.execute_batch("DROP TRIGGER fail_progress").unwrap();
    let completed = execute_at(&p, good.clone(), now()).unwrap();
    assert!(completed.progress.as_ref().unwrap().state.completed);
    assert_eq!(completed.progress.as_ref().unwrap().revision, 2);
    assert_eq!(completed.completion_count, 1);
    assert_eq!(
        serde_json::to_value(execute_at(&p, good, now()).unwrap()).unwrap(),
        serde_json::to_value(completed).unwrap()
    );
}
#[test]
fn v4_backfill_cites_original_attempts_without_rewriting_old_facts() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("journal.sqlite");
    let s = setup(&p);
    let r = s.run.as_ref().unwrap();
    let s = execute_at(
        &p,
        command(
            &s,
            CommandAction::RecordAction {
                run_id: r.id.clone(),
                ordinal: r.ordinal,
                action: sensa_core::Action::Reveal,
            },
        ),
        now(),
    )
    .unwrap();
    let db = Connection::open(&p).unwrap();
    let attempt: String = db
        .query_row("SELECT id FROM attempts", [], |r| r.get(0))
        .unwrap();
    db.execute_batch("DROP TABLE semantic_lookups; DROP TABLE semantic_identities; DROP TABLE personal_learning_links; DROP TABLE personal_intakes; DROP TABLE personal_meanings; DROP TABLE initial_introductions; DROP TABLE local_checkins; DROP TABLE activity_results; DROP TABLE activity_executions; DROP TABLE activity_scope; DROP TABLE learning_activities; DROP TABLE activity_clock; DROP TABLE assurance_cycles; DROP TABLE assurance_evidence; DROP TABLE assurance_events; DROP TABLE assurance_session_targets; DROP TABLE assurance_sessions; DROP TABLE runtime_media; DROP TABLE assurance_materials; DROP TABLE runtime_releases; DROP TABLE consumer_progress_links; DROP TABLE protocol_transitions; DROP TABLE protocol_journals; PRAGMA user_version=4;").unwrap();
    // An invalid legacy transition must roll back DDL and derived backfill together.
    db.execute("UPDATE attempts SET next_phase='completed'", [])
        .unwrap();
    assert!(open_library(&p).is_err());
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        4
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='protocol_journals'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    db.execute("UPDATE attempts SET next_phase='reveal'", [])
        .unwrap();
    let recovered = open_library(&p).unwrap();
    let mut old = serde_json::to_value(&s).unwrap();
    old.as_object_mut().unwrap().remove("progress");
    let mut new = serde_json::to_value(&recovered).unwrap();
    new.as_object_mut().unwrap().remove("progress");
    assert_eq!(new, old);
    assert_eq!(recovered.progress, s.progress);
    let (observation, origin): (String, String) = db
        .query_row(
            "SELECT observation,provenance FROM protocol_transitions",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Observation>(&observation)
            .unwrap()
            .attempt_id,
        attempt
    );
    assert_eq!(origin, "legacy_attempt_v4");
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, u32>(
            0
        ))
        .unwrap(),
        0
    );
}
