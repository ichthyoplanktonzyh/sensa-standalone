BEGIN;

-- Entry surfaces do not own different Personal Meaning models. A completed
-- Intake is accepted either through a real Sense Construction or by directly
-- accepting an already complete Context–Expression–Sense tuple.
CREATE TYPE sensa.personal_alignment_basis_kind AS ENUM (
  'sense_construction',
  'contextual_resolution'
);

CREATE TABLE sensa.semantic_acceptances (
  semantic_acceptance_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  authority JSONB NOT NULL,
  personal_semantic_anchor_revision_id UUID NOT NULL,
  personal_expression_anchor_revision_id UUID NOT NULL,
  expression_occurrence JSONB NOT NULL,
  resolution sensa.sense_confirmation_resolution NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  resolution_provenance JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT semantic_acceptances_semantic_anchor_fk FOREIGN KEY (
    personal_semantic_anchor_revision_id
  ) REFERENCES sensa.personal_semantic_anchor_revisions (
    personal_semantic_anchor_revision_id
  ) ON DELETE CASCADE,
  CONSTRAINT semantic_acceptances_expression_anchor_fk FOREIGN KEY (
    personal_expression_anchor_revision_id
  ) REFERENCES sensa.personal_expression_anchor_revisions (
    personal_expression_anchor_revision_id
  ) ON DELETE CASCADE,
  CONSTRAINT semantic_acceptances_authority_object CHECK (jsonb_typeof(authority) = 'object'),
  CONSTRAINT semantic_acceptances_occurrence_object CHECK (
    jsonb_typeof(expression_occurrence) = 'object'
  ),
  CONSTRAINT semantic_acceptances_provenance_object CHECK (
    jsonb_typeof(resolution_provenance) = 'object'
  ),
  CONSTRAINT semantic_acceptances_scope_unique UNIQUE (
    semantic_acceptance_id, workspace_id, learner_user_id
  )
);

ALTER TABLE sensa.personal_meaning_alignments
  ADD COLUMN basis_kind sensa.personal_alignment_basis_kind NOT NULL
    DEFAULT 'sense_construction',
  ADD COLUMN semantic_acceptance_id UUID;

ALTER TABLE sensa.personal_meaning_alignments
  ALTER COLUMN basis_kind DROP DEFAULT,
  ALTER COLUMN sense_proposal_confirmation_id DROP NOT NULL;

ALTER TABLE sensa.personal_meaning_alignments
  ADD CONSTRAINT personal_meaning_alignments_acceptance_fk FOREIGN KEY (
    semantic_acceptance_id, workspace_id, learner_user_id
  ) REFERENCES sensa.semantic_acceptances (
    semantic_acceptance_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  ADD CONSTRAINT personal_meaning_alignments_basis_shape CHECK (
    (
      basis_kind = 'sense_construction'
      AND sense_proposal_confirmation_id IS NOT NULL
      AND semantic_acceptance_id IS NULL
    ) OR (
      basis_kind = 'contextual_resolution'
      AND sense_proposal_confirmation_id IS NULL
      AND semantic_acceptance_id IS NOT NULL
      AND meaning_focus_id IS NULL
      AND meaning_focus_revision_id IS NULL
    )
  ),
  ADD CONSTRAINT personal_meaning_alignments_acceptance_unique UNIQUE (
    semantic_acceptance_id
  );

CREATE OR REPLACE FUNCTION sensa.assert_semantic_acceptance_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.personal_semantic_anchor_revisions AS semantic_revisions
    JOIN sensa.personal_expression_anchor_revisions AS expression_revisions
      ON expression_revisions.personal_meaning_id = semantic_revisions.personal_meaning_id
      AND expression_revisions.workspace_id = semantic_revisions.workspace_id
      AND expression_revisions.learner_user_id = semantic_revisions.learner_user_id
    WHERE semantic_revisions.personal_semantic_anchor_revision_id
        = NEW.personal_semantic_anchor_revision_id
      AND expression_revisions.personal_expression_anchor_revision_id
        = NEW.personal_expression_anchor_revision_id
      AND semantic_revisions.workspace_id = NEW.workspace_id
      AND semantic_revisions.learner_user_id = NEW.learner_user_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM sensa.sense_versions AS versions
    WHERE versions.sense_version_id = NEW.sense_version_id
      AND versions.sense_id = NEW.sense_id
  ) THEN
    RAISE EXCEPTION 'Semantic Acceptance must pin one learner Context/Expression pair and a Version of its Sense'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_personal_alignment_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.personal_meaning_revisions AS meaning_revisions
    WHERE meaning_revisions.personal_meaning_revision_id = NEW.personal_meaning_revision_id
      AND meaning_revisions.personal_meaning_id = NEW.personal_meaning_id
      AND meaning_revisions.workspace_id = NEW.workspace_id
      AND meaning_revisions.learner_user_id = NEW.learner_user_id
  ) OR (
    NEW.basis_kind = 'sense_construction'
    AND NEW.meaning_focus_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM sensa.meaning_focus_revisions AS focus_revisions
      WHERE focus_revisions.meaning_focus_revision_id = NEW.meaning_focus_revision_id
        AND focus_revisions.meaning_focus_id = NEW.meaning_focus_id
        AND focus_revisions.personal_meaning_id = NEW.personal_meaning_id
        AND focus_revisions.workspace_id = NEW.workspace_id
        AND focus_revisions.learner_user_id = NEW.learner_user_id
    )
  ) OR (
    NEW.basis_kind = 'sense_construction'
    AND NOT EXISTS (
      SELECT 1
      FROM sensa.sense_proposal_confirmations AS confirmations
      WHERE confirmations.sense_proposal_confirmation_id = NEW.sense_proposal_confirmation_id
        AND confirmations.workspace_id = NEW.workspace_id
        AND confirmations.learner_user_id = NEW.learner_user_id
        AND confirmations.meaning_focus_revision_id IS NOT DISTINCT FROM NEW.meaning_focus_revision_id
        AND confirmations.sense_id = NEW.sense_id
        AND confirmations.sense_version_id = NEW.sense_version_id
    )
  ) OR (
    NEW.basis_kind = 'contextual_resolution'
    AND NOT EXISTS (
      SELECT 1
      FROM sensa.semantic_acceptances AS acceptances
      JOIN sensa.personal_semantic_anchor_revisions AS semantic_revisions
        ON semantic_revisions.personal_semantic_anchor_revision_id
          = acceptances.personal_semantic_anchor_revision_id
      JOIN sensa.personal_expression_anchor_revisions AS expression_revisions
        ON expression_revisions.personal_expression_anchor_revision_id
          = acceptances.personal_expression_anchor_revision_id
      WHERE acceptances.semantic_acceptance_id = NEW.semantic_acceptance_id
        AND acceptances.workspace_id = NEW.workspace_id
        AND acceptances.learner_user_id = NEW.learner_user_id
        AND semantic_revisions.personal_meaning_id = NEW.personal_meaning_id
        AND expression_revisions.personal_meaning_id = NEW.personal_meaning_id
        AND acceptances.sense_id = NEW.sense_id
        AND acceptances.sense_version_id = NEW.sense_version_id
    )
  ) THEN
    RAISE EXCEPTION 'Personal Meaning Alignment must match its exact revision and chosen acceptance basis'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER semantic_acceptances_identity_guard
BEFORE INSERT ON sensa.semantic_acceptances
FOR EACH ROW EXECUTE FUNCTION sensa.assert_semantic_acceptance_identity();

CREATE TRIGGER semantic_acceptances_immutable_guard
BEFORE UPDATE ON sensa.semantic_acceptances
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();

ALTER TABLE sensa.semantic_acceptances ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON TABLE sensa.semantic_acceptances TO backend_app;

CREATE POLICY semantic_acceptances_learner_scope
ON sensa.semantic_acceptances
FOR ALL TO backend_app
USING (
  security.current_workspace_access_allowed(workspace_id)
  AND learner_user_id = security.current_user_id()
)
WITH CHECK (
  security.current_workspace_access_allowed(workspace_id)
  AND learner_user_id = security.current_user_id()
);

COMMENT ON TABLE sensa.semantic_acceptances IS
  'Explicit direct or delegated acceptance of one complete Context–Expression–Sense tuple, independent of entry surface.';
COMMENT ON COLUMN sensa.personal_meaning_alignments.basis_kind IS
  'The semantic basis of the Alignment; never the browser, Agent or Web entry that delivered it.';

REVOKE ALL ON FUNCTION sensa.assert_semantic_acceptance_identity() FROM PUBLIC, backend_app;

COMMIT;
