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
        content_capability_ids: vec!["recall-reveal-text".into()],
        step_kinds: vec!["recall".into(), "reveal".into()],
        retention_scopes: vec![Scope {
            scope_id: "primary".into(),
            content_requirement: vec!["recall-reveal-text".into()],
        }],
    }
}
pub(super) fn validate() -> Result<(), String> {
    static VALIDATED: OnceLock<Result<(), String>> = OnceLock::new();
    VALIDATED
        .get_or_init(|| validate_composition(&native_graph(), &native_registry()?).map(|_| ()))
        .clone()
}
