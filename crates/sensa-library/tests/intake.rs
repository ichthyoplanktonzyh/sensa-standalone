use sensa_library::{intake::Request, *};
use serde_json::{Value, json};
fn proposal() -> Value {
    json!({"explanation":"临时借用","expression":{"surface":"borrow","type":"word","language":"en"},"semanticSpec":{"schemaVersion":"sensa-sense-semantic-spec-v1","coreMeaningFocus":"临时取得并归还","prototypeScenes":[{"summary":"向朋友借伞后归还","participantRoles":[],"states":[],"directionOrCausality":null}],"includedCases":[],"excludedCases":[],"neighborContrasts":[],"openQuestions":[]}})
}
fn request(path: &std::path::Path) -> Request {
    serde_json::from_value(json!({"version":"sensa-intake-v1","libraryId":open_library(path).unwrap().library_id,"clientId":uuid::Uuid::new_v4().to_string(),"operationId":uuid::Uuid::new_v4().to_string(),"snapshot":{"sentence":"May I borrow your umbrella?","language":"en","source":{"url":"https://www.youtube.com/watch?v=abcdefghijk","title":"Synthetic video","capturedAt":"2026-09-09T00:00:00Z","video":{"platform":"youtube","videoId":"abcdefghijk","startMs":1200,"endMs":3400}},"expression":{"text":"borrow","start":6,"end":12}},"resolution":null,"acceptance":null})).unwrap()
}
#[test]
fn atomic_receipts_fast_slow_retries_and_scope() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let other = dir.path().join("other.sqlite");
    open_library(&other).unwrap();
    let mut r = request(&path);
    let first = intake::submit(&path, &r).unwrap();
    assert_eq!(first["status"], "pending");
    let initial = open_library(&path).unwrap();
    assert_eq!(initial.personal["intakes"].as_array().unwrap().len(), 1);
    assert!(initial.catalog.is_empty());
    assert_eq!(intake::submit(&path, &r).unwrap(), first);
    assert_eq!(open_library(&path).unwrap().revision, initial.revision);
    assert_eq!(
        intake::receipt(&path, &r.library_id, &r.client_id, &r.operation_id).unwrap(),
        Some(first)
    );
    assert!(
        intake::submit(&other, &r)
            .unwrap_err()
            .to_string()
            .contains("library_mismatch")
    );
    let old = r.clone();
    r.snapshot.source.title = "changed".into();
    assert_eq!(
        intake::submit(&path, &r).unwrap_err().to_string(),
        "operation_conflict"
    );
    r = old;
    // A later capture timestamp of the same occurrence keeps the original context and supports acceptance.
    r.operation_id = uuid::Uuid::new_v4().to_string();
    r.snapshot.source.captured_at = "2026-09-09T02:00:00Z".into();
    r.resolution = Some(intake::Resolution::Proposal {
        proposal: proposal(),
    });
    let pending = intake::submit(&path, &r).unwrap();
    assert_eq!(pending["status"], "pending");
    assert!(
        open_library(&path).unwrap().personal["meanings"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    r.operation_id = uuid::Uuid::new_v4().to_string();
    r.acceptance = Some(intake::Acceptance {
        kind: "delegated".into(),
        consent: "accept_context_expression_sense".into(),
        authorization: "user:save-this-meaning".into(),
    });
    let accepted = intake::submit(&path, &r).unwrap();
    assert_eq!(accepted["status"], "confirmed");
    let state = open_library(&path).unwrap();
    let m = &state.personal["meanings"][0];
    assert_eq!(m["acceptanceKind"], "delegated");
    assert_eq!(
        m["snapshot"]["source"]["capturedAt"],
        "2026-09-09T00:00:00Z"
    );
    assert_eq!(
        m["sourceLink"],
        "https://www.youtube.com/watch?v=abcdefghijk&t=1s"
    );
    assert!(state.catalog.is_empty());
    assert!(state.run.is_none());
    assert_eq!(intake::submit(&path, &r).unwrap(), accepted);
    r.operation_id = uuid::Uuid::new_v4().to_string();
    if let Some(intake::Resolution::Proposal { proposal }) = &mut r.resolution {
        proposal["semanticSpec"]["coreMeaningFocus"] = json!("另一个意思");
    }
    assert_eq!(
        intake::submit(&path, &r).unwrap_err().to_string(),
        "capture_resolution_conflict"
    );
    r.acceptance = None;
    assert_eq!(
        intake::submit(&path, &r).unwrap_err().to_string(),
        "capture_resolution_conflict"
    );
    assert_eq!(open_library(&path).unwrap().revision, state.revision);
    assert!(
        intake::receipt(
            &path,
            &r.library_id,
            &uuid::Uuid::new_v4().to_string(),
            &r.operation_id
        )
        .unwrap()
        .is_none()
    );
}
#[test]
fn invalid_acceptance_rolls_back_and_concurrent_retry_commits_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let r = request(&path);
    let mut bad = r.clone();
    bad.acceptance = Some(intake::Acceptance {
        kind: "direct".into(),
        consent: "accept_context_expression_sense".into(),
        authorization: "click".into(),
    });
    assert!(intake::submit(&path, &bad).is_err());
    assert!(
        open_library(&path).unwrap().personal["intakes"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let a = path.clone();
    let x = r.clone();
    let one = std::thread::spawn(move || intake::submit(&a, &x).unwrap());
    let two = intake::submit(&path, &r).unwrap();
    assert_eq!(one.join().unwrap(), two);
    let mut bad = r.clone();
    bad.operation_id = uuid::Uuid::new_v4().to_string();
    bad.snapshot.expression.as_mut().unwrap().start = 5;
    assert!(intake::submit(&path, &bad).is_err());
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("UPDATE personal_intakes SET removed=1", [])
        .unwrap();
    let mut fresh = r;
    fresh.operation_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        intake::submit(&path, &fresh).unwrap_err().to_string(),
        "intake_removed"
    );
}
