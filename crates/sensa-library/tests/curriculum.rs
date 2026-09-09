use chrono::{Duration, Utc};
use sensa_library::*;
use serde_json::{Value, json};
use std::path::Path;
const PACK: &str = include_str!("fixtures/local-text-pack-v1.json");
fn run(path: &Path, a: Value) -> Result<Snapshot> {
    let s = open_library(path)?;
    execute(
        path,
        Command {
            operation_id: uuid::Uuid::new_v4().to_string(),
            library_id: s.library_id,
            expected_revision: s.revision,
            action: serde_json::from_value(a).unwrap(),
        },
    )
}
fn curriculum(path: &Path, a: Value) -> Result<Snapshot> {
    run(path, json!({"kind":"curriculum","action":a}))
}
fn answer(path: &Path, action: &str) -> Snapshot {
    let s = open_library(path).unwrap();
    let r = s.run.unwrap();
    run(
        path,
        json!({"kind":"record_action","run_id":r.id,"ordinal":r.ordinal,"action":action}),
    )
    .unwrap()
}
#[test]
fn books_ranges_sources_preserve_history_and_fixed_activities() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("library.sqlite");
    run(&path, json!({"kind":"confirm_quantity","quantity":5})).unwrap();
    let s = run(&path, json!({"kind":"import_pack","pack_json":PACK})).unwrap();
    assert!(
        s.curriculum["scope"]["members"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let bid = "sensa-synthetic-import-example";
    let s=curriculum(&path,json!({"kind":"enroll","book_id":bid,"version":"1","range":{"kind":"ordinals","start":1,"end":1}})).unwrap();
    assert_eq!(
        s.curriculum["scope"]["members"].as_array().unwrap().len(),
        1
    );
    assert_eq!(s.curriculum["supplemental"], json!([]));
    let eid = s.curriculum["enrollments"][0]["id"].clone();
    let old = run(&path, json!({"kind":"activity_start","mode":"mixed"})).unwrap();
    let aid = old.learning["activity"]["id"].clone();
    let scope = old.learning["activity"]["scopeRevision"].clone();
    let tid = old.curriculum["scope"]["members"][0]["targetId"].clone();
    assert!(
        curriculum(
            &path,
            json!({"kind":"set_range","enrollment_id":eid,"range":{"kind":"all"}})
        )
        .unwrap_err()
        .to_string()
        .contains("pause_activity")
    );
    run(&path, json!({"kind":"activity_pause","activity_id":aid})).unwrap();
    let s=curriculum(&path,json!({"kind":"set_range","enrollment_id":eid,"range":{"kind":"ordinals","start":2,"end":2}})).unwrap();
    assert_eq!(
        s.curriculum["scope"]["members"].as_array().unwrap().len(),
        2
    );
    assert_eq!(s.learning["activity"]["scopeRevision"], scope);
    let s = run(&path, json!({"kind":"activity_start","mode":"mixed"})).unwrap();
    assert_eq!(s.learning["activity"]["id"], aid);
    answer(&path, "reveal");
    let s = answer(&path, "good");
    assert_eq!(s.handoff_count, 1);
    run(&path, json!({"kind":"activity_end","activity_id":aid})).unwrap();
    // Switching book versions is explicit; the prior source maintains existing work.
    let pack: Value = serde_json::from_str(PACK).unwrap();
    let b = json!({"format":"sensa-local-book-v1","id":"book-b","version":"1","title":"B","members":[{"materialId":pack["materials"][1]["id"],"section":"one"}]});
    curriculum(
        &path,
        json!({"kind":"import_book","book_json":b.to_string()}),
    )
    .unwrap();
    let s=curriculum(&path,json!({"kind":"enroll","book_id":"book-b","version":"1","range":{"kind":"section","section":"one"}})).unwrap();
    assert_eq!(s.curriculum["enrollments"][0]["mode"], "maintenance");
    assert_eq!(s.handoff_count, 1);
    let b_id = s.curriculum["enrollments"][1]["id"].clone();
    curriculum(
        &path,
        json!({"kind":"set_mode","enrollment_id":eid,"mode":"paused"}),
    )
    .unwrap();
    let s = open_library(&path).unwrap();
    assert!(
        s.curriculum["scope"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["targetId"] != tid)
    );
    run(
        &path,
        json!({"kind":"select_material","material_id":pack["materials"][0]["id"]}),
    )
    .unwrap();
    assert!(
        run(&path, json!({"kind":"start_or_resume"}))
            .unwrap_err()
            .to_string()
            .contains("outside_study_scope")
    );
    // Explicit supplemental learning is independent of its book and deduplicates at the target.
    let s = run(&path, json!({"kind":"add_to_learning"})).unwrap();
    assert_eq!(s.handoff_count, 1);
    assert_eq!(s.curriculum["supplemental"].as_array().unwrap().len(), 1);
    curriculum(
        &path,
        json!({"kind":"set_mode","enrollment_id":eid,"mode":"maintenance"}),
    )
    .unwrap();
    let s = curriculum(
        &path,
        json!({"kind":"supplemental","target_id":tid,"active":false}),
    )
    .unwrap();
    assert_eq!(s.handoff_count, 1);
    assert!(
        s.curriculum["scope"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["targetId"] == tid)
    );
    let s = curriculum(&path, json!({"kind":"select_sources","source_ids":[b_id]})).unwrap();
    assert_eq!(
        s.curriculum["scope"]["members"].as_array().unwrap().len(),
        1
    );
    let s = run(&path, json!({"kind":"activity_fresh","mode":"mixed"})).unwrap();
    assert_ne!(s.learning["activity"]["id"], aid);
    assert_eq!(s.material.unwrap().expression, "borrow");
    answer(&path, "reveal");
    let s = answer(&path, "good");
    assert_eq!(s.completion_count, 2);
    assert_eq!(s.handoff_count, 2);
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM targets", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM curriculum_introduction_sources",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
    assert_eq!(
        serde_json::to_value(open_library(&path).unwrap()).unwrap(),
        serde_json::to_value(s).unwrap()
    );
}
#[test]
fn history_reads_all_completions_with_filters_cursor_and_no_writes() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("history.sqlite");
    let mut now = Utc::now() - Duration::days(3);
    let mut pack: Value = serde_json::from_str(PACK).unwrap();
    let template = pack["materials"][0].clone();
    pack["materials"] = json!(
        (0..45)
            .map(|i| {
                let mut m = template.clone();
                for key in ["id", "senseVersionId", "bindingVersionId"] {
                    m[key] = json!(uuid::Uuid::new_v4().to_string());
                }
                m["expression"] = json!(format!("target-{i:02}"));
                m
            })
            .collect::<Vec<_>>()
    );
    let execute = |a: Value| {
        let s = open_library(&path).unwrap();
        execute_at_offset(
            &path,
            Command {
                operation_id: uuid::Uuid::new_v4().to_string(),
                library_id: s.library_id,
                expected_revision: s.revision,
                action: serde_json::from_value(a).unwrap(),
            },
            now,
            480,
        )
        .unwrap()
    };
    execute(json!({"kind":"confirm_quantity","quantity":30}));
    execute(json!({"kind":"import_pack","pack_json":pack.to_string()}));
    for (i, m) in pack["materials"].as_array().unwrap().iter().enumerate() {
        if i == 30 {
            now += Duration::days(1);
        }
        for a in [
            json!({"kind":"select_material","material_id":m["id"]}),
            json!({"kind":"add_to_learning"}),
            json!({"kind":"start_or_resume"}),
        ] {
            let s = open_library(&path).unwrap();
            execute_at_offset(
                &path,
                Command {
                    operation_id: uuid::Uuid::new_v4().to_string(),
                    library_id: s.library_id,
                    expected_revision: s.revision,
                    action: serde_json::from_value(a).unwrap(),
                },
                now,
                480,
            )
            .unwrap();
        }
        for a in ["reveal", "good"] {
            let s = open_library(&path).unwrap();
            let r = s.run.as_ref().unwrap();
            execute_at_offset(&path,Command{operation_id:uuid::Uuid::new_v4().to_string(),library_id:s.library_id,expected_revision:s.revision,action:serde_json::from_value(json!({"kind":"record_action","run_id":r.id,"ordinal":r.ordinal,"action":a})).unwrap()},now,480).unwrap();
        }
    }
    let before = open_library(&path).unwrap();
    let query = |search: &str, cursor: Value| {
        history::query(&path,serde_json::from_value(json!({"start":null,"end":null,"kind":null,"search":search,"cursor":cursor,"offsetMinutes":480})).unwrap())
    };
    let first = query("", Value::Null).unwrap();
    assert_eq!(first["counts"]["initial_learning"], 45);
    assert_eq!(first["records"].as_array().unwrap().len(), 40);
    let second = query("", first["nextCursor"].clone()).unwrap();
    assert_eq!(second["records"].as_array().unwrap().len(), 5);
    assert!(second["nextCursor"].is_null());
    assert_eq!(
        query("target-44", Value::Null).unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(open_library(&path).unwrap()).unwrap()
    );
    run(
        &path,
        json!({"kind":"check_in","activity_id":null,"execution_id":null,"entry_operation_id":null}),
    )
    .unwrap();
    assert!(
        query("", first["nextCursor"].clone())
            .unwrap_err()
            .to_string()
            .contains("history_changed")
    );
    assert_eq!(
        query("", Value::Null).unwrap()["checkins"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn immutable_versions_explicit_selection_supplemental_order_and_empty_scope() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("versions.sqlite");
    run(&path, json!({"kind":"confirm_quantity","quantity":5})).unwrap();
    run(&path, json!({"kind":"import_pack","pack_json":PACK})).unwrap();
    let pack: Value = serde_json::from_str(PACK).unwrap();
    let ids: Vec<_> = pack["materials"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].clone())
        .collect();
    for mid in &ids {
        run(&path, json!({"kind":"select_material","material_id":mid})).unwrap();
        run(&path, json!({"kind":"add_to_learning"})).unwrap();
    }
    let s = open_library(&path).unwrap();
    let first = s.curriculum["supplemental"][0]["targetId"].clone();
    let second = s.curriculum["supplemental"][1]["targetId"].clone();
    curriculum(
        &path,
        json!({"kind":"move_supplemental","target_id":second,"before_target_id":first}),
    )
    .unwrap();
    let s = run(&path, json!({"kind":"activity_fresh","mode":"mixed"})).unwrap();
    assert_eq!(s.material.unwrap().id, ids[1].as_str().unwrap());
    run(
        &path,
        json!({"kind":"activity_end","activity_id":s.learning["activity"]["id"]}),
    )
    .unwrap();
    for tid in [&first, &second] {
        curriculum(
            &path,
            json!({"kind":"supplemental","target_id":tid,"active":false}),
        )
        .unwrap();
    }
    let mut book = json!({"format":"sensa-local-book-v1","id":"versions","version":"1","title":"Versioned","members":[{"materialId":ids[0],"section":"a"},{"materialId":ids[1],"section":"b"}]});
    curriculum(
        &path,
        json!({"kind":"import_book","book_json":book.to_string()}),
    )
    .unwrap();
    let s=curriculum(&path,json!({"kind":"enroll","book_id":"versions","version":"1","range":{"kind":"selection","material_ids":[ids[0]]}})).unwrap();
    let eid = s.curriculum["enrollments"][0]["id"].clone();
    // The earlier reserved borrow run survives range restriction.
    assert_eq!(
        s.curriculum["scope"]["members"].as_array().unwrap().len(),
        2
    );
    assert_eq!(
        s.curriculum["scope"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["newEligible"] == true)
            .count(),
        1
    );
    run(
        &path,
        json!({"kind":"select_material","material_id":ids[0]}),
    )
    .unwrap();
    let s = run(&path, json!({"kind":"add_to_learning"})).unwrap();
    assert_eq!(s.curriculum["supplemental"][1]["active"], false); // already covered by Book
    let before = serde_json::to_value(&s).unwrap();
    book["title"] = json!("illegal replacement");
    assert!(
        curriculum(
            &path,
            json!({"kind":"import_book","book_json":book.to_string()})
        )
        .unwrap_err()
        .to_string()
        .contains("book_version_conflict")
    );
    for range in [
        json!({"kind":"ordinals","start":0,"end":1}),
        json!({"kind":"section","section":"absent"}),
        json!({"kind":"selection","material_ids":[ids[0],ids[0]]}),
    ] {
        assert!(
            curriculum(
                &path,
                json!({"kind":"set_range","enrollment_id":eid,"range":range})
            )
            .is_err()
        );
    }
    assert_eq!(
        serde_json::to_value(open_library(&path).unwrap()).unwrap(),
        before
    );
    book["version"] = json!("2");
    book["title"] = json!("Versioned 2");
    curriculum(
        &path,
        json!({"kind":"import_book","book_json":book.to_string()}),
    )
    .unwrap();
    assert_eq!(
        open_library(&path).unwrap().curriculum["enrollments"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let s = curriculum(
        &path,
        json!({"kind":"enroll","book_id":"versions","version":"2","range":{"kind":"all"}}),
    )
    .unwrap();
    assert_eq!(s.curriculum["enrollments"][0]["mode"], "maintenance");
    assert_eq!(s.curriculum["enrollments"][1]["mode"], "active");
    assert_eq!(
        s.curriculum["scope"]["members"].as_array().unwrap().len(),
        2
    );
    curriculum(&path, json!({"kind":"select_sources","source_ids":[]})).unwrap();
    let s = run(&path, json!({"kind":"activity_fresh","mode":"mixed"})).unwrap();
    assert_eq!(s.learning["activity"]["immediateAvailable"], false);
    assert_eq!(s.learning["newStartedToday"], 0);
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM targets", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[test]
fn v11_upgrade_keeps_fixed_activity_facts_and_original_receipts() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("v11.sqlite");
    run(&path, json!({"kind":"confirm_quantity","quantity":5})).unwrap();
    run(&path, json!({"kind":"import_pack","pack_json":PACK})).unwrap();
    run(&path, json!({"kind":"add_to_learning"})).unwrap();
    run(&path, json!({"kind":"activity_start","mode":"mixed"})).unwrap();
    let before = answer(&path, "reveal");
    let db = rusqlite::Connection::open(&path).unwrap();
    let receipts:String=db.query_row("SELECT json_group_array(json_object('id',id,'command',command,'result',result)) FROM operations",[],|r|r.get(0)).unwrap();
    db.execute_batch("DROP TABLE practice_operations; DROP TABLE practice_turns; DROP TABLE practice_sessions; DROP TABLE practice_state; DROP TABLE curriculum_introduction_sources; DROP TABLE activity_scope_sources; DROP TABLE curriculum_scopes; DROP TABLE curriculum_settings; DROP TABLE curriculum_supplemental; DROP TABLE curriculum_members; DROP TABLE curriculum_enrollments; DROP TABLE curriculum_books; ALTER TABLE activity_scope DROP COLUMN new_eligible; PRAGMA user_version=11;").unwrap();
    drop(db);
    let mut before = serde_json::to_value(before).unwrap();
    let mut after = serde_json::to_value(open_library(&path).unwrap()).unwrap();
    before.as_object_mut().unwrap().remove("curriculum");
    after.as_object_mut().unwrap().remove("curriculum");
    assert_eq!(before, after);
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(db.query_row("SELECT json_group_array(json_object('id',id,'command',command,'result',result)) FROM operations",[],|r|r.get::<_,String>(0)).unwrap(),receipts);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM curriculum_introduction_sources",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(answer(&path, "good").completion_count, 1);
}

#[test]
fn source_filter_controls_review_and_relearning_history_counts_real_outcomes() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("purposes.sqlite");
    let at = |a: Value, t| {
        let s = open_library(&path).unwrap();
        execute_at_offset(
            &path,
            Command {
                operation_id: uuid::Uuid::new_v4().to_string(),
                library_id: s.library_id,
                expected_revision: s.revision,
                action: serde_json::from_value(a).unwrap(),
            },
            t,
            480,
        )
    };
    let answer = |a: &str, t| {
        let r = open_library(&path).unwrap().run.unwrap();
        at(
            json!({"kind":"record_action","run_id":r.id,"ordinal":r.ordinal,"action":a}),
            t,
        )
        .unwrap()
    };
    let now = Utc::now() - Duration::days(30);
    at(json!({"kind":"confirm_quantity","quantity":5}), now).unwrap();
    at(json!({"kind":"import_pack","pack_json":PACK}), now).unwrap();
    at(json!({"kind":"add_to_learning"}), now).unwrap();
    at(json!({"kind":"start_or_resume"}), now).unwrap();
    answer("reveal", now);
    let s = answer("good", now);
    let due = chrono::DateTime::from_timestamp_millis(s.due_at_ms.unwrap()).unwrap();
    at(
        json!({"kind":"curriculum","action":{"kind":"select_sources","source_ids":[]}}),
        due,
    )
    .unwrap();
    assert!(
        at(json!({"kind":"start_retention","early":false}), due)
            .unwrap_err()
            .to_string()
            .contains("outside_study_scope")
    );
    at(
        json!({"kind":"curriculum","action":{"kind":"select_sources","source_ids":null}}),
        due,
    )
    .unwrap();
    at(json!({"kind":"activity_start","mode":"review_only"}), due).unwrap();
    answer("reveal", due);
    answer("again", due);
    let aid = open_library(&path).unwrap().learning["activity"]["id"].clone();
    at(
        json!({"kind":"activity_next","activity_id":aid,"early":true}),
        due,
    )
    .unwrap();
    answer("reveal", due);
    let s = answer("good", due);
    assert_eq!(s.learning["newStartedToday"], 0);
    let query = |kind: Value, start: Value, end: Value| {
        history::query(&path,serde_json::from_value(json!({"kind":kind,"start":start,"end":end,"search":"","cursor":null,"offsetMinutes":480})).unwrap())
    };
    let all = query(Value::Null, Value::Null, Value::Null).unwrap();
    assert_eq!(
        all["counts"],
        json!({"initial_learning":1,"retention_review":1,"relearning":1})
    );
    assert_eq!(all["records"].as_array().unwrap().len(), 3);
    assert_eq!(
        query(json!("relearning"), Value::Null, Value::Null).unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let day = (now + Duration::hours(8)).format("%Y-%m-%d").to_string();
    assert_eq!(
        query(Value::Null, json!(day), json!(day)).unwrap()["counts"],
        json!({"initial_learning":1})
    );
    assert!(query(Value::Null, json!("2099-01-01"), Value::Null).is_err());
    let other = tmp.path().join("empty.sqlite");
    open_library(&other).unwrap();
    assert_eq!(
        history::query(
            &other,
            serde_json::from_value(
                json!({"kind":null,"start":null,"end":null,"cursor":null,"offsetMinutes":480})
            )
            .unwrap()
        )
        .unwrap()["records"],
        json!([])
    );
}
