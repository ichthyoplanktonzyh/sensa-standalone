-- Stop Policy V2 and Memory Outcome V3 make the completion classification an
-- explicit, replayable Decision with stable reason codes. There is
-- deliberately no compatibility path: pre-launch Encounter progress must be
-- reset rather than silently reinterpreted.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sensa.sense_encounters)
    OR EXISTS (SELECT 1 FROM sensa.memory_outcomes) THEN
    RAISE EXCEPTION
      'Reset pre-launch learner progress before enabling explicit completion Decisions';
  END IF;
END;
$$;

ALTER TABLE sensa.sense_encounters
  ADD COLUMN stop_policy_decision_code TEXT,
  ALTER COLUMN stop_policy_version SET DEFAULT 'sensa-stop-policy-v2',
  ALTER COLUMN outcome_mapping_version SET DEFAULT 'sensa-memory-outcome-v3',
  DROP CONSTRAINT IF EXISTS sense_encounters_versions_nonempty;

ALTER TABLE sensa.sense_encounters
  ADD CONSTRAINT sense_encounters_versions_nonempty CHECK (
    capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1'
    AND semantic_policy_version = 'sensa-semantic-policy-v2'
    AND stop_policy_version = 'sensa-stop-policy-v2'
    AND evidence_rule_version = 'sensa-evidence-rule-v2'
    AND state_updater_version = 'sensa-state-updater-v2'
    AND outcome_mapping_version = 'sensa-memory-outcome-v3'
  ),
  ADD CONSTRAINT sense_encounters_stop_policy_decision_code CHECK (
    stop_policy_decision_code IS NULL
    OR stop_policy_decision_code IN (
      'introduction_grounding_accepted',
      'retrieval_failure_limit_reached',
      'retrieval_succeeded'
    )
  ),
  ADD CONSTRAINT sense_encounters_stop_decision_shape CHECK (
    (status = 'completed' AND stop_policy_decision_code IS NOT NULL)
    OR (status <> 'completed' AND stop_policy_decision_code IS NULL)
  );

ALTER TABLE sensa.memory_outcomes
  ADD COLUMN decision_code TEXT NOT NULL,
  ALTER COLUMN outcome_mapping_version SET DEFAULT 'sensa-memory-outcome-v3',
  DROP CONSTRAINT IF EXISTS memory_outcomes_mapping_version,
  DROP CONSTRAINT IF EXISTS memory_outcomes_v2_shape;

ALTER TABLE sensa.memory_outcomes
  ADD CONSTRAINT memory_outcomes_mapping_version CHECK (
    outcome_mapping_version = 'sensa-memory-outcome-v3'
  ),
  ADD CONSTRAINT memory_outcomes_decision_code CHECK (
    decision_code IN (
      'introduced_after_grounding',
      'retrieval_failed_after_failure_limit',
      'supported_retrieval_after_prior_failure',
      'supported_retrieval_after_strong_support',
      'independent_retrieval_without_support',
      'transfer_confirmed_after_novel_cloze'
    )
  ),
  ADD CONSTRAINT memory_outcomes_v3_shape CHECK (
    (
      outcome_mapping_version = 'sensa-memory-outcome-v3'
      AND outcome_kind = 'introduced'
      AND decision_code = 'introduced_after_grounding'
      AND schedule_disposition = 'acquisition_pending'
      AND fsrs_rating IS NULL
      AND effective_reviewed_at IS NULL
      AND NOT review_time_clamped
      AND review_time_clamp_reason IS NULL
      AND fsrs_adapter_version IS NULL
      AND scheduler_settings_digest IS NULL
    )
    OR (
      outcome_mapping_version = 'sensa-memory-outcome-v3'
      AND outcome_kind <> 'introduced'
      AND (
        (outcome_kind = 'retrieval_failed'
          AND decision_code = 'retrieval_failed_after_failure_limit')
        OR (outcome_kind = 'supported_retrieval'
          AND decision_code IN (
            'supported_retrieval_after_prior_failure',
            'supported_retrieval_after_strong_support'
          ))
        OR (outcome_kind = 'independent_retrieval'
          AND decision_code = 'independent_retrieval_without_support')
        OR (outcome_kind = 'transfer_confirmed'
          AND decision_code = 'transfer_confirmed_after_novel_cloze')
      )
      AND schedule_disposition = 'fsrs_applied'
      AND fsrs_rating IS NOT NULL
      AND effective_reviewed_at IS NOT NULL
      AND fsrs_adapter_version = 'sensa-fsrs-adapter-v2'
      AND scheduler_settings_digest IS NOT NULL
      AND scheduler_settings_digest ~ '^[0-9a-f]{64}$'
      AND scheduler_settings_digest = lower(scheduler_settings_digest)
      AND (
        (outcome_kind = 'retrieval_failed' AND fsrs_rating = 0)
        OR (outcome_kind = 'supported_retrieval' AND fsrs_rating = 1)
        OR (outcome_kind = 'independent_retrieval' AND fsrs_rating = 2)
        OR (outcome_kind = 'transfer_confirmed' AND fsrs_rating = 3)
      )
      AND (
        (
          NOT review_time_clamped
          AND review_time_clamp_reason IS NULL
          AND effective_reviewed_at = observed_completed_at
        )
        OR (
          review_time_clamped
          AND review_time_clamp_reason = 'previous_accepted_review_time'
          AND effective_reviewed_at > observed_completed_at
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION sensa.guard_memory_outcome_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_sense_id UUID;
  v_status sensa.encounter_status;
  v_state_revision BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT encounters.workspace_id,
           encounters.learner_user_id,
           encounters.sense_id,
           encounters.status
      INTO v_workspace_id,
           v_learner_user_id,
           v_sense_id,
           v_status
    FROM sensa.sense_encounters AS encounters
    WHERE encounters.sense_encounter_id = NEW.sense_encounter_id;
    IF v_workspace_id IS NULL THEN
      RAISE EXCEPTION 'Memory Outcome Encounter does not exist'
        USING ERRCODE = '23503';
    END IF;
    IF NEW.workspace_id IS DISTINCT FROM v_workspace_id
      OR NEW.learner_user_id IS DISTINCT FROM v_learner_user_id
      OR NEW.sense_id IS DISTINCT FROM v_sense_id THEN
      RAISE EXCEPTION 'Memory Outcome scope does not match Encounter'
        USING ERRCODE = '23514';
    END IF;
    IF v_status NOT IN ('active', 'completed') THEN
      RAISE EXCEPTION 'Interrupted or cancelled Encounters cannot emit Memory Outcomes'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.outcome_mapping_version <> 'sensa-memory-outcome-v3' THEN
      RAISE EXCEPTION 'Unsupported Memory Outcome mapping version'
        USING ERRCODE = '23514';
    END IF;
    SELECT states.revision INTO v_state_revision
    FROM sensa.sense_memory_states AS states
    WHERE states.workspace_id = NEW.workspace_id
      AND states.learner_user_id = NEW.learner_user_id
      AND states.sense_id = NEW.sense_id;
    IF v_state_revision IS NULL THEN
      IF NEW.prior_memory_revision <> 0 THEN
        RAISE EXCEPTION 'First Memory Outcome must start at memory revision zero'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.prior_memory_revision <> v_state_revision THEN
      RAISE EXCEPTION 'Memory Outcome prior revision is stale'
        USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Memory Outcomes are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_encounter_decision_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_encounter_id UUID;
  v_status sensa.encounter_status;
  v_stop_code TEXT;
  v_outcome_kind sensa.memory_outcome_kind;
  v_outcome_decision_code TEXT;
BEGIN
  IF TG_TABLE_NAME = 'sense_encounters' THEN
    v_encounter_id := NEW.sense_encounter_id;
  ELSE
    v_encounter_id := NEW.sense_encounter_id;
  END IF;

  SELECT encounters.status, encounters.stop_policy_decision_code
    INTO v_status, v_stop_code
  FROM sensa.sense_encounters AS encounters
  WHERE encounters.sense_encounter_id = v_encounter_id;

  IF v_status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT outcomes.outcome_kind, outcomes.decision_code
    INTO v_outcome_kind, v_outcome_decision_code
  FROM sensa.memory_outcomes AS outcomes
  WHERE outcomes.sense_encounter_id = v_encounter_id;

  IF v_outcome_kind IS NULL THEN
    RETURN NEW;
  END IF;

  IF (v_stop_code = 'introduction_grounding_accepted'
        AND v_outcome_kind <> 'introduced')
    OR (v_stop_code = 'retrieval_failure_limit_reached'
        AND v_outcome_kind <> 'retrieval_failed')
    OR (v_stop_code = 'retrieval_succeeded'
        AND v_outcome_kind NOT IN (
          'supported_retrieval',
          'independent_retrieval',
          'transfer_confirmed'
        )) THEN
    RAISE EXCEPTION 'Stop Policy Decision and Memory Outcome Decision are inconsistent'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER sensa_sense_encounters_decision_consistency
AFTER INSERT OR UPDATE ON sensa.sense_encounters
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_encounter_decision_consistency();

CREATE CONSTRAINT TRIGGER sensa_memory_outcomes_decision_consistency
AFTER INSERT OR UPDATE ON sensa.memory_outcomes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_encounter_decision_consistency();

COMMENT ON COLUMN sensa.sense_encounters.stop_policy_decision_code IS
  'Stable Stop Policy V2 reason code. Present exactly when the Encounter completed.';
COMMENT ON COLUMN sensa.memory_outcomes.decision_code IS
  'Stable Memory Outcome V3 classification reason code paired with outcome_kind.';
