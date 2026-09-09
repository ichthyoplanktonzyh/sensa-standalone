use chrono::{TimeZone, Utc};
use sensa_library::{Command, CommandAction, Snapshot, execute_at, open_library};
use serde_json::Value;
fn release() -> String {
    include_str!(
        "../../../apps/web/src/experience/content/releases/golden-learning-release-v1.json"
    )
    .into()
}
fn cmd(s: &Snapshot, action: CommandAction) -> Command {
    Command {
        operation_id: uuid::Uuid::new_v4().to_string(),
        library_id: s.library_id.clone(),
        expected_revision: s.revision,
        action,
    }
}
#[test]
fn admitted_release_is_atomic_immutable_and_does_not_enroll() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite");
    let state = open_library(&path).unwrap();
    let time = Utc.timestamp_millis_opt(1788850000000).unwrap();
    let command = cmd(
        &state,
        CommandAction::ImportRuntimeRelease {
            release_json: release(),
        },
    );
    let imported = execute_at(&path, command.clone(), time).unwrap();
    assert!(!imported.enrolled);
    assert!(imported.structured_material);
    assert_eq!(imported.catalog.len(), 4);
    assert!(imported.catalog.iter().all(|m| !m.enrolled));
    assert_eq!(
        execute_at(&path, command, time).unwrap().revision,
        imported.revision
    );
    let reopened = open_library(&path).unwrap();
    assert_eq!(reopened.catalog.len(), 4);
    assert_eq!(reopened.completion_count, 0);
    let mut bad: Value = serde_json::from_str(&release()).unwrap();
    bad["packages"][3]["assessmentInventory"]["novelContextTransfer"][0]["exampleKey"] =
        "missing".into();
    let result = execute_at(
        &path,
        cmd(
            &reopened,
            CommandAction::ImportRuntimeRelease {
                release_json: bad.to_string(),
            },
        ),
        time,
    );
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("invalid_runtime_release")
    );
    assert_eq!(open_library(&path).unwrap().revision, reopened.revision);
    let mut changed: Value = serde_json::from_str(&release()).unwrap();
    changed["packages"][0]["sense"]["guideLabelL1"] = "不同内容".into();
    assert!(
        execute_at(
            &path,
            cmd(
                &reopened,
                CommandAction::ImportRuntimeRelease {
                    release_json: changed.to_string()
                }
            ),
            time
        )
        .unwrap_err()
        .to_string()
        .contains("pack_version_conflict")
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM targets", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        0
    );
    db.execute("UPDATE runtime_releases SET content='{}'", [])
        .unwrap();
    drop(db);
    assert!(
        open_library(&path)
            .unwrap_err()
            .to_string()
            .contains("material_mismatch")
    );
}
fn artifact() -> Value {
    use base64::Engine;
    let release: Value = serde_json::from_str(&release()).unwrap();
    let media=release["media"].as_array().unwrap().iter().map(|m|{
  let digest=m["uri"].as_str().unwrap().strip_prefix("content://sha256/").unwrap();
  let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/golden-audio").join(format!("{digest}.mp3"));
  let bytes=std::fs::read(path).unwrap();
  serde_json::json!({"mediaKey":m["mediaKey"],"bytesBase64":base64::engine::general_purpose::STANDARD.encode(bytes)})
 }).collect::<Vec<_>>();
    let artifact =
        serde_json::json!({"format":"sensa-runtime-artifact-v1","release":release,"media":media});
    artifact
}
#[test]
fn packaged_media_is_verified_and_rolls_back_with_the_release() {
    let artifact = artifact();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("media.sqlite");
    let s = open_library(&path).unwrap();
    let time = Utc.timestamp_millis_opt(1788850000000).unwrap();
    let mut bad = artifact.clone();
    bad["media"][0]["bytesBase64"] = "aW52YWxpZA==".into();
    assert!(
        execute_at(
            &path,
            cmd(
                &s,
                CommandAction::ImportRuntimeRelease {
                    release_json: bad.to_string()
                }
            ),
            time
        )
        .unwrap_err()
        .to_string()
        .contains("invalid_runtime_media")
    );
    assert!(open_library(&path).unwrap().catalog.is_empty());
    let s = execute_at(
        &path,
        cmd(
            &s,
            CommandAction::ImportRuntimeRelease {
                release_json: artifact.to_string(),
            },
        ),
        time,
    )
    .unwrap();
    assert!(s.structured_material);
    let db = rusqlite::Connection::open(&path).unwrap();
    let count: u32 = db
        .query_row("SELECT count(*) FROM runtime_media", [], |r| r.get(0))
        .unwrap();
    assert!(count > 0);
    let count2:u32=db.query_row("SELECT count(DISTINCT json_extract(value,'$.sha256')) FROM runtime_releases,json_each(runtime_releases.content,'$.media')",[],|r|r.get(0)).unwrap();
    assert_eq!(count, count2);
}
#[test]
fn structured_initial_answers_commit_evidence_and_graduation_offline() {
    use sensa_core::planning::{AssignmentScope, PolicyRef};
    use sensa_library::assurance_runtime::Intent;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("acquisition.sqlite");
    let time = Utc.timestamp_millis_opt(1788850000000).unwrap();
    let apply = |a| {
        let s = open_library(&path).unwrap();
        execute_at(&path, cmd(&s, a), time).unwrap()
    };
    apply(CommandAction::ConfirmQuantity { quantity: 5 });
    let s = apply(CommandAction::ImportRuntimeRelease {
        release_json: artifact().to_string(),
    });
    apply(CommandAction::SetPolicy {
        scope: AssignmentScope::Learner,
        policy: Some(PolicyRef {
            profile_id: "high_assurance".into(),
            profile_version: "high-assurance-profile-v1".into(),
        }),
    });
    for item in s.catalog {
        apply(CommandAction::SelectMaterial {
            material_id: item.material.id,
        });
        apply(CommandAction::AddToLearning);
    }
    let s = apply(CommandAction::ActivityStart {
        mode: sensa_library::activity::Mode::Mixed,
    });
    assert_eq!(s.learning["newStartedToday"], 0);
    assert_eq!(s.learning["newReservedToday"], 4);
    let session_id = s.assurance.as_ref().unwrap()["id"].clone();
    let only = apply(CommandAction::ActivityStart {
        mode: sensa_library::activity::Mode::ReviewOnly,
    });
    assert!(only.learning["activity"]["executionId"].is_null());
    let s = apply(CommandAction::ActivityStart {
        mode: sensa_library::activity::Mode::Mixed,
    });
    assert_eq!(s.assurance.as_ref().unwrap()["id"], session_id);
    assert!(s.assurance.is_some());
    let original = s.assurance.clone();
    let changed = apply(CommandAction::SetPolicy {
        scope: AssignmentScope::Learner,
        policy: Some(PolicyRef {
            profile_id: "lightweight".into(),
            profile_version: "v1".into(),
        }),
    });
    assert_eq!(
        changed.assurance, original,
        "Ordinary settings cannot rewrite the pinned high-assurance run"
    );
    assert_eq!(
        changed
            .policy_state
            .selected
            .as_ref()
            .unwrap()
            .plan
            .profile
            .profile_id,
        "high_assurance"
    );
    assert_eq!(
        s.assurance.as_ref().unwrap()["queue"]["projection"]["targets"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    let release: Value = serde_json::from_str(&release()).unwrap();
    let mut steps = 0;
    loop {
        let s = open_library(&path).unwrap();
        let a = s.assurance.as_ref().unwrap();
        if a["completed"] == true {
            break;
        }
        assert!(steps < 50);
        steps += 1;
        let event = |intent: Intent| {
            let s = open_library(&path).unwrap();
            let a = s.assurance.as_ref().unwrap();
            apply(CommandAction::AssuranceEvent {
                session_id: a["id"].as_str().unwrap().into(),
                ordinal: a["ordinal"].as_u64().unwrap() as u32,
                intent,
            })
        };
        let action = &a["queue"]["session"]["action"];
        if action["intent"] == "instruction" || action["intent"] == "repair" {
            event(Intent::Reveal);
        } else {
            let cap = serde_json::from_value(action["capability"].clone()).unwrap();
            let r = sensa_core::assurance_material::resolve(
                &release,
                action["packageId"].as_str().unwrap(),
                action["senseId"].as_str().unwrap(),
                action["taskKey"].as_str().unwrap(),
                cap,
            )
            .unwrap();
            let (text, option_id) = if r["kind"] == "meaning_to_form_recall" {
                (r["acceptedForms"][0].as_str().unwrap().into(), None)
            } else {
                let options = if r["kind"] == "novel_context_transfer" {
                    &r["scenario"]["options"]
                } else {
                    &r["options"]
                };
                (
                    String::new(),
                    Some(
                        options
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|o| o["isCorrect"] == true)
                            .unwrap()["id"]
                            .as_str()
                            .unwrap()
                            .into(),
                    ),
                )
            };
            event(Intent::Draft { text, option_id });
            event(Intent::Submit);
        }
        let result = event(Intent::Continue);
        if result.assurance.as_ref().unwrap()["completed"] != true {
            assert_eq!(result.completion_count, 0);
        }
    }
    let s = open_library(&path).unwrap();
    assert_eq!(s.completion_count, 4);
    assert_eq!(s.handoff_count, 4);
    assert_eq!(s.learning["newStartedToday"], 4);
    assert_eq!(s.learning["activity"]["summary"]["distinctTargetCount"], 4);
    apply(CommandAction::ActivityEnd {
        activity_id: s.learning["activity"]["id"].as_str().unwrap().into(),
    });
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM completions WHERE kind='acquisition_graduation'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        4
    );
    assert!(
        db.query_row("SELECT count(*) FROM assurance_evidence", [], |r| r
            .get::<_, u32>(0))
            .unwrap()
            >= 12
    );
    let due: i64 = db
        .query_row("SELECT max(due_at_ms) FROM memory", [], |r| r.get(0))
        .unwrap();
    drop(db);
    let later = Utc.timestamp_millis_opt(due + 1).unwrap();
    let apply_review = |action| {
        let s = open_library(&path).unwrap();
        execute_at(&path, cmd(&s, action), later).unwrap()
    };
    apply_review(CommandAction::ActivityStart {
        mode: sensa_library::activity::Mode::ReviewOnly,
    });
    let mut first = true;
    let mut review_steps = 0;
    loop {
        let s = open_library(&path).unwrap();
        let a = s.assurance.as_ref().unwrap();
        if a["completed"] == true {
            break;
        }
        review_steps += 1;
        assert!(review_steps < 60);
        let event = |intent: Intent| {
            let s = open_library(&path).unwrap();
            let a = s.assurance.as_ref().unwrap();
            apply_review(CommandAction::AssuranceEvent {
                session_id: a["id"].as_str().unwrap().into(),
                ordinal: a["ordinal"].as_u64().unwrap() as u32,
                intent,
            })
        };
        let action = &a["queue"]["session"]["action"];
        if action["intent"] == "repair" {
            event(Intent::Reveal);
            event(Intent::Continue);
            continue;
        }
        let cap = serde_json::from_value(action["capability"].clone()).unwrap();
        let resource = sensa_core::assurance_material::resolve(
            &release,
            action["packageId"].as_str().unwrap(),
            action["senseId"].as_str().unwrap(),
            action["taskKey"].as_str().unwrap(),
            cap,
        )
        .unwrap();
        let answer = |correct: bool| {
            if resource["kind"] == "meaning_to_form_recall" {
                Intent::Draft {
                    text: if correct {
                        resource["acceptedForms"][0].as_str().unwrap().into()
                    } else {
                        "wrong".into()
                    },
                    option_id: None,
                }
            } else {
                let options = if resource["kind"] == "novel_context_transfer" {
                    &resource["scenario"]["options"]
                } else {
                    &resource["options"]
                };
                Intent::Draft {
                    text: String::new(),
                    option_id: Some(
                        options
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|o| o["isCorrect"] == correct)
                            .unwrap()["id"]
                            .as_str()
                            .unwrap()
                            .into(),
                    ),
                }
            }
        };
        event(answer(!first));
        event(Intent::Submit);
        if first {
            let db = rusqlite::Connection::open(&path).unwrap();
            let before: String = db
                .query_row("SELECT group_concat(schedule) FROM memory", [], |r| {
                    r.get(0)
                })
                .unwrap();
            drop(db);
            event(Intent::Undo);
            event(answer(true));
            let replay = event(Intent::Submit);
            assert_eq!(
                replay.assurance.as_ref().unwrap()["queue"]["session"]["result"]["correct"],
                false
            );
            let db = rusqlite::Connection::open(&path).unwrap();
            let after: String = db
                .query_row("SELECT group_concat(schedule) FROM memory", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(before, after);
            first = false;
        }
        event(Intent::Continue);
    }
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM memory_outcomes", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        4
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM memory WHERE revision=2", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        4
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM relearning_needs WHERE resolved_at_ms IS NULL",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM retention_completions WHERE kind='relearning_completion'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        1
    );
    let s = open_library(&path).unwrap();
    assert_eq!(s.learning["activity"]["summary"]["distinctTargetCount"], 4);
    assert_eq!(
        s.learning["activity"]["summary"]["reviewTargetIds"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        s.learning["activity"]["summary"]["restoredTargetIds"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn declared_mastery_can_return_and_uncommitted_errors_preserve_history() {
    use sensa_core::planning::{AssignmentScope, PolicyRef};
    use sensa_library::assurance_runtime::Intent;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("restore.sqlite");
    let now = Utc.timestamp_millis_opt(1788850000000).unwrap();
    let apply = |action| {
        let s = open_library(&path).unwrap();
        execute_at(&path, cmd(&s, action), now).unwrap()
    };
    apply(CommandAction::ConfirmQuantity { quantity: 5 });
    apply(CommandAction::ImportRuntimeRelease {
        release_json: artifact().to_string(),
    });
    apply(CommandAction::SetPolicy {
        scope: AssignmentScope::Learner,
        policy: Some(PolicyRef {
            profile_id: "high_assurance".into(),
            profile_version: "high-assurance-profile-v1".into(),
        }),
    });
    apply(CommandAction::AddToLearning);
    let s = apply(CommandAction::StartOrResume);
    let a = s.assurance.unwrap();
    let sid = a["id"].as_str().unwrap().to_owned();
    let target = a["queue"]["session"]["action"]["retentionTargetId"]
        .as_str()
        .unwrap()
        .to_owned();
    let event = |intent| {
        let s = open_library(&path).unwrap();
        let a = s.assurance.as_ref().unwrap();
        apply(CommandAction::AssuranceEvent {
            session_id: sid.clone(),
            ordinal: a["ordinal"].as_u64().unwrap() as u32,
            intent,
        })
    };
    let before = open_library(&path).unwrap();
    let invalid = cmd(
        &before,
        CommandAction::AssuranceEvent {
            session_id: sid.clone(),
            ordinal: 1,
            intent: Intent::Continue,
        },
    );
    assert!(execute_at(&path, invalid, now).is_err());
    assert_eq!(open_library(&path).unwrap().revision, before.revision);
    let skipped = event(Intent::Mastery);
    assert_eq!(skipped.assurance.as_ref().unwrap()["completed"], true);
    assert_eq!(skipped.completion_count, 0);
    assert_eq!(skipped.handoff_count, 0);
    let returned = event(Intent::ReturnTarget { target_id: target });
    assert_eq!(returned.assurance.as_ref().unwrap()["completed"], false);
    assert_eq!(
        returned.assurance.as_ref().unwrap()["queue"]["session"]["action"]["intent"],
        "instruction"
    );
    event(Intent::Reveal);
    let before = open_library(&path).unwrap();
    let a = before.assurance.as_ref().unwrap();
    let op = cmd(
        &before,
        CommandAction::AssuranceEvent {
            session_id: sid.clone(),
            ordinal: a["ordinal"].as_u64().unwrap() as u32,
            intent: Intent::Continue,
        },
    );
    let applied = execute_at(&path, op.clone(), now).unwrap();
    assert_eq!(
        execute_at(&path, op, now).unwrap().revision,
        applied.revision
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute(
        "UPDATE assurance_sessions SET state=json_set(state,'$.draft.text','tampered')",
        [],
    )
    .unwrap();
    assert!(
        open_library(&path)
            .unwrap_err()
            .to_string()
            .contains("assurance_journal_mismatch")
    );
}

#[test]
fn structured_executor_acceptance_uses_bindings_not_profile_names() {
    use sensa_core::planning::Profile;
    let profiles: Vec<Profile> =
        serde_json::from_str(include_str!("../src/web-policy-profiles-v1.json")).unwrap();
    let mut renamed = profiles
        .into_iter()
        .find(|p| p.profile_id == "high_assurance")
        .unwrap();
    renamed.profile_id = "owner-defined-name".into();
    for (purpose, spec) in renamed.protocols.entries() {
        sensa_library::composition::validate_structured_spec(purpose, spec).unwrap();
    }
    renamed
        .protocols
        .initial_learning
        .binding
        .progression_policy_id = "run-reset-v1".into();
    sensa_library::composition::validate_structured_spec(
        "initial_learning",
        &renamed.protocols.initial_learning,
    )
    .unwrap();
    renamed
        .protocols
        .initial_learning
        .binding
        .evaluation_policy_id = "learner-rating-v1".into();
    assert!(
        sensa_library::composition::validate_structured_spec(
            "initial_learning",
            &renamed.protocols.initial_learning
        )
        .is_err()
    );
}
