use chrono::{Duration, Utc};
use sensa_library::*;
use serde_json::{Value, json};
use std::path::Path;
fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn command(p: &Path, a: Value) -> Command {
    let s = open_library(p).unwrap();
    serde_json::from_value(json!({"operationId":uid(),"libraryId":s.library_id,"expectedRevision":s.revision,"action":a})).unwrap()
}
fn apply(p: &Path, a: Value) -> Snapshot {
    execute(p, command(p, a)).unwrap()
}
fn act(p: &Path, a: Value) -> Snapshot {
    apply(p, json!({"kind":"agent","action":a}))
}
fn row(p: &Path, id: &str) -> Value {
    agent::query(p).unwrap()["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id)
        .unwrap()
        .clone()
}
fn provider() -> Value {
    json!({"id":uid(),"name":"fixture","endpoint":"http://127.0.0.1:4331","model":"fixture","kind":"compatible","vision":true})
}
fn lease(p: &Path, id: &str) -> String {
    let v = row(p, id);
    act(
        p,
        json!({"kind":"lease","id":id,"revision":v["revision"],"provider":provider()}),
    );
    row(p, id)["lease"]["id"].as_str().unwrap().into()
}
fn tool(p: &Path, id: &str, name: &str, args: Value) {
    let l = lease(p, id);
    act(
        p,
        json!({"kind":"turn","id":id,"lease_id":l,"message":"一个简短建议","model_used":"fixture-actual","calls":[{"id":uid(),"name":name,"args":args}]}),
    );
}
fn reject(p: &Path, a: Value, code: &str) {
    let before = agent::query(p).unwrap();
    let s = serde_json::to_value(open_library(p).unwrap()).unwrap();
    let e = execute(p, command(p, json!({"kind":"agent","action":a}))).unwrap_err();
    assert!(e.to_string().contains(code), "{e}");
    assert_eq!(agent::query(p).unwrap(), before);
    assert_eq!(serde_json::to_value(open_library(p).unwrap()).unwrap(), s);
}
fn create(p: &Path) -> (String, String) {
    let d = uid();
    apply(
        p,
        json!({"kind":"world","action":{"kind":"save","id":d,"expected_revision":0,"draft":{"blocks":[{"kind":"text","id":uid(),"text":"PRIVATE 场景：把雨伞借给朋友"}],"familiarExpression":"","startingPoint":null},"submit":true}}),
    );
    let id = uid();
    act(
        p,
        json!({"kind":"create","id":id,"source":{"kind":"world","draft_id":d,"revision":1,"share_images":true}}),
    );
    (id, d)
}
fn proposal() -> Value {
    json!({"explanation":"把东西暂时给别人用，可以说 lend。","expression":{"surface":"lend","type":"word","language":"en"},"semanticSpec":{"schemaVersion":"sensa-sense-semantic-spec-v1","coreMeaningFocus":"把东西暂时给别人使用，之后归还。","prototypeScenes":[{"summary":"一个人把物品暂时给另一个人使用。","participantRoles":["提供者","使用者"],"states":[],"directionOrCausality":null}],"includedCases":[],"excludedCases":[],"neighborContrasts":[],"openQuestions":[]}})
}
fn accept(p: &Path, id: &str) {
    act(
        p,
        json!({"kind":"accept","id":id,"revision":row(p,id)["revision"],"consent":"accept_context_expression_sense"}),
    );
}
#[test]
fn teacher_waits_corrections_are_candidates_and_context_commit_is_explicit() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("teacher.db");
    let (id, d) = create(&p);
    let before = open_library(&p).unwrap();
    tool(&p, &id, "lookup_meanings", json!({"query":"lend"}));
    assert_eq!(row(&p, &id)["status"], "idle");
    tool(
        &p,
        &id,
        "ask_learner",
        json!({"question":"你是给别人用，还是从别人那里借来？"}),
    );
    let v = row(&p, &id);
    assert_eq!(v["status"], "waiting");
    reject(
        &p,
        json!({"kind":"lease","id":id,"revision":v["revision"],"provider":provider()}),
        "agent_not_runnable",
    );
    act(
        &p,
        json!({"kind":"say","id":id,"revision":v["revision"],"message":"给别人用。"}),
    );
    tool(
        &p,
        &id,
        "propose_meaning",
        json!({"explanation":"缺少结构的候选"}),
    );
    assert_eq!(row(&p, &id)["status"], "idle");
    assert!(
        row(&p, &id)["messages"]
            .to_string()
            .contains("Invalid proposal")
    );
    tool(&p, &id, "propose_meaning", proposal());
    assert!(
        open_library(&p).unwrap().personal["meanings"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let v = row(&p, &id);
    act(
        &p,
        json!({"kind":"say","id":id,"revision":v["revision"],"message":"表达用完整短语也可以吗？"}),
    );
    assert!(row(&p, &id)["candidate"].is_null());
    tool(&p, &id, "propose_meaning", proposal());
    let after = open_library(&p).unwrap();
    assert_eq!(after.learning, before.learning);
    assert_eq!(
        serde_json::to_value(after.run).unwrap(),
        serde_json::to_value(before.run).unwrap()
    );
    accept(&p, &id);
    let s = open_library(&p).unwrap();
    let m = &s.personal["meanings"][0];
    assert!(m["focus"].is_null());
    assert_eq!(m["worldContext"]["id"], d);
    assert_eq!(m["addedToLearning"], false);
    assert_eq!(m["resolutionProvenance"]["modelUsed"], "fixture-actual");
    assert_eq!(row(&p, &id)["status"], "accepted");
}
#[test]
fn cancellation_late_duplicate_unknown_cross_library_and_expired_calls_are_fenced() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("fences.db");
    let (id, d) = create(&p);
    let l = lease(&p, &id);
    let request = agent::request(&p, &id).unwrap();
    assert!(
        request["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("language teacher")
    );
    reject(
        &p,
        json!({"kind":"turn","id":id,"lease_id":l,"message":"","calls":[{"id":uid(),"name":"delete_library","args":{}}]}),
        "agent_unapproved_tool",
    );
    act(
        &p,
        json!({"kind":"stop","id":id,"revision":row(&p,&id)["revision"]}),
    );
    reject(
        &p,
        json!({"kind":"turn","id":id,"lease_id":l,"message":"迟到","calls":[]}),
        "agent_stale_result",
    );
    let l = lease(&p, &id);
    let cid = uid();
    act(
        &p,
        json!({"kind":"turn","id":id,"lease_id":l,"message":"","calls":[{"id":cid,"name":"lookup_meanings","args":{"query":"lend"}}]}),
    );
    let l = lease(&p, &id);
    reject(
        &p,
        json!({"kind":"turn","id":id,"lease_id":l,"message":"","calls":[{"id":cid,"name":"lookup_meanings","args":{"query":"lend"}}]}),
        "agent_duplicate_tool",
    );
    let c = command(
        &p,
        json!({"kind":"agent","action":{"kind":"turn","id":id,"lease_id":l,"message":"过期","calls":[]}}),
    );
    let e = execute_at(&p, c, Utc::now() + Duration::minutes(2)).unwrap_err();
    assert!(e.to_string().contains("expired"));
    let mut c = command(
        &p,
        json!({"kind":"agent","action":{"kind":"stop","id":id,"revision":row(&p,&id)["revision"]}}),
    );
    c.library_id = uid();
    assert!(
        execute(&p, c)
            .unwrap_err()
            .to_string()
            .contains("library_mismatch")
    );
    act(&p, json!({"kind":"fail","id":id,"lease_id":l}));
    apply(
        &p,
        json!({"kind":"world","action":{"kind":"save","id":d,"expected_revision":1,"draft":{"blocks":[],"familiarExpression":"新的上下文","startingPoint":null},"submit":true}}),
    );
    reject(
        &p,
        json!({"kind":"lease","id":id,"revision":row(&p,&id)["revision"],"provider":provider()}),
        "draft_conflict",
    );
}
#[test]
fn content_loop_reviews_independently_and_commits_only_bound_material() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("content.db");
    let (id, _) = create(&p);
    tool(&p, &id, "propose_meaning", proposal());
    accept(&p, &id);
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    let s = apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","meaning_id":m["id"],"expected_revision":m["revision"],"policy":{"profileId":"lightweight","profileVersion":"v1"}}}),
    );
    let task = &s.personal["preparations"][0];
    let cid = uid();
    act(
        &p,
        json!({"kind":"create","id":cid,"source":{"kind":"content","task_id":task["id"],"revision":task["revision"]}}),
    );
    assert!(!row(&p, &cid)["input"].to_string().contains("PRIVATE"));
    tool(&p, &cid, "read_demand", json!({}));
    tool(
        &p,
        &cid,
        "submit_candidate",
        json!({"scene":"你把雨伞交给朋友，答案是 ｌｅｎｄ，随后归还。","senseFocus":"暂时给别人使用"}),
    );
    assert!(row(&p, &cid)["candidate"].is_null());
    for invalid in [
        json!({"materialRoleKey":"recall_support","contentPayload":{"text":"ｌｅｎｄ"}}),
        json!({"materialRoleKey":"language_structure","contentPayload":{"expressionKind":"word","expressionTypeLabel":"单词","partOfSpeech":"动词"}}),
    ] {
        tool(
            &p,
            &cid,
            "submit_candidate",
            json!({"scene":"你把自己的物品暂时交给朋友使用，约好用完后归还。","senseFocus":"暂时给别人用","resources":[invalid]}),
        );
        assert!(row(&p, &cid)["candidate"].is_null());
        assert!(open_library(&p).unwrap().catalog.is_empty());
    }

    tool(
        &p,
        &cid,
        "submit_candidate",
        json!({"scene":"你把自己的物品暂时交给朋友使用，约好用完后归还。","senseFocus":"暂时给别人用"}),
    );
    let l = lease(&p, &cid);
    let req = agent::request(&p, &cid).unwrap();
    assert_eq!(req["messages"].as_array().unwrap().len(), 2);
    assert_eq!(req["tools"], json!([]));
    act(
        &p,
        json!({"kind":"review","id":cid,"lease_id":l,"accepted":false,"reason":"请再检查是否忠于所选意思","model_used":"fixture-review"}),
    );
    assert_eq!(row(&p, &cid)["status"], "idle");
    assert!(open_library(&p).unwrap().catalog.is_empty());
    tool(
        &p,
        &cid,
        "submit_candidate",
        json!({"scene":"你把自己的雨伞暂时给朋友使用，约好用完后归还。","senseFocus":"暂时给别人用","resources":[{"materialRoleKey":"recall_support","contentPayload":{"text":"想想物品从谁手里交出去"}},{"materialRoleKey":"scene_bridge","contentPayload":{"text":"联系物品暂时交出、随后归还的场景。"}}]}),
    );
    let l = lease(&p, &cid);
    reject(
        &p,
        json!({"kind":"commit","id":cid,"revision":row(&p,&cid)["revision"]}),
        "agent_not_ready",
    );
    act(
        &p,
        json!({"kind":"review","id":cid,"lease_id":l,"accepted":true,"reason":"符合固定意思，没有答案泄露","model_used":"fixture-review"}),
    );
    let c = command(
        &p,
        json!({"kind":"agent","action":{"kind":"commit","id":cid,"revision":row(&p,&cid)["revision"]}}),
    );
    let s = execute(&p, c.clone()).unwrap();
    assert_eq!(s.catalog.len(), 1);
    assert_eq!(s.personal["preparations"][0]["status"], "ready");
    assert!(s.run.is_none());
    assert_eq!(
        serde_json::to_value(execute(&p, c).unwrap()).unwrap(),
        serde_json::to_value(s).unwrap()
    );
    assert_eq!(row(&p, &cid)["status"], "committed");
    assert_eq!(
        open_library(&p).unwrap().catalog[0]
            .material
            .resources
            .len(),
        2
    );
}
#[test]
fn schema14_upgrade_preserves_world_and_operations() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("migration.db");
    let _ = open_library(&p).unwrap();
    let db = rusqlite::Connection::open(&p).unwrap();
    db.execute_batch(
        "DROP TABLE native_intake_receipts; DROP TABLE agent_sessions;PRAGMA user_version=14;",
    )
    .unwrap();
    drop(db);
    let s = open_library(&p).unwrap();
    assert_eq!(s.revision, 0);
    assert_eq!(agent::query(&p).unwrap()["sessions"], json!([]));
}
#[test]
fn authorized_origin_is_fixed_per_request_and_revocation_fences_the_loop() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("origin.db");
    let (id, _) = create(&p);
    tool(&p, &id, "propose_meaning", proposal());
    accept(&p, &id);
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    apply(
        &p,
        json!({"kind":"anchor","action":{"kind":"set","meaning_id":m["id"],"expected_revision":m["revision"],"enabled":true,"recipient":"http://127.0.0.1:4331/"}}),
    );
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    let s = apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","meaning_id":m["id"],"expected_revision":m["revision"],"policy":{"profileId":"lightweight","profileVersion":"v1"}}}),
    );
    let t = &s.personal["preparations"][0];
    let cid = uid();
    reject(
        &p,
        json!({"kind":"create","id":cid,"source":{"kind":"content","task_id":t["id"],"revision":t["revision"],"service_origin":"https://other.invalid"}}),
        "anchor_recipient_mismatch",
    );
    act(
        &p,
        json!({"kind":"create","id":cid,"source":{"kind":"content","task_id":t["id"],"revision":t["revision"],"service_origin":"http://127.0.0.1:4331"}}),
    );
    let mut wrong = provider();
    wrong["endpoint"] = json!("https://other.invalid");
    reject(
        &p,
        json!({"kind":"lease","id":cid,"revision":row(&p,&cid)["revision"],"provider":wrong}),
        "anchor_recipient_mismatch",
    );
    let l = lease(&p, &cid);
    assert!(
        agent::request(&p, &cid)
            .unwrap()
            .to_string()
            .contains("PRIVATE")
    );
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    apply(
        &p,
        json!({"kind":"anchor","action":{"kind":"set","meaning_id":m["id"],"expected_revision":m["revision"],"enabled":false,"recipient":null}}),
    );
    let before = agent::query(&p).unwrap();
    assert!(execute(&p,command(&p,json!({"kind":"agent","action":{"kind":"turn","id":cid,"lease_id":l,"message":"late","calls":[{"id":uid(),"name":"read_demand","args":{}}]}}))).is_err());
    assert_eq!(agent::query(&p).unwrap(), before);
    assert!(open_library(&p).unwrap().catalog.is_empty());
}
#[test]
fn model_request_budget_survives_reopening_and_explicit_resumes() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("budget.db");
    let (id, _) = create(&p);
    for _ in 0..24 {
        let l = lease(&p, &id);
        act(
            &p,
            json!({"kind":"turn","id":id,"lease_id":l,"message":"请补充一句话。","calls":[]}),
        );
        act(
            &p,
            json!({"kind":"say","id":id,"revision":row(&p,&id)["revision"],"message":"补充一个简单场景。"}),
        );
        let _ = open_library(&p).unwrap();
    }
    reject(
        &p,
        json!({"kind":"lease","id":id,"revision":row(&p,&id)["revision"],"provider":provider()}),
        "agent_budget_exhausted",
    );
    assert!(
        open_library(&p).unwrap().personal["meanings"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[test]
fn captured_occurrence_teacher_preserves_intake_source_and_explicit_acceptance() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("capture.db");
    let capture = json!({"sentence":"Please lend me your umbrella.","language":"en","expression":{"text":" lend ","start":6,"end":12},"source":{"url":"https://example.com/reading","title":"original source","capturedAt":"2026-09-09T00:00:00Z"}});
    let s = apply(
        &p,
        json!({"kind":"personal","action":{"kind":"save_intake","snapshot":capture}}),
    );
    let intake = &s.personal["intakes"][0];
    let cid = uid();
    act(
        &p,
        json!({"kind":"create","id":cid,"source":{"kind":"capture","snapshot":capture,"intake_id":intake["id"]}}),
    );
    let mut bad = proposal();
    bad["expression"]["surface"] = json!("borrow");
    tool(&p, &cid, "propose_meaning", bad);
    assert!(row(&p, &cid)["candidate"].is_null());
    tool(&p, &cid, "propose_meaning", proposal());
    assert!(
        open_library(&p).unwrap().personal["meanings"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    accept(&p, &cid);
    let s = open_library(&p).unwrap();
    let m = &s.personal["meanings"][0];
    assert_eq!(m["snapshot"], capture);
    assert_eq!(
        m["resolutionProvenance"]["generator"]["policyVersion"],
        "language-teacher-v1"
    );
    assert!(m["focus"].is_null());
    assert_eq!(s.personal["intakes"][0]["meaningId"], m["id"]);
    assert!(!m["addedToLearning"].as_bool().unwrap());
    assert!(s.run.is_none());
}

fn task(p: &Path) -> Value {
    open_library(p).unwrap().personal["preparations"][0].clone()
}
fn reference(t: &Value) -> Value {
    use sha2::{Digest, Sha256};
    let payload = json!({"sourceId":"fixture-reference","edition":"v1","entryId":"lend-1","sourceUrl":"https://example.invalid/fixture-reference","license":"CC0 synthetic fixture","attribution":"Synthetic acceptance corpus","reviewer":"fixture-reviewer","expression":"lend","resources":[{"materialRoleKey":"pronunciation","contentPayload":{"audioUrl":null,"phoneticNotation":"/lend/","accentLabel":null}},{"materialRoleKey":"language_structure","contentPayload":{"expressionKind":"word","expressionTypeLabel":"单词","partOfSpeech":"动词"}},{"materialRoleKey":"usage_guidance","contentPayload":{"example":"Could you lend me an umbrella?"}}]});
    let digest = format!("{:x}", Sha256::digest(payload.to_string().as_bytes()));
    let mut r = payload;
    r["digest"] = json!(digest);
    r["senseVersionId"] = t["target"]["senseVersionId"].clone();
    r["bindingVersionId"] = t["target"]["bindingVersionId"].clone();
    r
}
#[test]
fn reference_source_revision_freeze_independent_review_and_withdrawal() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("reference.db");
    let (sid, _) = create(&p);
    tool(&p, &sid, "propose_meaning", proposal());
    accept(&p, &sid);
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","meaning_id":m["id"],"expected_revision":m["revision"],"policy":{"profileId":"lightweight","profileVersion":"v1"}}}),
    );
    let r = reference(&task(&p));
    let values: Vec<resources::Resource> = serde_json::from_value(r["resources"].clone()).unwrap();
    assert!(resources::validate(&values, "lend", true).is_err());
    let mut unsafe_audio = values.clone();
    unsafe_audio[0].content_payload["audioUrl"] = json!("https://example.invalid/audio.mp3");
    assert!(resources::validate(&unsafe_audio, "lend", false).is_err());
    let set = |r: Value| json!({"kind":"provisioning","action":{"kind":"set_reference","task_id":task(&p)["id"],"expected_revision":task(&p)["revision"],"reference":r}});
    let mut wrong = r.clone();
    wrong["digest"] = json!("bad");
    assert!(
        execute(&p, command(&p, set(wrong)))
            .unwrap_err()
            .to_string()
            .contains("digest")
    );
    apply(&p, set(r.clone()));
    let cid = uid();
    act(
        &p,
        json!({"kind":"create","id":cid,"source":{"kind":"content","task_id":task(&p)["id"],"revision":task(&p)["revision"]}}),
    );
    tool(&p, &cid, "lookup_reference_facts", json!({}));
    assert!(
        row(&p, &cid)["messages"]
            .to_string()
            .contains("Could you lend")
    );
    tool(
        &p,
        &cid,
        "submit_candidate",
        json!({"scene":"你把自己的雨伞暂时交给朋友使用，之后再拿回来。","senseFocus":"暂时给别人使用"}),
    );
    let l = lease(&p, &cid);
    assert!(
        agent::request(&p, &cid).unwrap()["messages"]
            .to_string()
            .contains("fixture-reference")
    );
    act(
        &p,
        json!({"kind":"review","id":cid,"lease_id":l,"accepted":true,"reason":"参考资料与目标用法一致"}),
    );
    act(
        &p,
        json!({"kind":"commit","id":cid,"revision":row(&p,&cid)["revision"]}),
    );
    let before = open_library(&p).unwrap();
    assert_eq!(before.catalog[0].material.resources.len(), 3);
    assert_eq!(
        before.catalog[0].material.resources[0].content_payload["phoneticNotation"],
        "/lend/"
    );
    assert!(before.run.is_none());
    // Retained materials are immutable; a new attempt excludes a withdrawn source.
    apply(&p, set(Value::Null));
    assert_eq!(
        open_library(&p).unwrap().catalog[0]
            .material
            .resources
            .len(),
        3
    );
    let later = uid();
    act(
        &p,
        json!({"kind":"create","id":later,"source":{"kind":"content","task_id":task(&p)["id"],"revision":task(&p)["revision"]}}),
    );
    assert!(row(&p, &later)["input"]["reference"].is_null());
    let l = lease(&p, &later);
    apply(&p, set(r.clone()));
    reject(
        &p,
        json!({"kind":"turn","id":later,"lease_id":l,"message":"迟到","calls":[]}),
        "preparation_superseded",
    );
    // Same source edition cannot be rewritten with a freshly valid payload digest.
    use sha2::{Digest, Sha256};
    let mut changed = r.clone();
    changed["attribution"] = json!("changed");
    let mut payload = changed.clone();
    for k in ["digest", "senseVersionId", "bindingVersionId"] {
        payload.as_object_mut().unwrap().remove(k);
    }
    changed["digest"] = json!(format!(
        "{:x}",
        Sha256::digest(payload.to_string().as_bytes())
    ));
    assert!(
        execute(&p, command(&p, set(changed)))
            .unwrap_err()
            .to_string()
            .contains("reference_version_conflict")
    );
    assert_eq!(task(&p)["reference"], r);
}
#[test]
fn non_exact_bindings_pin_relation_and_require_post_reveal_usage_limits() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("coverage.db");
    let (sid, _) = create(&p);
    tool(&p, &sid, "propose_meaning", proposal());
    accept(&p, &sid);
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    apply(
        &p,
        json!({"kind":"world","action":{"kind":"bind","meaning_id":m["id"],"expected_revision":m["revision"],"surface":"lend","expression_type":"word","relation":"approximates","coverage":"overlapping","consent":"confirm_expression_binding"}}),
    );
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","meaning_id":m["id"],"expected_revision":m["revision"],"policy":{"profileId":"lightweight","profileVersion":"v1"}}}),
    );
    let cid = uid();
    act(
        &p,
        json!({"kind":"create","id":cid,"source":{"kind":"content","task_id":task(&p)["id"],"revision":task(&p)["revision"]}}),
    );
    assert_eq!(
        row(&p, &cid)["input"]["target"]["binding"]["relation"],
        "approximates"
    );
    let mut cue = json!({"scene":"你把自己的雨伞暂时交给朋友使用，之后再拿回来。","senseFocus":"暂时给别人使用"});
    tool(&p, &cid, "submit_candidate", cue.clone());
    assert!(row(&p, &cid)["candidate"].is_null());
    cue["resources"] = json!([{"materialRoleKey":"scene_bridge","contentPayload":{"text":"此表达在物品借出的情境适用，并不覆盖这个意思的所有情境。"}}]);
    tool(&p, &cid, "submit_candidate", cue);
    let l = lease(&p, &cid);
    assert!(
        agent::request(&p, &cid).unwrap()["messages"]
            .to_string()
            .contains("overlapping")
    );
    act(
        &p,
        json!({"kind":"review","id":cid,"lease_id":l,"accepted":true,"reason":"限定适用场景"}),
    );
    act(
        &p,
        json!({"kind":"commit","id":cid,"revision":row(&p,&cid)["revision"]}),
    );
    assert_eq!(
        open_library(&p).unwrap().catalog[0]
            .material
            .binding_version_id,
        m["bindingVersionId"].as_str().unwrap()
    );
}

#[test]
fn image_grant_is_shared_with_independent_reviewer_and_capability_fenced() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("images.db");
    let (sid, draft) = create(&p);
    tool(&p, &sid, "propose_meaning", proposal());
    accept(&p, &sid);
    // New context uses a real verified image, resolved against the same known meaning.
    let original = open_library(&p).unwrap().personal["meanings"][0].clone();
    let mut bytes = std::io::Cursor::new(vec![]);
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let digest = world::put_media(&p, &bytes.into_inner()).unwrap();
    let second = uid();
    apply(
        &p,
        json!({"kind":"world","action":{"kind":"save","id":second,"expected_revision":0,"draft":{"blocks":[{"id":uid(),"kind":"image","digest":digest},{"id":uid(),"kind":"text","text":"PRIVATE 图文经历"}],"familiarExpression":"","startingPoint":null},"submit":true}}),
    );
    apply(
        &p,
        json!({"kind":"world","action":{"kind":"resolve","id":second,"expected_revision":1,"source":{"kind":"meaning","id":original["id"],"revision":original["revision"]},"consent":"accept_context_expression_sense"}}),
    );
    let m = world::query(&p).unwrap()["meanings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["worldContext"]["id"] == second)
        .unwrap()
        .clone();
    assert_ne!(m["worldContext"]["id"], draft);
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    apply(
        &p,
        json!({"kind":"anchor","action":{"kind":"set","meaning_id":m["id"],"expected_revision":m["revision"],"enabled":true,"recipient":"http://127.0.0.1:4331"}}),
    );
    let m = open_library(&p).unwrap().personal["meanings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == m["id"])
        .unwrap()
        .clone();
    apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","meaning_id":m["id"],"expected_revision":m["revision"],"policy":{"profileId":"lightweight","profileVersion":"v1"}}}),
    );
    let cid = uid();
    act(
        &p,
        json!({"kind":"create","id":cid,"source":{"kind":"content","task_id":task(&p)["id"],"revision":task(&p)["revision"],"service_origin":"http://127.0.0.1:4331"}}),
    );
    let mut no_vision = provider();
    no_vision["vision"] = json!(false);
    reject(
        &p,
        json!({"kind":"lease","id":cid,"revision":row(&p,&cid)["revision"],"provider":no_vision}),
        "agent_vision_required",
    );
    let l = lease(&p, &cid);
    let generation = agent::request(&p, &cid).unwrap();
    assert_eq!(
        generation["material"]["blocks"][0]["mediaType"],
        "image/png"
    );
    act(
        &p,
        json!({"kind":"turn","id":cid,"lease_id":l,"message":"候选","calls":[{"id":uid(),"name":"submit_candidate","args":{"scene":"你把自己的物品暂时交给朋友使用，约好之后再归还。","senseFocus":"借给别人使用"}}]}),
    );
    reject(
        &p,
        json!({"kind":"lease","id":cid,"revision":row(&p,&cid)["revision"],"provider":no_vision}),
        "agent_vision_required",
    );
    lease(&p, &cid);
    let review = agent::request(&p, &cid).unwrap();
    assert_eq!(review["material"], generation["material"]);
    assert_eq!(review["messages"].as_array().unwrap().len(), 2);
}

#[test]
fn static_pronunciation_is_fixed_before_generation_and_bound_to_the_expression() {
    use sha2::{Digest, Sha256};
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("static.db");
    let (sid, _) = create(&p);
    tool(&p, &sid, "propose_meaning", proposal());
    accept(&p, &sid);
    apply(&p, json!({"kind":"confirm_quantity","quantity":5}));
    let m = open_library(&p).unwrap().personal["meanings"][0].clone();
    apply(
        &p,
        json!({"kind":"provisioning","action":{"kind":"add","meaning_id":m["id"],"expected_revision":m["revision"],"policy":{"profileId":"lightweight","profileVersion":"v1"}}}),
    );
    let bytes = b"synthetic-object";
    let reference = json!({"digest":format!("{:x}",Sha256::digest(bytes)),"sourceTextDigest":format!("{:x}",Sha256::digest(b"lend")),"mimeType":"audio/mpeg","byteSize":bytes.len()});
    let cid = uid();
    let source = json!({"kind":"content","task_id":task(&p)["id"],"revision":task(&p)["revision"],"pronunciation":{"reference":reference,"recipient":"https://example.invalid/static"}});
    let mut wrong = source.clone();
    wrong["pronunciation"]["reference"]["sourceTextDigest"] = json!("0".repeat(64));
    reject(
        &p,
        json!({"kind":"create","id":cid,"source":wrong}),
        "invalid_pronunciation",
    );
    act(&p, json!({"kind":"create","id":cid,"source":source}));
    tool(
        &p,
        &cid,
        "submit_candidate",
        json!({"scene":"你把自己的雨伞暂时交给朋友使用，约好之后再拿回来。","senseFocus":"暂时给别人用"}),
    );
    let l = lease(&p, &cid);
    assert!(
        agent::request(&p, &cid).unwrap()["messages"]
            .to_string()
            .contains("sourceTextDigest")
    );
    act(
        &p,
        json!({"kind":"review","id":cid,"lease_id":l,"accepted":true,"reason":"目标和静态来源绑定正确"}),
    );
    act(
        &p,
        json!({"kind":"commit","id":cid,"revision":row(&p,&cid)["revision"]}),
    );
    let material = &open_library(&p).unwrap().catalog[0].material;
    assert_eq!(
        serde_json::to_value(material.pronunciation.as_ref().unwrap()).unwrap(),
        reference
    );
    pronunciation::cache(&p, &material.id, bytes).unwrap();
    assert_eq!(pronunciation::cached(&p, &material.id).unwrap(), bytes);
}
