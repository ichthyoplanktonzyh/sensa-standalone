use chrono::{TimeZone, Utc};
use sensa_library::{world, *};
use serde_json::{Value, json};
use std::path::Path;
fn command(p: &Path, a: Value) -> Command {
    let s = open_library(p).unwrap();
    Command {
        operation_id: uuid::Uuid::new_v4().to_string(),
        library_id: s.library_id,
        expected_revision: s.revision,
        action: serde_json::from_value(a).unwrap(),
    }
}
fn apply(p: &Path, a: Value) -> Snapshot {
    execute_at(
        p,
        command(p, a),
        Utc.with_ymd_and_hms(2026, 9, 9, 1, 0, 0).unwrap(),
    )
    .unwrap()
}
fn w(a: Value) -> Value {
    json!({"kind":"world","action":a})
}
fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn draft(text: &str) -> Value {
    json!({"blocks":[{"kind":"text","id":uid(),"text":text}],"familiarExpression":"","startingPoint":null})
}
fn save(p: &Path, id: &str, rev: u32, d: Value, submit: bool) -> Snapshot {
    apply(
        p,
        w(json!({"kind":"save","id":id,"expected_revision":rev,"draft":d,"submit":submit})),
    )
}
fn resolve(p: &Path, id: &str, rev: u32, source: Value) -> Snapshot {
    apply(
        p,
        w(
            json!({"kind":"resolve","id":id,"expected_revision":rev,"source":source,"consent":"accept_context_expression_sense"}),
        ),
    )
}
fn reject(p: &Path, a: Value, code: &str) {
    let before = serde_json::to_value(open_library(p).unwrap()).unwrap();
    let e = execute_at(
        p,
        command(p, a),
        Utc.with_ymd_and_hms(2026, 9, 9, 1, 0, 0).unwrap(),
    )
    .unwrap_err();
    assert!(e.to_string().contains(code), "{e}");
    assert_eq!(
        serde_json::to_value(open_library(p).unwrap()).unwrap(),
        before
    );
}
fn formal(p: &Path) -> Value {
    let db = rusqlite::Connection::open(p).unwrap();
    let mut q=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('library','operations','personal_meanings','world_drafts','world_media','world_bindings') ORDER BY name").unwrap();
    let names = q
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    let mut result = serde_json::Map::new();
    for n in names {
        let mut q = db
            .prepare(&format!("SELECT * FROM \"{n}\" ORDER BY rowid"))
            .unwrap();
        let count = q.column_count();
        let rows = q
            .query_map([], |r| {
                Ok((0..count)
                    .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                    .collect::<Vec<_>>())
            })
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        result.insert(n, json!(rows));
    }
    json!(result)
}
#[test]
fn draft_media_multiple_senses_cas_freeze_membership_and_cold_read() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("world.db");
    let s = apply(
        &p,
        json!({"kind":"import_pack","pack_json":include_str!("fixtures/local-text-pack-v1.json")}),
    );
    let mid = &s.catalog[0].material.id;
    let other = &s.catalog[1].material.id;
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    apply(&p, json!({"kind":"add_to_learning"}));
    apply(&p, json!({"kind":"activity_start","mode":"mixed"}));
    let before = formal(&p);
    let id = uid();
    save(&p, &id, 0, draft(""), false);
    assert_eq!(world::query(&p).unwrap()["meanings"], json!([]));
    reject(
        &p,
        w(
            json!({"kind":"resolve","id":id,"expected_revision":1,"source":{"kind":"material","id":mid},"consent":"accept_context_expression_sense"}),
        ),
        "empty_world_context",
    );
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let bytes = bytes.into_inner();
    let digest = world::put_media(&p, &bytes).unwrap();
    assert_eq!(digest, world::put_media(&p, &bytes).unwrap());
    assert_eq!(world::media(&p, &digest).unwrap(), bytes);
    assert!(world::put_media(&p, b"not an image").is_err());
    assert!(world::media(&dir.path().join("other.db"), &digest).is_err());
    let mut d = draft("面对面交流的上下文");
    d["blocks"]
        .as_array_mut()
        .unwrap()
        .push(json!({"kind":"image","id":uid(),"digest":digest}));
    save(&p, &id, 1, d.clone(), true);
    reject(
        &p,
        w(json!({"kind":"save","id":id,"expected_revision":1,"draft":d,"submit":false})),
        "draft_conflict",
    );
    let accepted = resolve(&p, &id, 2, json!({"kind":"material","id":mid}));
    let m = accepted.personal["meanings"][0].clone();
    assert!(m["focus"].is_null());
    assert_eq!(m["worldContext"]["draft"], d);
    assert_eq!(m["addedToLearning"], false);
    resolve(&p, &id, 2, json!({"kind":"material","id":mid}));
    let s = resolve(&p, &id, 2, json!({"kind":"material","id":other}));
    assert_eq!(s.personal["meanings"].as_array().unwrap().len(), 2);
    assert_eq!(
        s.personal["meanings"][0]["contextAnchorId"],
        s.personal["meanings"][1]["contextAnchorId"]
    );
    reject(
        &p,
        w(
            json!({"kind":"save","id":id,"expected_revision":2,"draft":draft("overwrite"),"submit":false}),
        ),
        "draft_frozen",
    );
    let copied = uid();
    save(&p, &copied, 0, draft("new version"), true);
    resolve(&p, &copied, 1, json!({"kind":"material","id":mid}));
    assert_eq!(
        world::query(&p).unwrap()["meanings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == m["id"])
            .unwrap(),
        &m
    );
    let action = w(
        json!({"kind":"meaning_membership","meaning_id":m["id"],"expected_revision":m["revision"],"active":false}),
    );
    let c = command(&p, action);
    let at = Utc.with_ymd_and_hms(2026, 9, 9, 1, 0, 0).unwrap();
    let removed = execute_at(&p, c.clone(), at).unwrap();
    assert_eq!(
        serde_json::to_value(execute_at(&p, c, at).unwrap()).unwrap(),
        serde_json::to_value(removed).unwrap()
    );
    apply(
        &p,
        w(
            json!({"kind":"meaning_membership","meaning_id":m["id"],"expected_revision":2,"active":true}),
        ),
    );
    assert_eq!(formal(&p), before);
    assert_eq!(
        world::query(&p).unwrap()["drafts"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let s = open_library(&p).unwrap();
    let mut c = command(
        &p,
        w(json!({"kind":"membership","id":id,"expected_revision":2,"active":false})),
    );
    c.library_id = uid();
    assert!(
        execute_at(&p, c, at)
            .unwrap_err()
            .to_string()
            .contains("library_mismatch")
    );
    assert_eq!(open_library(&p).unwrap().revision, s.revision);
}
fn semantic(p: &Path) -> Value {
    let id = uid();
    apply(
        p,
        json!({"kind":"semantic","action":{"kind":"begin","id":id,"snapshot":{"sentence":"The crane lifted it.","language":"en","expression":{"text":"crane","start":4,"end":9},"source":{"url":null,"title":"fixture","capturedAt":"2026-09-09T00:00:00Z"}},"intake_id":null,"previous_id":null,"clarification":null}}),
    );
    let s = open_library(p).unwrap();
    let req = &s.personal["lookups"][0]["request"];
    let proposal = json!({"explanation":"起重机","expression":{"surface":"crane","type":"word","language":"en"},"semanticSpec":{"schemaVersion":"sensa-sense-semantic-spec-v1","coreMeaningFocus":"A machine for lifting heavy loads.","prototypeScenes":[{"summary":"A machine lifts a heavy load.","participantRoles":["machine","load"],"states":[],"directionOrCausality":null}],"includedCases":[],"excludedCases":["a bird"],"neighborContrasts":[],"openQuestions":[]}});
    apply(
        p,
        json!({"kind":"semantic","action":{"kind":"finish","result":{"version":"sensa-native-semantic-v1","id":id,"inputDigest":req["inputDigest"],"status":"ready","provenance":{"provider":"fixture","model":"no-cost","policyVersion":"consumer-semantic-v4","outputDigest":sensa_library::semantic::hash(&proposal).unwrap()},"proposal":proposal}}}),
    );
    apply(p,json!({"kind":"semantic","action":{"kind":"accept","id":id,"consent":"accept_context_expression_sense"}})).personal["meanings"][0].clone()
}
#[test]
fn bindings_reuse_sense_keep_old_target_and_require_explicit_supported_learning() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("bindings.db");
    let mut m = semantic(&p);
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    let admitted = apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","meaning_id":m["id"],"expected_revision":m["revision"],"policy":{"profileId":"lightweight","profileVersion":"v1"}}}),
    );
    m = admitted.personal["meanings"][0].clone();
    let before = formal(&p);
    let bind = |surface: &str, relation: &str, coverage: &str| {
        w(
            json!({"kind":"bind","meaning_id":m["id"],"expected_revision":m["revision"],"surface":surface,"expression_type":"word","relation":relation,"coverage":coverage,"consent":"confirm_expression_binding"}),
        )
    };
    apply(&p, bind("crane", "realizes", "exact"));
    assert_eq!(
        world::query(&p).unwrap()["meanings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let s = apply(&p, bind("derrick", "realizes", "exact"));
    let branch = s.personal["meanings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["expression"] == "derrick")
        .unwrap()
        .clone();
    assert_eq!(branch["senseVersionId"], m["senseVersionId"]);
    assert_ne!(branch["bindingVersionId"], m["bindingVersionId"]);
    assert!(branch["materialId"].is_null());
    assert_eq!(branch["addedToLearning"], false);
    apply(&p, bind("derrick", "realizes", "exact"));
    assert_eq!(
        world::query(&p).unwrap()["meanings"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let s = apply(&p, bind("hoist", "approximates", "broader"));
    let broad = s.personal["meanings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["expression"] == "hoist")
        .unwrap();
    assert_eq!(formal(&p), before);
    let prepared = apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","policy":{"profileId":"lightweight","profileVersion":"v1"},"meaning_id":broad["id"],"expected_revision":broad["revision"]}}),
    );
    assert_eq!(
        prepared.personal["preparations"][0]["target"]["binding"]["semanticCoverage"],
        "broader"
    );
    assert!(prepared.run.is_none());
    let s = apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","policy":{"profileId":"lightweight","profileVersion":"v1"},"meaning_id":branch["id"],"expected_revision":branch["revision"]}}),
    );
    assert_eq!(
        s.personal["meanings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == m["id"])
            .unwrap(),
        &m
    );
}
#[test]
fn schema13_upgrade_preserves_facts_and_receipts() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("upgrade.db");
    let _ = semantic(&p);
    let before = serde_json::to_value(open_library(&p).unwrap()).unwrap();
    let db = rusqlite::Connection::open(&p).unwrap();
    db.execute_batch("DROP TABLE agent_sessions; DROP TABLE world_bindings; DROP TABLE world_media; DROP TABLE world_drafts; PRAGMA user_version=13;").unwrap();
    drop(db);
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        before
    );
    assert_eq!(world::query(&p).unwrap()["drafts"], json!([]));
}
