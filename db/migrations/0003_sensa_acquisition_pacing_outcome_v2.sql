-- Memory Outcome V2 separates acquisition pacing from FSRS scheduling.
-- This pre-launch repository intentionally carries one active Outcome model;
-- development databases must reset V1 learner progress before this migration.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sensa.memory_outcomes
    WHERE outcome_mapping_version <> 'sensa-memory-outcome-v2'
  ) THEN
    RAISE EXCEPTION
      'Reset pre-launch learner progress before enabling Memory Outcome V2';
  END IF;
END;
$$;

ALTER TABLE sensa.memory_outcomes
  ADD COLUMN schedule_disposition TEXT NOT NULL DEFAULT 'fsrs_applied';

ALTER TABLE sensa.memory_outcomes
  ALTER COLUMN schedule_disposition DROP DEFAULT,
  ALTER COLUMN fsrs_rating DROP NOT NULL,
  ALTER COLUMN effective_reviewed_at DROP NOT NULL,
  ALTER COLUMN fsrs_adapter_version DROP NOT NULL,
  ALTER COLUMN scheduler_settings_digest DROP NOT NULL;

ALTER TABLE sensa.memory_outcomes
  DROP CONSTRAINT IF EXISTS memory_outcomes_mapping_version,
  DROP CONSTRAINT IF EXISTS memory_outcomes_rating_range,
  DROP CONSTRAINT IF EXISTS memory_outcomes_time_shape,
  DROP CONSTRAINT IF EXISTS memory_outcomes_adapter_nonempty,
  DROP CONSTRAINT IF EXISTS memory_outcomes_mapping_rating;

ALTER TABLE sensa.memory_outcomes
  ADD CONSTRAINT memory_outcomes_mapping_version CHECK (
    outcome_mapping_version = 'sensa-memory-outcome-v2'
  ),
  ADD CONSTRAINT memory_outcomes_schedule_disposition CHECK (
    schedule_disposition IN ('acquisition_pending', 'fsrs_applied')
  ),
  ADD CONSTRAINT memory_outcomes_rating_range CHECK (
    fsrs_rating IS NULL OR fsrs_rating BETWEEN 0 AND 3
  ),
  ADD CONSTRAINT memory_outcomes_v2_shape CHECK (
    (
      outcome_mapping_version = 'sensa-memory-outcome-v2'
      AND outcome_kind = 'introduced'
      AND schedule_disposition = 'acquisition_pending'
      AND fsrs_rating IS NULL
      AND effective_reviewed_at IS NULL
      AND NOT review_time_clamped
      AND review_time_clamp_reason IS NULL
      AND fsrs_adapter_version IS NULL
      AND scheduler_settings_digest IS NULL
    )
    OR (
      outcome_mapping_version = 'sensa-memory-outcome-v2'
      AND outcome_kind <> 'introduced'
      AND schedule_disposition = 'fsrs_applied'
      AND fsrs_rating IS NOT NULL
      AND effective_reviewed_at IS NOT NULL
      AND fsrs_adapter_version IS NOT NULL
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
          AND review_time_clamp_reason IS NOT NULL
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
    IF NEW.outcome_mapping_version <> 'sensa-memory-outcome-v2' THEN
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

COMMENT ON COLUMN sensa.memory_outcomes.schedule_disposition IS
  'acquisition_pending means no FSRS review occurred; fsrs_applied carries a complete scheduler result.';
