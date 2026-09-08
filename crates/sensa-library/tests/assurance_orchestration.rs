//! Composition acceptance for the high-assurance selectors and generic journal.
//! Synthetic evaluator input here is not a production evidence-grading adapter.
use rusqlite::Connection;
use sensa_core::{assurance::*, policies::existing_policy_inventory, progression::*};
use sensa_library::{
    open_library,
    progress::{self, Journal, Pin},
};
use serde_json::json;
#[test]
fn targeted_repair_retains_unrelated_credit_and_requires_independent_retest_after_reopen() {
    let inventory:Inventory=serde_json::from_value(json!({
        "requiredCapabilities":["contextual_recognition","meaning_to_form_recall"],
        "actions":[
            {"actionKey":"recognize","capability":"contextual_recognition","kind":"acquisition_gate","taskKey":"recognition-task"},
            {"actionKey":"recall-a","capability":"meaning_to_form_recall","kind":"acquisition_gate","taskKey":"recall-a-task"},
            {"actionKey":"recall-b","capability":"meaning_to_form_recall","kind":"acquisition_gate","taskKey":"recall-b-task"}
        ],"reviewActions":[],
        "repairActions":[{"actionKey":"bridge","capability":"meaning_to_form_recall","kind":"acquisition_gate","intent":"repair","taskKey":null,"repairResourceRef":{"role":"l1_bridge","key":"accepted-bridge","source":"package_declared"}}]
    })).unwrap();
    let candidate = AcquisitionCandidate {
        target_key: "target".into(),
        last_step_ordinal: 0,
        repair_basis: None,
        inventory: inventory.clone(),
        introduced: true,
        gate_status: Default::default(),
        last_assessment_action_key: Default::default(),
        transfer_scenario_index: 0,
    };
    let definition = progress_definition(&inventory);
    assert_eq!(definition.checkpoints.len(), 2); // No synthetic transfer/boundary gates.
    let pin = Pin {
        definition,
        progression_policy_id: "structured-current-checkpoint-reset-v1".into(),
        evaluation_contract_id: "acceptance-evaluator".into(),
        plan_id: "acceptance-plan".into(),
        material_digest: "acceptance-material".into(),
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("assurance.sqlite");
    open_library(&path).unwrap();
    let events = [
        (
            "recognize",
            Capability::ContextualRecognition,
            ObservationKind::CheckpointSatisfied,
        ),
        (
            "recall-a",
            Capability::MeaningToFormRecall,
            ObservationKind::CheckpointNotSatisfied,
        ),
        (
            "bridge",
            Capability::MeaningToFormRecall,
            ObservationKind::RepairCompleted,
        ),
        (
            "recall-b",
            Capability::MeaningToFormRecall,
            ObservationKind::CheckpointSatisfied,
        ),
    ];
    for (n, (action, cap, kind)) in events.into_iter().enumerate() {
        let mut db = Connection::open(&path).unwrap();
        let tx = db.transaction().unwrap();
        let journal = Journal::new(&tx);
        journal.create("run", &pin).unwrap();
        let registry = existing_policy_inventory().unwrap();
        let observation = Observation {
            observation_id: format!("o{n}"),
            attempt_id: format!("a{n}"),
            action_id: action.into(),
            kind,
            checkpoint_id: Some(format!("structured-acquisition:{}", cap.key())),
            evidence_ids: vec![],
        };
        let view = journal
            .record(
                "run",
                n as u32,
                registry.progression(&pin.progression_policy_id).unwrap(),
                &observation,
                0,
                "acceptance",
            )
            .unwrap();
        tx.commit().unwrap();
        drop(db);
        let db = Connection::open(&path).unwrap();
        assert_eq!(progress::load(&db, "run").unwrap(), view);
        if n == 1 {
            assert_eq!(view.state.progress_epoch, 0);
            assert_eq!(
                view.state.checkpoint_credits["structured-acquisition:contextual_recognition"]
                    .status,
                CreditStatus::Credited
            );
            let repair = acquisition_repair(
                &candidate,
                &AcquisitionRepair {
                    capability: Capability::MeaningToFormRecall,
                    failed_action_key: "recall-a".into(),
                    repair_count: 0,
                },
            )
            .unwrap();
            assert_eq!(repair["intent"], "repair");
            assert_eq!(repair["taskKey"], serde_json::Value::Null);
            assert_eq!(repair["repairForActionKey"], "recall-a");
        }
        if n == 2 {
            assert!(!view.state.completed);
            assert_eq!(
                view.state.reassessment_required_checkpoint_ids,
                vec!["structured-acquisition:meaning_to_form_recall"]
            );
            let mut next = candidate.clone();
            next.gate_status
                .insert(Capability::ContextualRecognition, "passed".into());
            next.last_assessment_action_key
                .insert(Capability::MeaningToFormRecall, "recall-a".into());
            assert_eq!(acquisition_next(&next).unwrap()["actionKey"], "recall-b");
        }
        if n == 3 {
            assert!(view.state.completed);
        }
    }
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM protocol_transitions", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        4
    );
    // Protocol-local acceptance did not fabricate application completion or schedule.
    assert_eq!(
        db.query_row("SELECT count(*) FROM memory", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        0
    );
}
