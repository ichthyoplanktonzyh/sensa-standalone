fn wrap(action: PersonalAction) -> CommandAction {
    CommandAction::Personal {
        action: Box::new(action),
    }
}
use chrono::{TimeZone, Utc};
use sensa_library::{
    personal::{Action as PersonalAction, Capture, Entity},
    *,
};
use serde_json::{Value, json};
fn command(s: &Snapshot, action: CommandAction) -> Command {
    Command {
        operation_id: uuid::Uuid::new_v4().to_string(),
        library_id: s.library_id.clone(),
        expected_revision: s.revision,
        action,
    }
}
fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 9, 1, 0, 0).unwrap()
}
fn apply(p: &std::path::Path, action: CommandAction) -> Snapshot {
    let s = open_library(p).unwrap();
    execute_at(p, command(&s, action), now()).unwrap()
}
fn personal(p: &std::path::Path, action: PersonalAction) -> Snapshot {
    apply(p, wrap(action))
}
fn capture(expression: bool) -> Capture {
    serde_json::from_value(json!({"sentence":"😀 She was tactful.","language":"en","expression":if expression {json!({"text":"tactful","start":10,"end":17})}else{Value::Null},"source":{"url":"https://example.org/article","title":"original","capturedAt":"2026-09-09T00:00:00Z"}})).unwrap()
}
fn import(p: &std::path::Path) -> String {
    let s = apply(
        p,
        CommandAction::ImportPack {
            pack_json: include_str!("fixtures/local-text-pack-v1.json").into(),
        },
    );
    s.catalog
        .iter()
        .find(|m| m.material.expression == "tactful")
        .unwrap()
        .material
        .id
        .clone()
}
fn accept(snapshot: Capture, material_id: String, intake_id: Option<String>) -> PersonalAction {
    PersonalAction::Accept {
        snapshot,
        material_id,
        intake_id,
        focus: None,
        consent: "accept_context_expression_sense".into(),
    }
}
#[test]
fn inbox_resolution_acceptance_learning_and_membership_are_independent() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("personal.sqlite");
    let material = import(&p);
    let s = personal(
        &p,
        PersonalAction::SaveIntake {
            snapshot: capture(false),
        },
    );
    assert!(s.daily_new_limit.is_none());
    assert_eq!(s.personal["meanings"], json!([]));
    let intake = s.personal["intakes"][0]["id"].as_str().unwrap().to_owned();
    let mut duplicate = capture(false);
    duplicate.source.title = "new title".into();
    duplicate.source.captured_at = "2026-09-09T01:00:00Z".into();
    let s = personal(
        &p,
        PersonalAction::SaveIntake {
            snapshot: duplicate,
        },
    );
    assert_eq!(s.personal["intakes"].as_array().unwrap().len(), 1);
    assert_eq!(
        s.personal["intakes"][0]["snapshot"]["source"]["title"],
        "original"
    );
    let s = personal(&p, accept(capture(true), material, Some(intake.clone())));
    let m = &s.personal["meanings"][0];
    assert!(m["focus"].is_null());
    assert_eq!(m["acceptanceKind"], "direct");
    assert_eq!(s.personal["intakes"][0]["status"], "confirmed");
    assert!(s.personal["intakes"][0]["snapshot"]["expression"].is_null());
    assert!(!s.enrolled);
    assert_eq!(s.completion_count, 0);
    assert_eq!(s.learning["checkins"], json!([]));
    let mid = m["id"].as_str().unwrap().to_owned();
    let err = execute_at(
        &p,
        command(
            &s,
            wrap(PersonalAction::AddToLearning {
                meaning_id: mid.clone(),
                expected_revision: 1,
            }),
        ),
        now(),
    )
    .unwrap_err();
    assert!(err.to_string().contains("quantity_required"));
    apply(&p, CommandAction::ConfirmQuantity { quantity: 5 });
    personal(
        &p,
        PersonalAction::AddToLearning {
            meaning_id: mid.clone(),
            expected_revision: 1,
        },
    );
    personal(
        &p,
        PersonalAction::AddToLearning {
            meaning_id: mid.clone(),
            expected_revision: 1,
        },
    );
    let s = apply(
        &p,
        CommandAction::ActivityStart {
            mode: activity::Mode::Mixed,
        },
    );
    let run = s.run.unwrap();
    apply(
        &p,
        CommandAction::RecordAction {
            run_id: run.id.clone(),
            ordinal: run.ordinal,
            action: sensa_core::Action::Reveal,
        },
    );
    let s = open_library(&p).unwrap();
    let r = s.run.unwrap();
    apply(
        &p,
        CommandAction::RecordAction {
            run_id: r.id,
            ordinal: r.ordinal,
            action: sensa_core::Action::Good,
        },
    );
    let before = open_library(&p).unwrap();
    let removed = personal(
        &p,
        PersonalAction::SetMembership {
            entity: Entity::Meaning,
            id: mid.clone(),
            expected_revision: 1,
            active: false,
        },
    );
    assert_eq!(removed.personal["meanings"][0]["status"], "removed");
    assert_eq!(removed.completion_count, before.completion_count);
    assert_eq!(removed.due_at_ms, before.due_at_ms);
    let restored = personal(
        &p,
        PersonalAction::SetMembership {
            entity: Entity::Meaning,
            id: mid,
            expected_revision: 2,
            active: true,
        },
    );
    assert_eq!(restored.personal["meanings"][0]["addedToLearning"], true);
    assert_eq!(restored.personal["meanings"][0]["revision"], 3);
    assert_eq!(open_library(&p).unwrap().personal, restored.personal);
    let db = rusqlite::Connection::open(p).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM targets", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
}
#[test]
fn fast_track_duplicate_replay_and_failed_acceptance_are_atomic() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("fast.sqlite");
    let material = import(&p);
    let s = open_library(&p).unwrap();
    let c = command(&s, wrap(accept(capture(true), material.clone(), None)));
    let db = rusqlite::Connection::open(&p).unwrap();
    db.execute_batch("CREATE TRIGGER reject_meaning BEFORE INSERT ON personal_meanings BEGIN SELECT RAISE(ABORT,'test_fault'); END;").unwrap();
    assert!(execute_at(&p, c.clone(), now()).is_err());
    assert_eq!(open_library(&p).unwrap().revision, s.revision);
    db.execute_batch("DROP TRIGGER reject_meaning").unwrap();
    let first = execute_at(&p, c.clone(), now()).unwrap();
    let replay = execute_at(&p, c, now()).unwrap();
    assert_eq!(replay.personal, first.personal);
    let mut duplicate = capture(true);
    duplicate.source.title = "changed".into();
    let s = personal(&p, accept(duplicate, material.clone(), None));
    assert_eq!(s.personal["meanings"], first.personal["meanings"]);
    assert_eq!(s.personal["intakes"], json!([]));
    let mut bad = capture(true);
    bad.expression.as_mut().unwrap().start += 1;
    assert!(
        execute_at(&p, command(&s, wrap(accept(bad, material, None))), now())
            .unwrap_err()
            .to_string()
            .contains("invalid_occurrence")
    );
    assert_eq!(open_library(&p).unwrap().revision, s.revision);
    let mid = s.personal["meanings"][0]["id"].as_str().unwrap().to_owned();
    let s = personal(
        &p,
        PersonalAction::SetMembership {
            entity: Entity::Meaning,
            id: mid,
            expected_revision: 1,
            active: false,
        },
    );
    assert!(
        execute_at(
            &p,
            command(
                &s,
                wrap(accept(
                    capture(true),
                    s.catalog[0].material.id.clone(),
                    None
                ))
            ),
            now()
        )
        .is_err()
    );
}
#[test]
fn capture_uses_unicode_occurrences_and_validated_video_locators() {
    let mut c = capture(true);
    c.validate().unwrap();
    c.source.url = Some("https://www.youtube.com/watch?v=abcdefghijk".into());
    c.source.video = Some(
        serde_json::from_value(
            json!({"platform":"youtube","videoId":"abcdefghijk","startMs":1540,"endMs":2900}),
        )
        .unwrap(),
    );
    c.validate().unwrap();
    assert_eq!(
        c.source_link().unwrap(),
        "https://www.youtube.com/watch?v=abcdefghijk&t=1s"
    );
    c.source.url = Some("https://example.org/watch?v=abcdefghijk".into());
    assert!(c.validate().is_err());
    c.source.video = None;
    c.source.url = Some("https://user:secret@example.org".into());
    assert!(c.validate().is_err());
    c.source.url = None;
    c.expression.as_mut().unwrap().start = 11;
    assert!(c.validate().is_err());
}
#[test]
fn removed_inbox_requires_restore_and_cannot_change_captured_context() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("removed.sqlite");
    let material = import(&p);
    let s = personal(
        &p,
        PersonalAction::SaveIntake {
            snapshot: capture(false),
        },
    );
    let iid = s.personal["intakes"][0]["id"].as_str().unwrap().to_owned();
    let s = personal(
        &p,
        PersonalAction::SetMembership {
            entity: Entity::Intake,
            id: iid.clone(),
            expected_revision: 1,
            active: false,
        },
    );
    let op = wrap(accept(capture(true), material.clone(), Some(iid.clone())));
    assert!(
        execute_at(&p, command(&s, op), now())
            .unwrap_err()
            .to_string()
            .contains("intake_removed")
    );
    let s = personal(
        &p,
        PersonalAction::SetMembership {
            entity: Entity::Intake,
            id: iid.clone(),
            expected_revision: 2,
            active: true,
        },
    );
    let mut changed = capture(true);
    changed.source.title = "rewritten".into();
    assert!(
        execute_at(
            &p,
            command(&s, wrap(accept(changed, material, Some(iid)))),
            now()
        )
        .unwrap_err()
        .to_string()
        .contains("intake_mismatch")
    );
}

#[test]
fn v7_upgrade_preserves_existing_learning_activity_and_operation_receipts() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("upgrade.sqlite");
    import(&p);
    apply(&p, CommandAction::ConfirmQuantity { quantity: 5 });
    apply(&p, CommandAction::AddToLearning);
    let before = apply(
        &p,
        CommandAction::ActivityStart {
            mode: activity::Mode::Mixed,
        },
    );
    let db = rusqlite::Connection::open(&p).unwrap();
    let receipts:String=db.query_row("SELECT json_group_array(json_object('id',id,'command',command,'result',result)) FROM operations",[],|r|r.get(0)).unwrap();
    db.execute_batch("DROP TABLE semantic_lookups; DROP TABLE semantic_identities; DROP TABLE personal_learning_links; DROP TABLE personal_intakes; DROP TABLE personal_meanings; PRAGMA user_version=7;").unwrap();
    drop(db);
    let after = open_library(&p).unwrap();
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(after).unwrap()
    );
    let db = rusqlite::Connection::open(p).unwrap();
    assert_eq!(db.query_row("SELECT json_group_array(json_object('id',id,'command',command,'result',result)) FROM operations",[],|r|r.get::<_,String>(0)).unwrap(),receipts);
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        9
    );
}
