-- Persist the server-owned reason for every immutable Learning Action.
-- Pre-launch development progress is reset rather than carried through an
-- unclassified compatibility value.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sensa.learning_actions) THEN
    RAISE EXCEPTION
      'Reset pre-launch learner progress before enabling Semantic Policy decisions';
  END IF;
END;
$$;

ALTER TABLE sensa.learning_actions
  ADD COLUMN semantic_policy_decision_code TEXT NOT NULL;

ALTER TABLE sensa.sense_encounters
  ALTER COLUMN semantic_policy_version SET DEFAULT 'sensa-semantic-policy-v2',
  DROP CONSTRAINT IF EXISTS sense_encounters_versions_nonempty;

ALTER TABLE sensa.sense_encounters
  ADD CONSTRAINT sense_encounters_versions_nonempty CHECK (
    semantic_policy_version = 'sensa-semantic-policy-v2'
    AND stop_policy_version = 'sensa-stop-policy-v1'
    AND evidence_rule_version = 'sensa-evidence-rule-v2'
    AND state_updater_version = 'sensa-state-updater-v2'
    AND outcome_mapping_version = 'sensa-memory-outcome-v2'
  );

ALTER TABLE sensa.learning_actions
  ADD CONSTRAINT learning_actions_policy_decision_code CHECK (
    semantic_policy_decision_code IN (
      'introduction_grounding',
      'boundary_gap',
      'retrieval_repair',
      'retrieval_first_meaning_to_form',
      'retrieval_first_cloze',
      'retrieval_continue_meaning_to_form',
      'retrieval_continue_cloze'
    )
  ),
  ADD CONSTRAINT learning_actions_policy_decision_shape CHECK (
    action_schema_version = 'sensa-learning-action-v3'
    AND (
      (
        semantic_policy_decision_code = 'introduction_grounding'
        AND action_payload ->> 'kind' = 'grounding_bind'
        AND target_dimension = 'grounding'
        AND primitive IN ('visual_grounding', 'production_cue')
        AND scaffold_level = 'full'
        AND renderer_kind = 'content'
      )
      OR (
        semantic_policy_decision_code = 'boundary_gap'
        AND action_payload ->> 'kind' = 'boundary_discrimination'
        AND target_dimension = 'boundary'
        AND primitive IN ('contrast_pair', 'counterexample')
        AND scaffold_level = 'none'
        AND renderer_kind = 'single_choice'
      )
      OR (
        semantic_policy_decision_code = 'retrieval_repair'
        AND action_payload ->> 'kind' = 'retrieval_repair'
        AND target_dimension = 'retrieval'
        AND primitive = 'production_cue'
        AND scaffold_level = 'full'
        AND renderer_kind = 'content'
      )
      OR (
        semantic_policy_decision_code IN (
          'retrieval_first_meaning_to_form',
          'retrieval_continue_meaning_to_form'
        )
        AND action_payload ->> 'kind' = 'meaning_to_form_recall'
        AND target_dimension = 'retrieval'
        AND primitive = 'production_cue'
        AND scaffold_level IN ('none', 'reduced')
        AND renderer_kind = 'text_input'
      )
      OR (
        semantic_policy_decision_code IN (
          'retrieval_first_cloze',
          'retrieval_continue_cloze'
        )
        AND action_payload ->> 'kind' = 'cloze_recall'
        AND target_dimension = 'retrieval'
        AND primitive = 'contextual_variation'
        AND scaffold_level IN ('none', 'reduced')
        AND renderer_kind = 'text_input'
      )
    )
  );

CREATE OR REPLACE FUNCTION sensa.guard_learning_action_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_encounter_workspace UUID;
  v_encounter_user TEXT;
  v_encounter_rule TEXT;
  v_encounter_policy TEXT;
  v_encounter_status sensa.encounter_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT encounters.workspace_id,
           encounters.learner_user_id,
           encounters.evidence_rule_version,
           encounters.semantic_policy_version,
           encounters.status
      INTO v_encounter_workspace,
           v_encounter_user,
           v_encounter_rule,
           v_encounter_policy,
           v_encounter_status
    FROM sensa.sense_encounters AS encounters
    WHERE encounters.sense_encounter_id = NEW.sense_encounter_id;
    IF v_encounter_workspace IS DISTINCT FROM NEW.workspace_id
      OR v_encounter_user IS DISTINCT FROM NEW.learner_user_id
      OR v_encounter_status <> 'active'
      OR NEW.evidence_rule_version IS DISTINCT FROM v_encounter_rule
      OR v_encounter_policy <> 'sensa-semantic-policy-v2'
      OR NEW.action_schema_version <> 'sensa-learning-action-v3' THEN
      RAISE EXCEPTION 'Learning Action must belong to an active Encounter and its current rule versions'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Learning Actions are immutable'
    USING ERRCODE = '23514';
END;
$$;

COMMENT ON COLUMN sensa.learning_actions.semantic_policy_decision_code IS
  'Stable Semantic Policy reason code explaining why this immutable Action was selected.';
