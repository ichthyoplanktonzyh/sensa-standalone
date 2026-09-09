use chrono::{Duration, TimeZone, Utc};
use sensa_library::{
    personal::Capture,
    semantic::{self, Action},
    *,
};
use serde_json::{Value, json};
fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 9, 1, 0, 0).unwrap()
}
fn capture(sentence: &str) -> Capture {
    serde_json::from_value(json!({"sentence":sentence,"language":"en","source":{"url":null,"title":"native","capturedAt":"2026-09-09T00:00:00Z"},"expression":{"text":"crane","start":4,"end":9}})).unwrap()
}
fn proposal() -> Value {
    json!({"explanation":"这里指起重机。","expression":{"surface":"crane","type":"word","language":"en"},"semanticSpec":{"schemaVersion":"sensa-sense-semantic-spec-v1","coreMeaningFocus":"A machine for lifting heavy loads.","prototypeScenes":[{"summary":"A machine lifts a heavy load.","participantRoles":["machine","load"],"states":[],"directionOrCausality":null}],"includedCases":[],"excludedCases":["a bird"],"neighborContrasts":[],"openQuestions":[]}})
}
fn cmd(s: &Snapshot, a: Action) -> Command {
    Command {
        operation_id: uuid::Uuid::new_v4().to_string(),
        library_id: s.library_id.clone(),
        expected_revision: s.revision,
        action: CommandAction::Semantic {
            action: Box::new(a),
        },
    }
}
fn apply(p: &std::path::Path, a: Action) -> Snapshot {
    let s = open_library(p).unwrap();
    execute_at(p, cmd(&s, a), now()).unwrap()
}
fn begin(
    p: &std::path::Path,
    snapshot: Capture,
    previous: Option<String>,
    focus: Option<&str>,
) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    apply(
        p,
        Action::Begin {
            id: id.clone(),
            snapshot: Box::new(snapshot),
            intake_id: None,
            previous_id: previous,
            clarification: focus.map(str::to_owned),
        },
    );
    id
}
fn lookup(p: &std::path::Path, id: &str) -> Value {
    open_library(p).unwrap().personal["lookups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id)
        .unwrap()
        .clone()
}
fn result(p: &std::path::Path, id: &str, proposal: Value) -> Value {
    let job = lookup(p, id);
    json!({"version":"sensa-native-semantic-v1","id":id,"inputDigest":job["request"]["inputDigest"],"status":if proposal.is_null(){"unresolved"}else{"ready"},"provenance":{"provider":"fixture","model":"no-cost","policyVersion":"consumer-semantic-v4","outputDigest":semantic::hash(&proposal).unwrap()},"proposal":proposal})
}
fn reject(p: &std::path::Path, a: Action, expected: &str) {
    let before = open_library(p).unwrap();
    let e = execute_at(p, cmd(&before, a), now()).unwrap_err();
    assert!(e.to_string().contains(expected), "{e}");
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(open_library(p).unwrap()).unwrap()
    );
}
#[test]
fn clarification_late_results_offline_acceptance_and_stable_identity() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("library.sqlite");
    let c = capture("The crane lifted it.");
    let first = begin(&p, c.clone(), None, None);
    assert!(lookup(&p, &first)["focus"].is_null());
    apply(
        &p,
        Action::Finish {
            result: result(&p, &first, Value::Null),
        },
    );
    reject(
        &p,
        Action::Accept {
            id: first.clone(),
            consent: "accept_context_expression_sense".into(),
        },
        "lookup_not_ready",
    );
    let second = begin(&p, c.clone(), Some(first.clone()), Some("lifting machine"));
    assert_eq!(lookup(&p, &second)["focus"]["previousLookupId"], first);
    reject(
        &p,
        Action::Finish {
            result: result(&p, &first, proposal()),
        },
        "lookup_superseded",
    );
    let mut wrong = result(&p, &second, proposal());
    wrong["inputDigest"] = json!("0".repeat(64));
    reject(
        &p,
        Action::Finish { result: wrong },
        "lookup_input_mismatch",
    );
    let mut wrong = proposal();
    wrong["expression"]["surface"] = json!("bird");
    reject(
        &p,
        Action::Finish {
            result: result(&p, &second, wrong),
        },
        "expression_binding_mismatch",
    );
    apply(
        &p,
        Action::Finish {
            result: result(&p, &second, proposal()),
        },
    );
    let before = open_library(&p).unwrap();
    let acceptance = cmd(
        &before,
        Action::Accept {
            id: second.clone(),
            consent: "accept_context_expression_sense".into(),
        },
    );
    let s = execute_at(&p, acceptance.clone(), now()).unwrap();
    let m = &s.personal["meanings"][0];
    assert!(m["materialId"].is_null());
    assert_eq!(m["focus"], "lifting machine");
    assert_eq!(s.learning, before.learning);
    assert_eq!(
        serde_json::to_value(execute_at(&p, acceptance, now()).unwrap()).unwrap(),
        serde_json::to_value(&s).unwrap()
    );
    let other = begin(&p, capture("The crane moved it."), None, None);
    apply(
        &p,
        Action::Finish {
            result: result(&p, &other, proposal()),
        },
    );
    let s = apply(
        &p,
        Action::Accept {
            id: other,
            consent: "accept_context_expression_sense".into(),
        },
    );
    let meanings = s.personal["meanings"].as_array().unwrap();
    assert_eq!(meanings.len(), 2);
    assert_eq!(meanings[0]["senseVersionId"], meanings[1]["senseVersionId"]);
    assert_eq!(
        meanings[0]["bindingVersionId"],
        meanings[1]["bindingVersionId"]
    );
}
#[test]
fn failures_expiry_and_removed_intake_do_not_create_meanings() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("library.sqlite");
    let id = begin(&p, capture("The crane lifted it."), None, None);
    apply(
        &p,
        Action::Fail {
            id: id.clone(),
            reason: "network_unavailable".into(),
        },
    );
    let retry = begin(&p, capture("The crane lifted it."), Some(id), None);
    assert!(lookup(&p, &retry)["focus"].is_null());
    apply(
        &p,
        Action::Finish {
            result: result(&p, &retry, proposal()),
        },
    );
    let s = open_library(&p).unwrap();
    let e = execute_at(
        &p,
        cmd(
            &s,
            Action::Accept {
                id: retry,
                consent: "accept_context_expression_sense".into(),
            },
        ),
        now() + Duration::days(1),
    )
    .unwrap_err();
    assert!(e.to_string().contains("lookup_expired"));
    assert_eq!(open_library(&p).unwrap().personal["meanings"], json!([]));
}
#[test]
fn v8_upgrade_preserves_existing_facts() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("library.sqlite");
    let before = open_library(&p).unwrap();
    let db = rusqlite::Connection::open(&p).unwrap();
    db.execute_batch(
        "DROP TABLE world_bindings; DROP TABLE world_media; DROP TABLE world_drafts; DROP TABLE practice_operations; DROP TABLE practice_turns; DROP TABLE practice_sessions; DROP TABLE practice_state; DROP TABLE curriculum_introduction_sources; DROP TABLE activity_scope_sources; DROP TABLE curriculum_scopes; DROP TABLE curriculum_settings; DROP TABLE curriculum_supplemental; DROP TABLE curriculum_members; DROP TABLE curriculum_enrollments; DROP TABLE curriculum_books; ALTER TABLE activity_scope DROP COLUMN new_eligible; DROP TABLE personal_anchor_revocations; DROP TABLE personal_anchor_grants; DROP TABLE personal_preparation_versions; DROP TABLE personal_task_entries; DROP TABLE personal_content_attempts; DROP TABLE personal_learning_tasks; DROP TABLE semantic_lookups; DROP TABLE semantic_identities; PRAGMA user_version=8;",
    )
    .unwrap();
    drop(db);
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(open_library(&p).unwrap()).unwrap()
    );
}

#[test]
fn intake_removal_blocks_acceptance_then_restore_closes_original_context_only_intake() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("library.sqlite");
    fn raw(p: &std::path::Path, a: Value) -> Snapshot {
        let s = open_library(p).unwrap();
        let c = Command {
            operation_id: uuid::Uuid::new_v4().to_string(),
            library_id: s.library_id.clone(),
            expected_revision: s.revision,
            action: serde_json::from_value(a).unwrap(),
        };
        execute_at(p, c, now()).unwrap()
    }
    let resolved = capture("The crane lifted it.");
    let mut original = resolved.clone();
    original.expression = None;
    let s = raw(
        &p,
        json!({"kind":"personal","action":{"kind":"save_intake","snapshot":original}}),
    );
    let intake = s.personal["intakes"][0]["id"].as_str().unwrap().to_owned();
    let id = uuid::Uuid::new_v4().to_string();
    apply(
        &p,
        Action::Begin {
            id: id.clone(),
            snapshot: Box::new(resolved),
            intake_id: Some(intake.clone()),
            previous_id: None,
            clarification: None,
        },
    );
    let mut forged = result(&p, &id, proposal());
    forged["provenance"]["outputDigest"] = json!("f".repeat(64));
    reject(&p, Action::Finish { result: forged }, "invalid_provenance");
    apply(
        &p,
        Action::Finish {
            result: result(&p, &id, proposal()),
        },
    );
    raw(
        &p,
        json!({"kind":"personal","action":{"kind":"set_membership","entity":"intake","id":intake,"expected_revision":1,"active":false}}),
    );
    reject(
        &p,
        Action::Accept {
            id: id.clone(),
            consent: "accept_context_expression_sense".into(),
        },
        "intake_removed",
    );
    raw(
        &p,
        json!({"kind":"personal","action":{"kind":"set_membership","entity":"intake","id":intake,"expected_revision":2,"active":true}}),
    );
    let s = apply(
        &p,
        Action::Accept {
            id,
            consent: "accept_context_expression_sense".into(),
        },
    );
    assert_eq!(s.personal["intakes"][0]["status"], "confirmed");
    assert_eq!(s.personal["intakes"][0]["snapshot"], json!(original));
    assert_eq!(
        s.personal["intakes"][0]["meaningId"],
        s.personal["meanings"][0]["id"]
    );
    assert!(s.personal["meanings"][0]["focus"].is_null());
}
