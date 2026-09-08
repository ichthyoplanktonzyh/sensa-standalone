use sensa_core::{policies::*, progression::*};
use sensa_library::composition::{native_graph, native_registry};

// A consumer-supplied behavior with an identity unknown to the core. The registry
// owns the callback; neither the kernel nor Profile-name switches select it.
struct ExternalPolicy;
impl ProgressionPolicy for ExternalPolicy {
    fn id(&self) -> &str {
        "external-two-checkpoint-v1"
    }
    fn decide(&self, _: &Definition, _: &State, o: &Observation) -> Result<Vec<Effect>> {
        if o.kind != ObservationKind::CheckpointSatisfied {
            return Ok(vec![Effect::Advance]);
        }
        let id = o.checkpoint_id.clone().ok_or("checkpoint required")?;
        let final_checkpoint = id == "second";
        let mut effects = vec![Effect::CreditCheckpoint { checkpoint_id: id }];
        if final_checkpoint {
            effects.push(Effect::Complete);
        }
        Ok(effects)
    }
}
#[test]
fn consumer_supplied_policy_composes_and_runs_without_kernel_branches() {
    let registry = Registry::new(
        vec!["evaluation".into()],
        vec![Box::new(ExternalPolicy)],
        vec![(
            "completion".into(),
            CompletionPolicy::AllRequiredCheckpoints {
                require_same_progress_epoch: true,
            },
        )],
        vec!["repair".into()],
        vec![],
    )
    .unwrap();
    let mut graph = native_graph();
    let profile = &mut graph.profiles[0];
    profile.profile_id = "previously-unknown-profile".into();
    for binding in [
        &mut profile.protocols.initial_learning,
        &mut profile.protocols.retention_review,
        &mut profile.protocols.relearning,
    ] {
        binding.evaluation_policy_id = "evaluation".into();
        binding.progression_policy_id = "external-two-checkpoint-v1".into();
        binding.completion_policy_id = "completion".into();
        binding.repair_policy_id = "repair".into();
        binding.memory_outcome_policy_id = None;
        binding.checkpoint_definition_ids = vec!["first".into(), "second".into()];
    }
    assert_eq!(
        validate_composition(&graph, &registry)
            .unwrap()
            .profile_count,
        1
    );
    let definition = Definition {
        protocol_id: "external-protocol".into(),
        protocol_version: "v1".into(),
        checkpoints: ["first", "second"]
            .into_iter()
            .map(|id| CheckpointDefinition {
                checkpoint_id: id.into(),
                capability_objective_ids: vec!["recall".into()],
                required_for_completion: true,
            })
            .collect(),
        completion_policy: registry.completion("completion").unwrap().clone(),
    };
    let mut state = create_state("external-run", &definition).unwrap();
    for id in ["first", "second"] {
        let observation = Observation {
            observation_id: format!("observation-{id}"),
            attempt_id: format!("attempt-{id}"),
            action_id: format!("action-{id}"),
            kind: ObservationKind::CheckpointSatisfied,
            checkpoint_id: Some(id.into()),
            evidence_ids: vec![],
        };
        let result = decide_and_apply(
            &definition,
            registry.progression("external-two-checkpoint-v1").unwrap(),
            &state,
            &observation,
            &format!("decision-{id}"),
        )
        .unwrap();
        assert_eq!(result.state.completed, id == "second");
        let encoded = serde_json::to_string(&result.state).unwrap();
        let restored: State = serde_json::from_str(&encoded).unwrap();
        assert!(
            !apply_decision(&definition, &restored, &result.decision)
                .unwrap()
                .applied
        );
        state = restored;
    }
    assert_eq!(state.checkpoint_credits.len(), 2);
    assert!(registry.progression("unregistered").is_err());
}
#[test]
fn duplicate_axes_and_dangling_native_capabilities_fail_before_learning() {
    for axis in 0..5 {
        let eval = if axis == 0 {
            vec!["id".into(), "id".into()]
        } else {
            vec!["id".into()]
        };
        let progression: Vec<Box<dyn ProgressionPolicy>> = if axis == 1 {
            vec![Box::new(ExternalPolicy), Box::new(ExternalPolicy)]
        } else {
            vec![Box::new(ExternalPolicy)]
        };
        let mut completion = vec![("id".into(), CompletionPolicy::ProtocolCompletion)];
        if axis == 2 {
            completion.push(completion[0].clone());
        }
        let repair = if axis == 3 {
            vec!["id".into(), "id".into()]
        } else {
            vec![]
        };
        let memory = if axis == 4 {
            vec!["id".into(), "id".into()]
        } else {
            vec![]
        };
        assert!(Registry::new(eval, progression, completion, repair, memory).is_err());
    }
    assert!(Registry::new(vec!["\u{feff}".into()], vec![], vec![], vec![], vec![]).is_err());
    let mut graph = native_graph();
    let registry = native_registry().unwrap();
    assert!(validate_composition(&graph, &registry).is_ok());
    graph.step_kinds.retain(|kind| kind != "reveal");
    assert!(
        validate_composition(&graph, &registry)
            .unwrap_err()
            .contains("unknown Step renderer reveal")
    );
    let mut graph = native_graph();
    graph.profiles[0]
        .protocols
        .initial_learning
        .progression_policy_id = "run-reset-v1".into();
    assert!(
        validate_composition(&graph, &registry)
            .unwrap_err()
            .contains("Unknown Progression Policy")
    );
    // Migrating an inventory into the core doesn't enable it in the native product.
    assert!(
        existing_policy_inventory()
            .unwrap()
            .progression("run-reset-v1")
            .is_ok()
    );
}
