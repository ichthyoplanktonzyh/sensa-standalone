use chrono::{DateTime, Utc};
use rusqlite::Connection;
use sensa_core::{
    Action,
    planning::{AssignmentScope, PolicyRef, Readiness},
};
use sensa_library::{Command, CommandAction, Snapshot, execute_at, open_library};
use std::path::Path;
use uuid::Uuid;
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
fn apply(p: &Path, a: CommandAction) -> Snapshot {
    execute_at(p, command(&open_library(p).unwrap(), a), now()).unwrap()
}
fn choose(id: &str) -> PolicyRef {
    let version = match id {
        "lightweight" => "v1",
        "high_assurance" => "high-assurance-profile-v1",
        _ => "interleaved-four-stage-profile-v1",
    };
    PolicyRef {
        profile_id: id.into(),
        profile_version: version.into(),
    }
}
fn set(p: &Path, scope: AssignmentScope, id: Option<&str>) -> Snapshot {
    apply(
        p,
        CommandAction::SetPolicy {
            scope,
            policy: id.map(choose),
        },
    )
}
fn setup(p: &Path) {
    apply(p, CommandAction::ConfirmQuantity { quantity: 5 });
    apply(
        p,
        CommandAction::ImportPack {
            pack_json: include_str!("fixtures/local-text-pack-v1.json").into(),
        },
    );
}
fn answer(s: &Snapshot, action: Action) -> CommandAction {
    let r = s.run.as_ref().unwrap();
    CommandAction::RecordAction {
        run_id: r.id.clone(),
        ordinal: r.ordinal,
        action,
    }
}
fn facts(s: &Snapshot) -> serde_json::Value {
    let mut v = serde_json::to_value(s).unwrap();
    v.as_object_mut().unwrap().remove("policyState");
    v.as_object_mut().unwrap().remove("progress");
    v.as_object_mut().unwrap().remove("curriculum");
    v
}
#[test]
fn precedence_replanning_and_explicit_inheritance_are_versioned() {
    let temp = tempfile::tempdir().unwrap();
    let p = temp.path().join("test.sqlite");
    setup(&p);
    set(&p, AssignmentScope::Learner, Some("high_assurance"));
    let s = apply(&p, CommandAction::AddToLearning);
    let plan = s.policy_state.selected.unwrap();
    assert_eq!(plan.plan.effective.scope, AssignmentScope::Learner);
    assert_eq!(
        plan.plan.purposes.initial_learning.readiness.status,
        Readiness::Blocked
    );
    assert!(!plan.committed);
    let s = set(
        &p,
        AssignmentScope::Curriculum,
        Some("interleaved_four_stage"),
    );
    assert_eq!(
        s.policy_state.selected.unwrap().plan.effective.scope,
        AssignmentScope::Curriculum
    );
    let s = set(&p, AssignmentScope::Target, Some("lightweight"));
    let target = s.policy_state.selected.unwrap();
    assert_eq!(target.plan.effective.scope, AssignmentScope::Target);
    assert_eq!(
        target.plan.purposes.initial_learning.readiness.status,
        Readiness::Ready
    );
    let s = set(&p, AssignmentScope::Learner, Some("lightweight"));
    assert_eq!(s.policy_state.selected.unwrap().id, target.id);
    let s = set(&p, AssignmentScope::Target, None);
    assert_eq!(
        s.policy_state
            .selected
            .unwrap()
            .plan
            .effective
            .policy
            .profile_id,
        "interleaved_four_stage"
    );
    let s = set(&p, AssignmentScope::Curriculum, None);
    assert_eq!(
        s.policy_state.selected.unwrap().plan.effective.scope,
        AssignmentScope::Learner
    );
    let s = set(&p, AssignmentScope::Learner, None);
    let selected = s.policy_state.selected.unwrap();
    assert_eq!(selected.plan.effective.scope, AssignmentScope::System);
    assert!(selected.revision > target.revision);
    assert_eq!(s.completion_count, 0);
    assert!(s.run.is_none());
    let db = Connection::open(&p).unwrap();
    let original: String = db
        .query_row(
            "SELECT content FROM target_plans WHERE id=?1",
            [&target.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&original).unwrap(),
        serde_json::to_value(target.plan).unwrap()
    );
}
#[test]
fn first_run_is_atomic_and_commitment_survives_default_changes_and_retention() {
    let temp = tempfile::tempdir().unwrap();
    let p = temp.path().join("test.sqlite");
    setup(&p);
    apply(&p, CommandAction::AddToLearning);
    let blocked = set(&p, AssignmentScope::Target, Some("high_assurance"));
    let start = command(&blocked, CommandAction::StartOrResume);
    assert_eq!(
        execute_at(&p, start, now()).unwrap_err().to_string(),
        "learning_plan_blocked"
    );
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        serde_json::to_value(&blocked).unwrap()
    );
    let ready = set(&p, AssignmentScope::Target, Some("lightweight"));
    let start = command(&ready, CommandAction::StartOrResume);
    let db = Connection::open(&p).unwrap();
    db.execute_batch("CREATE TRIGGER fail_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT,'injected_failure'); END;").unwrap();
    assert!(execute_at(&p, start.clone(), now()).is_err());
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        serde_json::to_value(&ready).unwrap()
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM policy_commitments", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        0
    );
    db.execute_batch("DROP TRIGGER fail_run").unwrap();
    let started = execute_at(&p, start.clone(), now()).unwrap();
    let committed = started.policy_state.selected.clone().unwrap();
    assert!(committed.committed);
    assert_eq!(committed.id, ready.policy_state.selected.unwrap().id);
    assert_eq!(
        execute_at(&p, start, now()).unwrap().run.unwrap().id,
        started.run.as_ref().unwrap().id
    );
    assert_eq!(
        execute_at(
            &p,
            command(
                &started,
                CommandAction::SetPolicy {
                    scope: AssignmentScope::Target,
                    policy: Some(choose("high_assurance"))
                }
            ),
            now()
        )
        .unwrap_err()
        .to_string(),
        "policy_committed"
    );
    set(&p, AssignmentScope::Learner, Some("high_assurance"));
    set(
        &p,
        AssignmentScope::Curriculum,
        Some("interleaved_four_stage"),
    );
    apply(&p, CommandAction::Pause);
    let resumed = apply(&p, CommandAction::StartOrResume);
    assert_eq!(
        resumed.policy_state.selected.as_ref().unwrap().id,
        committed.id
    );
    assert_eq!(resumed.run.as_ref().unwrap().id, started.run.unwrap().id);
    let s = apply(&p, answer(&resumed, Action::Reveal));
    let s = apply(&p, answer(&s, Action::Good));
    let due = DateTime::from_timestamp_millis(s.due_at_ms.unwrap()).unwrap();
    let s = execute_at(&p, command(&s, CommandAction::NextRetention), due).unwrap();
    assert_eq!(
        s.run.as_ref().unwrap().protocol_version,
        "consumer-review-v1"
    );
    let s = execute_at(&p, command(&s, answer(&s, Action::Reveal)), due).unwrap();
    let s = execute_at(&p, command(&s, answer(&s, Action::Good)), due).unwrap();
    assert_eq!(s.retention.review_count, 1);
    assert_eq!(s.policy_state.selected.unwrap().id, committed.id);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM retention_run_policies WHERE plan_id=?1",
            [&committed.id],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, u32>(
            0
        ))
        .unwrap(),
        0
    );
}
#[test]
fn new_pack_source_does_not_silently_replace_existing_assignment_source() {
    let temp = tempfile::tempdir().unwrap();
    let p = temp.path().join("test.sqlite");
    setup(&p);
    let s = apply(&p, CommandAction::AddToLearning);
    let original = s.policy_state.source_key.clone();
    set(&p, AssignmentScope::Curriculum, Some("high_assurance"));
    let mut pack: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/local-text-pack-v1.json")).unwrap();
    pack["id"] = serde_json::json!("additional-source");
    apply(
        &p,
        CommandAction::ImportPack {
            pack_json: pack.to_string(),
        },
    );
    let s = apply(&p, CommandAction::AddToLearning);
    assert_eq!(s.policy_state.source_key, original);
    assert_eq!(
        s.policy_state
            .selected
            .unwrap()
            .plan
            .effective
            .policy
            .profile_id,
        "high_assurance"
    );
    assert!(s.run.is_none());
}
#[test]
fn v3_upgrade_adds_provenance_without_changing_any_existing_learning_fact() {
    let temp = tempfile::tempdir().unwrap();
    let p = temp.path().join("test.sqlite");
    setup(&p);
    apply(&p, CommandAction::AddToLearning);
    let s = apply(&p, CommandAction::StartOrResume);
    let s = apply(&p, answer(&s, Action::Reveal));
    let s = apply(&p, answer(&s, Action::Good));
    let db = Connection::open(&p).unwrap();
    db.execute_batch("DROP TABLE practice_operations; DROP TABLE practice_turns; DROP TABLE practice_sessions; DROP TABLE practice_state; DROP TABLE curriculum_introduction_sources; DROP TABLE activity_scope_sources; DROP TABLE curriculum_scopes; DROP TABLE curriculum_settings; DROP TABLE curriculum_supplemental; DROP TABLE curriculum_members; DROP TABLE curriculum_enrollments; DROP TABLE curriculum_books; DROP TABLE personal_anchor_revocations; DROP TABLE personal_anchor_grants; DROP TABLE personal_preparation_versions; DROP TABLE personal_task_entries; DROP TABLE personal_content_attempts; DROP TABLE personal_learning_tasks; DROP TABLE semantic_lookups; DROP TABLE semantic_identities; DROP TABLE personal_learning_links; DROP TABLE personal_intakes; DROP TABLE personal_meanings; DROP TABLE initial_introductions; DROP TABLE local_checkins; DROP TABLE activity_results; DROP TABLE activity_executions; DROP TABLE activity_scope; DROP TABLE learning_activities; DROP TABLE activity_clock; DROP TABLE assurance_cycles; DROP TABLE assurance_evidence; DROP TABLE assurance_events; DROP TABLE assurance_session_targets; DROP TABLE assurance_sessions; DROP TABLE runtime_media; DROP TABLE assurance_materials; DROP TABLE runtime_releases; DROP TABLE consumer_progress_links; DROP TABLE protocol_transitions; DROP TABLE protocol_journals; DROP TABLE retention_run_policies; DROP TABLE initial_run_policies; DROP TABLE policy_commitments; DROP TABLE target_plans; DROP TABLE target_policy_sources; DROP TABLE material_policy_sources; DROP TABLE policy_assignments; PRAGMA user_version=3;").unwrap();
    let upgraded = open_library(&p).unwrap();
    assert_eq!(facts(&upgraded), facts(&s));
    let selected = upgraded.policy_state.selected.unwrap();
    assert!(selected.committed);
    assert_eq!(selected.plan.effective.policy, choose("lightweight"));
    assert_eq!(
        db.query_row("SELECT provenance FROM policy_commitments", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "legacy_run_v3"
    );
}

#[test]
fn plan_readiness_requires_actual_material_and_supported_runtime() {
    use sensa_core::planning::{Capability, ReadinessView, resolve_plan};
    use std::collections::BTreeMap;
    let temp = tempfile::tempdir().unwrap();
    let p = temp.path().join("test.sqlite");
    setup(&p);
    let selected = apply(&p, CommandAction::AddToLearning)
        .policy_state
        .selected
        .unwrap()
        .plan;
    for (status, provisioned, supported, expected) in [
        (Readiness::Ready, false, true, Readiness::Blocked),
        (Readiness::Preparing, true, true, Readiness::Preparing),
        (Readiness::Ready, true, false, Readiness::Blocked),
        (Readiness::Ready, true, true, Readiness::Ready),
    ] {
        let provider = BTreeMap::from([(
            "recall-reveal-text".into(),
            Capability {
                view: ReadinessView {
                    status,
                    label: "test".into(),
                    detail: "test".into(),
                },
                provisioned,
                materialization_id: provisioned.then(|| "fixed-material".into()),
            },
        )]);
        let adapters = if supported {
            vec!["native-consumer-v1".into()]
        } else {
            vec![]
        };
        let plan = resolve_plan(
            selected.effective.clone(),
            &selected.profile,
            &provider,
            &adapters,
        )
        .unwrap();
        assert_eq!(plan.purposes.initial_learning.readiness.status, expected);
    }
    let before = open_library(&p).unwrap();
    let mut policy = choose("lightweight");
    policy.profile_version = "unknown-version".into();
    assert_eq!(
        execute_at(
            &p,
            command(
                &before,
                CommandAction::SetPolicy {
                    scope: AssignmentScope::Target,
                    policy: Some(policy),
                }
            ),
            now()
        )
        .unwrap_err()
        .to_string(),
        "unsupported_learning_policy"
    );
    assert_eq!(
        serde_json::to_value(open_library(&p).unwrap()).unwrap(),
        serde_json::to_value(before).unwrap()
    );
}
