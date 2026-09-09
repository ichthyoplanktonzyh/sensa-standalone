//! Composition root for capabilities actually executable by the local consumer.
//! The broader migrated policy inventory does not enable unimplemented renderers.
use sensa_core::policies::*;
use sensa_core::progression::{CompletionOnlyPolicy, CompletionPolicy};
use std::sync::OnceLock;

pub fn native_registry() -> Result<Registry, String> {
    Registry::new(
        vec![
            "lightweight-practice-observation-v1".into(),
            "learner-rating-v1".into(),
        ],
        vec![Box::new(CompletionOnlyPolicy::new("completion-only-v1")?)],
        [
            "study-completion-v1",
            "one-review-one-outcome-v1",
            "relearning-completion-v1",
        ]
        .into_iter()
        .map(|id| (id.into(), CompletionPolicy::ProtocolCompletion))
        .collect(),
        vec![
            "lightweight-retry-v1".into(),
            "lightweight-rebinding-v1".into(),
        ],
        vec!["learner-rated-graded-v1".into()],
    )
}
pub fn native_graph() -> Graph {
    let scopes = sensa_core::retention_scopes::default_registry();
    let scope = scopes
        .get("semantic_connection")
        .expect("registered default scope");
    let binding =
        |evaluation: &str, completion: &str, repair: &str, memory: Option<&str>| Binding {
            runtime_adapter_id: "native-consumer-v1".into(),
            orchestration_id: "native-recall-reveal-v1".into(),
            evaluation_policy_id: evaluation.into(),
            progression_policy_id: "completion-only-v1".into(),
            completion_policy_id: completion.into(),
            repair_policy_id: repair.into(),
            memory_outcome_policy_id: memory.map(String::from),
            checkpoint_definition_ids: vec![],
            content_requirement: vec!["recall-reveal-text".into()],
        };
    Graph {
        profiles: vec![Profile {
            profile_id: "lightweight".into(),
            lifecycle: Lifecycle {
                provisioning_fallback: Fallback::Blocked,
            },
            protocols: Purposes {
                initial_learning: binding(
                    "lightweight-practice-observation-v1",
                    "study-completion-v1",
                    "lightweight-retry-v1",
                    None,
                ),
                retention_review: binding(
                    "learner-rating-v1",
                    "one-review-one-outcome-v1",
                    "lightweight-rebinding-v1",
                    Some("learner-rated-graded-v1"),
                ),
                relearning: binding(
                    "lightweight-practice-observation-v1",
                    "relearning-completion-v1",
                    "lightweight-rebinding-v1",
                    None,
                ),
            },
        }],
        adapters: vec![Adapter {
            adapter_id: "native-consumer-v1".into(),
            retention_store_id: "sqlite-consumer-v1".into(),
            surfaces: Purposes {
                initial_learning: "flutter-local-learning".into(),
                retention_review: "flutter-local-learning".into(),
                relearning: "flutter-local-learning".into(),
            },
        }],
        orchestrations: vec![Orchestration {
            orchestration_id: "native-recall-reveal-v1".into(),
            required_step_kinds: vec!["recall".into(), "reveal".into()],
            initial_completion: Some(serde_json::json!({"kind":"study_completion"})),
        }],
        surfaces: vec!["flutter-local-learning".into()],
        retention_stores: vec!["sqlite-consumer-v1".into()],
        // Validated native Material supplies the compact Context/Sense/Expression
        // resource; recall-reveal-text is its current renderer capability.
        content_capability_ids: vec![
            "recall-reveal-text".into(),
            "compact_learning_material".into(),
        ],
        step_kinds: vec!["recall".into(), "reveal".into()],
        retention_scopes: vec![Scope {
            scope_id: scope.scope_id.clone(),
            content_requirement: scope.content_requirement.clone(),
        }],
    }
}
pub(super) fn validate() -> Result<(), String> {
    static VALIDATED: OnceLock<Result<(), String>> = OnceLock::new();
    VALIDATED
        .get_or_init(|| {
            let scopes = sensa_core::retention_scopes::default_registry();
            for s in &native_graph().retention_scopes {
                scopes.get(&s.scope_id)?;
            }
            validate_composition(&native_graph(), &native_registry()?).map(|_| ())
        })
        .clone()
}

/// Resolve supported executable contracts by binding, independent of profile names.
/// A registry entry alone does not promise that a concrete runtime supports it.
pub fn validate_structured_spec(
    purpose: &str,
    spec: &sensa_core::planning::ProtocolSpec,
) -> Result<(), String> {
    let b = &spec.binding;
    let (protocol, orchestration, completion, memory, progression) = match purpose {
        "initial_learning" => (
            "structured-acquisition",
            "structured_acquisition",
            "all-required-current-epoch-v1",
            None,
            &["structured-current-checkpoint-reset-v1", "run-reset-v1"][..],
        ),
        "retention_review" => (
            "evidence-oriented-retention-review",
            "structured_retention",
            "one-review-one-outcome-v1",
            Some("behavioral-binary-graded-v1"),
            &["completion-only-v1"][..],
        ),
        "relearning" => (
            "targeted-structured-relearning",
            "structured_retention",
            "relearning-completion-v1",
            None,
            &["structured-current-checkpoint-reset-v1"][..],
        ),
        _ => return Err("Unknown structured purpose".into()),
    };
    if spec.protocol_id != protocol
        || spec.protocol_version != "v1"
        || b.runtime_adapter_id != "structured"
        || b.orchestration_id != orchestration
        || b.evaluation_policy_id != "structured-behavioral-v1"
        || !progression.contains(&b.progression_policy_id.as_str())
        || b.completion_policy_id != completion
        || b.repair_policy_id != "structured-targeted-repair-v1"
        || b.memory_outcome_policy_id.as_deref() != memory
        || b.content_requirement != ["structured_learning_package"]
    {
        return Err("Unsupported structured executable composition".into());
    }
    let expected = if purpose == "initial_learning" {
        vec![
            "structured-acquisition:contextual_recognition",
            "structured-acquisition:meaning_to_form_recall",
            "structured-acquisition:novel_context_transfer",
            "structured-acquisition:boundary_discrimination",
        ]
    } else {
        vec![]
    };
    if b.checkpoint_definition_ids != expected {
        return Err("Unsupported structured checkpoint definition".into());
    }
    let registry = existing_policy_inventory()?;
    registry.progression(&b.progression_policy_id)?;
    registry.completion(&b.completion_policy_id)?;
    Ok(())
}

/// The executor has no implicit scheduling/evidence fallback.
pub fn validate_structured_profile(profile: &sensa_core::planning::Profile) -> Result<(), String> {
    if profile.lifecycle["schedulingPolicyId"] != "fsrs-retention-v1"
        || profile.lifecycle["evidencePolicyId"] != "behavioral-acquisition-evidence-v1"
        || profile.lifecycle["migrationPolicy"] != "pin_existing_runs"
    {
        return Err("Unsupported structured lifecycle policies".into());
    }
    for (purpose, spec) in profile.protocols.entries() {
        validate_structured_spec(purpose, spec)?;
    }
    Ok(())
}
