-- Learning execution is device-local. Remove the retired server-owned replica,
-- planning, encounter, retention and content-provisioning stores. There is no
-- compatibility migration because these tables never held production user data.

DROP VIEW IF EXISTS sensa_consumer.catalog_candidates;

-- One statement intentionally names the complete connected graph so PostgreSQL
-- can remove the former runtime's internal foreign-key cycles without CASCADE.
DROP TABLE IF EXISTS
  sensa_consumer.provisioning_attempts,
  sensa_consumer.provisioning_tasks,
  sensa_consumer.anchor_use_grants,
  sensa_consumer.personal_meanings,
  sensa_consumer.intakes,
  sensa_consumer.accepted_semantic_identities,
  sensa_consumer.checkins,
  sensa_consumer.account_clock_grants,
  sensa_consumer.relearning_needs,
  sensa_consumer.memory_outcomes,
  sensa_consumer.retention_memory,
  sensa_consumer.scheduling_decisions,
  sensa_consumer.scheduling_handoffs,
  sensa_consumer.completions,
  sensa_consumer.run_transitions,
  sensa_consumer.run_attempts,
  sensa_consumer.offline_grants,
  sensa_consumer.run_steps,
  sensa_consumer.daily_starts,
  sensa_consumer.activity_runs,
  sensa_consumer.runs,
  sensa_consumer.activities,
  sensa_consumer.policy_commitments,
  sensa_consumer.target_plans,
  sensa_consumer.target_sources,
  sensa_consumer.target_memberships,
  sensa_consumer.declared_masteries,
  sensa_consumer.canonical_targets,
  sensa_consumer.learner_scopes,
  sensa_consumer.target_candidates,
  sensa_consumer.published_media,
  sensa_consumer.plans,
  sensa_consumer.operations,
  sensa_consumer.changes,
  sensa_consumer.installations;

ALTER TABLE sensa.learning_targets
  DROP CONSTRAINT IF EXISTS consumer_learning_identity_unique;

DROP FUNCTION IF EXISTS sensa_consumer.guard_anchor_use_grant();
DROP FUNCTION IF EXISTS sensa_consumer.guard_provisioning_snapshot();
DROP FUNCTION IF EXISTS sensa_consumer.create_accepted_semantic_identity(
  UUID,UUID,UUID,UUID,UUID,UUID,JSONB,TEXT,TEXT,JSONB
);
