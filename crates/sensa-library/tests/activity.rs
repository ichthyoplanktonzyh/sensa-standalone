use chrono::{TimeZone, Utc};
use sensa_core::protocol::Action;
use sensa_library::{activity::Mode, *};
fn command(s: &Snapshot, action: CommandAction) -> Command {
    Command {
        operation_id: uuid::Uuid::new_v4().to_string(),
        library_id: s.library_id.clone(),
        expected_revision: s.revision,
        action,
    }
}
fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 9, 0, 0, 0).unwrap()
}
fn apply(path: &std::path::Path, action: CommandAction) -> Snapshot {
    let s = open_library(path).unwrap();
    execute_at_offset(path, command(&s, action), now(), 480).unwrap()
}
fn setup(path: &std::path::Path) {
    apply(path, CommandAction::ConfirmQuantity { quantity: 5 });
    apply(
        path,
        CommandAction::ImportPack {
            pack_json: include_str!("fixtures/local-text-pack-v1.json").into(),
        },
    );
    apply(path, CommandAction::AddToLearning);
}
fn aid(s: &Snapshot) -> String {
    s.learning["activity"]["id"].as_str().unwrap().into()
}
fn answer(path: &std::path::Path, action: Action) -> Snapshot {
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
fn activity_entry_checkin_pause_review_only_and_summary_are_independent() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("activity.sqlite");
    setup(&path);
    let s = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    let run = s.run.as_ref().unwrap().id.clone();
    assert!(
        s.learning["checkins"].as_array().unwrap().is_empty(),
        "Creating a run is not a check-in"
    );
    let before = s.revision;
    let bad = command(
        &s,
        CommandAction::ActivityNext {
            activity_id: aid(&s),
            early: false,
        },
    );
    assert!(
        execute_at_offset(&path, bad, now(), 480)
            .unwrap_err()
            .to_string()
            .contains("pending_result")
    );
    assert_eq!(open_library(&path).unwrap().revision, before);
    let a = &s.learning["activity"];
    let s = apply(
        &path,
        CommandAction::CheckIn {
            activity_id: Some(aid(&s)),
            execution_id: Some(a["executionId"].as_str().unwrap().into()),
            entry_operation_id: Some(a["entryOperationId"].as_str().unwrap().into()),
        },
    );
    let id = aid(&s);
    assert_eq!(s.learning["checkins"][0]["source"], "formal_learning");
    let s = apply(
        &path,
        CommandAction::CheckIn {
            activity_id: None,
            execution_id: None,
            entry_operation_id: None,
        },
    );
    assert_eq!(s.learning["checkins"].as_array().unwrap().len(), 1);
    assert_eq!(s.learning["checkins"][0]["source"], "formal_learning");
    answer(&path, Action::Reveal);
    apply(
        &path,
        CommandAction::ActivityPause {
            activity_id: id.clone(),
        },
    );
    let review = apply(
        &path,
        CommandAction::ActivityStart {
            mode: Mode::ReviewOnly,
        },
    );
    assert!(review.learning["activity"]["executionId"].is_null());
    assert_eq!(review.run.as_ref().unwrap().id, run);
    let resumed = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    assert_eq!(aid(&resumed), id);
    assert_eq!(resumed.run.unwrap().id, run);
    let completed = answer(&path, Action::Good);
    assert_eq!(
        completed.learning["activity"]["summary"]["distinctTargetCount"],
        1
    );
    let ended = apply(&path, CommandAction::ActivityEnd { activity_id: id });
    assert_eq!(ended.learning["activity"]["status"], "ended");
    assert_eq!(
        ended.learning["activity"]["summary"]["initialTargetIds"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        serde_json::to_value(open_library(&path).unwrap()).unwrap(),
        serde_json::to_value(ended).unwrap()
    );
}
#[test]
fn empty_scope_stays_empty_until_a_new_activity_and_checkins_use_occurrence_date() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("scope.sqlite");
    apply(&path, CommandAction::ConfirmQuantity { quantity: 5 });
    let empty = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    let id = aid(&empty);
    apply(
        &path,
        CommandAction::ActivityPause {
            activity_id: id.clone(),
        },
    );
    setup(&path);
    let old = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    assert_eq!(aid(&old), id);
    assert!(old.learning["activity"]["executionId"].is_null());
    apply(&path, CommandAction::ActivityEnd { activity_id: id });
    let new = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    assert!(new.run.is_some());
    let c = command(
        &new,
        CommandAction::CheckIn {
            activity_id: None,
            execution_id: None,
            entry_operation_id: None,
        },
    );
    let s = execute_at_offset(&path, c.clone(), now() + chrono::Duration::hours(17), 480).unwrap();
    assert_eq!(s.learning["checkins"][0]["date"], "2026-09-10");
    let replay = execute_at_offset(&path, c, now() + chrono::Duration::days(2), 480).unwrap();
    assert_eq!(s.revision, replay.revision);
    assert_eq!(s.learning["checkins"], replay.learning["checkins"]);
}
#[test]
fn review_and_relearning_of_one_target_do_not_inflate_summary() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("review.sqlite");
    setup(&path);
    apply(&path, CommandAction::StartOrResume);
    answer(&path, Action::Reveal);
    let completed = answer(&path, Action::Good);
    let due = Utc
        .timestamp_millis_opt(completed.due_at_ms.unwrap())
        .unwrap();
    let act = |action| {
        let s = open_library(&path).unwrap();
        execute_at_offset(&path, command(&s, action), due, 480).unwrap()
    };
    let s = act(CommandAction::ActivityStart {
        mode: Mode::ReviewOnly,
    });
    assert_eq!(s.learning["newStartedToday"], 0);
    let record = |action| {
        let s = open_library(&path).unwrap();
        let r = s.run.unwrap();
        act(CommandAction::RecordAction {
            run_id: r.id,
            ordinal: r.ordinal,
            action,
        })
    };
    record(Action::Reveal);
    let s = record(Action::Again);
    let s = act(CommandAction::ActivityNext {
        activity_id: aid(&s),
        early: false,
    });
    assert!(s.learning["activity"]["executionId"].is_null());
    let s = act(CommandAction::ActivityNext {
        activity_id: aid(&s),
        early: true,
    });
    assert!(s.run.is_some());
    record(Action::Reveal);
    let s = record(Action::Good);
    let summary = &s.learning["activity"]["summary"];
    assert_eq!(summary["distinctTargetCount"], 1);
    assert_eq!(summary["reviewTargetIds"], summary["restoredTargetIds"]);
    assert_eq!(s.retention.review_count, 1);
    assert_eq!(s.retention.relearning_count, 1);
    let db = rusqlite::Connection::open(&path).unwrap();
    let count: i64 = db
        .query_row("SELECT count(*) FROM memory_outcomes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn introduction_consumes_quota_only_when_accepted_and_replay_never_recounts() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("quota.sqlite");
    setup(&path);
    let s = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    assert_eq!(s.learning["newStartedToday"], 0);
    assert_eq!(s.learning["newReservedToday"], 1);
    let r = s.run.as_ref().unwrap();
    let c = command(
        &s,
        CommandAction::RecordAction {
            run_id: r.id.clone(),
            ordinal: r.ordinal,
            action: Action::Reveal,
        },
    );
    let tomorrow = now() + chrono::Duration::days(1);
    let introduced = execute_at_offset(&path, c.clone(), tomorrow, 480).unwrap();
    assert_eq!(introduced.learning["newStartedToday"], 1);
    assert_eq!(introduced.learning["newReservedToday"], 0);
    let replay = execute_at_offset(&path, c, tomorrow + chrono::Duration::days(1), 480).unwrap();
    assert_eq!(replay.learning, introduced.learning);
    let fresh = execute_at_offset(
        &path,
        command(&introduced, CommandAction::RefreshActivity),
        tomorrow + chrono::Duration::days(1),
        480,
    )
    .unwrap();
    assert_eq!(fresh.learning["newStartedToday"], 0);
    let db = rusqlite::Connection::open(path).unwrap();
    assert_eq!(db.query_row("SELECT count(*) FROM initial_introductions WHERE provenance='accepted_introduction_v7'",[],|r|r.get::<_,u32>(0)).unwrap(),1);
}

#[test]
fn material_navigation_pauses_activity_without_claiming_legacy_results() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("navigation.sqlite");
    setup(&path);
    let s = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    let id = aid(&s);
    apply(
        &path,
        CommandAction::SelectMaterial {
            material_id: s.material.unwrap().id,
        },
    );
    let s = apply(&path, CommandAction::StartOrResume);
    assert!(s.learning["activity"].is_null());
    answer(&path, Action::Reveal);
    answer(&path, Action::Good);
    let s = apply(&path, CommandAction::ActivityStart { mode: Mode::Mixed });
    assert_eq!(aid(&s), id);
    assert_eq!(s.learning["activity"]["summary"]["distinctTargetCount"], 0);
}
