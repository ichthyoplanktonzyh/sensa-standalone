//! No-cost platform acceptance fixture, produced only through public commands.
//! Explicit fresh output path; never rewrites an existing library.
use chrono::{TimeZone, Utc};
use sensa_core::{
    assurance_material,
    planning::{AssignmentScope, PolicyRef},
};
use sensa_library::{Command, CommandAction, assurance_runtime::Intent, execute_at, open_library};
use serde_json::Value;
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(
        args.len(),
        3,
        "usage: assurance_fixture artifact.json fresh-output.sqlite"
    );
    let artifact = std::fs::read_to_string(&args[1]).unwrap();
    let release: Value = serde_json::from_str::<Value>(&artifact).unwrap()["release"].clone();
    let path = std::path::Path::new(&args[2]);
    assert!(!path.exists(), "Fresh acceptance path required");
    let time = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let apply = |action| {
        let s = open_library(path).unwrap();
        execute_at(
            path,
            Command {
                operation_id: uuid::Uuid::new_v4().to_string(),
                library_id: s.library_id,
                expected_revision: s.revision,
                action,
            },
            time,
        )
        .unwrap()
    };
    apply(CommandAction::ConfirmQuantity { quantity: 5 });
    apply(CommandAction::ImportRuntimeRelease {
        release_json: artifact,
    });
    apply(CommandAction::SetPolicy {
        scope: AssignmentScope::Learner,
        policy: Some(PolicyRef {
            profile_id: "high_assurance".into(),
            profile_version: "high-assurance-profile-v1".into(),
        }),
    });
    apply(CommandAction::AddToLearning);
    apply(CommandAction::StartOrResume);
    for _ in 0..80 {
        let s = open_library(path).unwrap();
        let a = s.assurance.unwrap();
        if a["completed"] == true {
            println!(
                "Created historical high-assurance graduation for offline due-review acceptance"
            );
            return;
        }
        let event = |intent| {
            let s = open_library(path).unwrap();
            let a = s.assurance.unwrap();
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
            let r = assurance_material::resolve(
                &release,
                action["packageId"].as_str().unwrap(),
                action["senseId"].as_str().unwrap(),
                action["taskKey"].as_str().unwrap(),
                serde_json::from_value(action["capability"].clone()).unwrap(),
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
        event(Intent::Continue);
    }
    panic!("Fixture did not graduate");
}
