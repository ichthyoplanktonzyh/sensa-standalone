use sensa_library::*;
use serde_json::{Value, json};
use std::path::Path;
fn formal(p: &Path, a: Value) -> Snapshot {
    let s = open_library(p).unwrap();
    execute(
        p,
        Command {
            operation_id: uuid::Uuid::new_v4().to_string(),
            library_id: s.library_id,
            expected_revision: s.revision,
            action: serde_json::from_value(a).unwrap(),
        },
    )
    .unwrap()
}
fn command(p: &Path, a: Value) -> practice::Command {
    let s = practice::query(p).unwrap();
    serde_json::from_value(json!({"operationId":uuid::Uuid::new_v4().to_string(),"libraryId":s["libraryId"],"expectedRevision":s["revision"],"action":a})).unwrap()
}
fn apply(p: &Path, a: Value) -> Value {
    practice::execute(p, command(p, a)).unwrap()
}
fn turn(p: &Path, event: Value) -> Value {
    let s = practice::query(p).unwrap();
    apply(
        p,
        json!({"kind":"turn","session_id":s["session"]["id"],"ordinal":s["session"]["state"]["ordinal"],"event":event}),
    )
}
#[test]
fn fixed_practice_scope_personal_without_enrollment_and_formal_isolation() {
    let tmp = tempfile::tempdir().unwrap();
    let p = tmp.path().join("practice.sqlite");
    formal(&p, json!({"kind":"confirm_quantity","quantity":5}));
    let pack: Value =
        serde_json::from_str(include_str!("fixtures/local-text-pack-v1.json")).unwrap();
    let s = formal(
        &p,
        json!({"kind":"import_pack","pack_json":pack.to_string()}),
    );
    let capture = json!({"sentence":"A tactful reply.","language":"en","expression":{"text":"tactful","start":2,"end":9},"source":{"url":null,"title":"synthetic","capturedAt":"2026-09-09T00:00:00Z"}});
    formal(
        &p,
        json!({"kind":"personal","action":{"kind":"accept","snapshot":capture,"material_id":s.material.unwrap().id,"intake_id":null,"focus":null,"consent":"accept_context_expression_sense"}}),
    );
    let c = practice::query(&p).unwrap();
    assert_eq!(c["catalog"]["targets"], json!([]));
    let tid = c["catalog"]["sources"][1]["targets"][0]["targetId"].clone();
    apply(
        &p,
        json!({"kind":"select","selection":{"sourceId":"personal_semantic_world","targetIds":[tid,tid,"gone"]}}),
    );
    let before = serde_json::to_value(open_library(&p).unwrap()).unwrap();
    assert!(!before["enrolled"].as_bool().unwrap());
    assert!(
        practice::execute(
            &p,
            command(
                &p,
                json!({"kind":"start","brief":"listen","provider_available":false})
            )
        )
        .is_err()
    );
    let c = command(
        &p,
        json!({"kind":"start","brief":"Listen to different speakers","provider_available":true}),
    );
    let replay = serde_json::to_value(&c).unwrap();
    let s = practice::execute(&p, c).unwrap();
    assert_eq!(
        practice::execute(&p, serde_json::from_value(replay).unwrap()).unwrap(),
        s
    );
    let sid = s["session"]["id"].clone();
    let pinned = s["session"]["snapshot"].clone();
    let ready = turn(
        &p,
        json!({"kind":"provider","status":"ready","total":3,"caption":"A [[[tactful]]] reply","video":"fixture-video","occurrence":1}),
    );
    turn(&p, json!({"kind":"play"}));
    turn(&p, json!({"kind":"replay"}));
    turn(&p, json!({"kind":"speed","rate":0.75}));
    turn(&p, json!({"kind":"next"}));
    assert!(
        practice::execute(
            &p,
            command(
                &p,
                json!({"kind":"turn","session_id":sid,"ordinal":0,"event":{"kind":"play"}})
            )
        )
        .is_err()
    );
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        before
    );
    let db = rusqlite::Connection::open(&p).unwrap();
    for table in [
        "targets",
        "runs",
        "completions",
        "memory",
        "initial_introductions",
        "local_checkins",
        "learning_activities",
        "personal_learning_links",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "{table}"
        );
    }
    // Source removal invalidates future selection but cannot rewrite a live Session.
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    formal(
        &p,
        json!({"kind":"personal","action":{"kind":"set_membership","entity":"meaning","id":m["id"],"expected_revision":m["revision"],"active":false}}),
    );
    let s = practice::query(&p).unwrap();
    assert_eq!(
        s["catalog"]["selection"],
        json!({"sourceId":"current_study"})
    );
    assert_eq!(s["session"]["snapshot"], pinned);
    assert_eq!(ready["session"]["turnCount"], 1);
    apply(&p, json!({"kind":"end","session_id":sid,"abandoned":false}));
    assert!(
        practice::execute(
            &p,
            command(
                &p,
                json!({"kind":"start","brief":"empty","provider_available":true})
            )
        )
        .unwrap_err()
        .to_string()
        .contains("empty_scope")
    );
    let other = tmp.path().join("other.sqlite");
    open_library(&other).unwrap();
    let cmd = command(
        &p,
        json!({"kind":"select","selection":{"sourceId":"current_study"}}),
    );
    assert!(
        practice::execute(&other, cmd)
            .unwrap_err()
            .to_string()
            .contains("wrong_library")
    );
    assert_eq!(practice::query(&p).unwrap()["history"][0]["turnCount"], 5);
}

fn formal_rows(p: &Path) -> Vec<(String, Vec<String>)> {
    let db = rusqlite::Connection::open(p).unwrap();
    let tables: Vec<String> = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'practice_%' ORDER BY name").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
    tables
        .into_iter()
        .map(|table| {
            let mut q = db
                .prepare(&format!("SELECT * FROM \"{table}\" ORDER BY rowid"))
                .unwrap();
            let n = q.column_count();
            let rows = q
                .query_map([], |r| {
                    Ok((0..n)
                        .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                        .collect::<Vec<_>>()
                        .join("|"))
                })
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            (table, rows)
        })
        .collect()
}
#[test]
fn active_formal_execution_and_v12_receipts_survive_practice_and_reopen() {
    let tmp = tempfile::tempdir().unwrap();
    let p = tmp.path().join("active.sqlite");
    formal(&p, json!({"kind":"confirm_quantity","quantity":5}));
    formal(
        &p,
        json!({"kind":"import_pack","pack_json":include_str!("fixtures/local-text-pack-v1.json")}),
    );
    formal(
        &p,
        json!({"kind":"curriculum","action":{"kind":"enroll","book_id":"sensa-synthetic-import-example","version":"1","range":{"kind":"all"}}}),
    );
    formal(&p, json!({"kind":"activity_start","mode":"mixed"}));
    let before = formal_rows(&p);
    let db = rusqlite::Connection::open(&p).unwrap();
    db.execute_batch("DROP TABLE native_intake_receipts; DROP TABLE agent_sessions; DROP TABLE world_bindings; DROP TABLE world_media; DROP TABLE world_drafts; DROP TABLE practice_operations; DROP TABLE practice_turns; DROP TABLE practice_sessions; DROP TABLE practice_state; PRAGMA user_version=12;").unwrap();
    drop(db);
    open_library(&p).unwrap();
    assert_eq!(formal_rows(&p), before);
    let c = practice::query(&p).unwrap();
    assert_eq!(c["catalog"]["targets"].as_array().unwrap().len(), 2);
    let start = apply(
        &p,
        json!({"kind":"start","brief":"listen alongside a paused or active lesson","provider_available":true}),
    );
    turn(
        &p,
        json!({"kind":"provider","status":"ready","total":2,"caption":null,"video":null,"occurrence":null}),
    );
    turn(&p, json!({"kind":"play"}));
    turn(&p, json!({"kind":"pause"}));
    apply(
        &p,
        json!({"kind":"select","selection":{"sourceId":"personal_semantic_world","targetIds":["removed"]}}),
    );
    let reopened = practice::query(&p).unwrap();
    assert_eq!(
        reopened["session"]["snapshot"],
        start["session"]["snapshot"]
    );
    apply(
        &p,
        json!({"kind":"end","session_id":reopened["session"]["id"],"abandoned":false}),
    );
    assert_eq!(formal_rows(&p), before);
}
#[test]
fn known_heteronyms_are_not_offered_to_unconstrained_provider() {
    let tmp = tempfile::tempdir().unwrap();
    let p = tmp.path().join("heteronym.sqlite");
    let mut pack: Value =
        serde_json::from_str(include_str!("fixtures/local-text-pack-v1.json")).unwrap();
    pack["materials"][0]["expression"] = json!("read");
    formal(
        &p,
        json!({"kind":"import_pack","pack_json":pack.to_string()}),
    );
    formal(
        &p,
        json!({"kind":"curriculum","action":{"kind":"enroll","book_id":pack["id"],"version":"1","range":{"kind":"ordinals","start":1,"end":1}}}),
    );
    let c = practice::query(&p).unwrap();
    assert_eq!(c["catalog"]["targets"], json!([]));
    assert_eq!(c["catalog"]["blockedTargets"][0]["expression"], "read");
    assert!(practice::execute(&p,command(&p,json!({"kind":"start","brief":"cannot select ambiguous pronunciation","provider_available":true}))).is_err());
}
