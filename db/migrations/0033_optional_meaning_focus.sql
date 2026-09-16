BEGIN;

-- Focus narrows an ambiguous Context; it is not part of the minimum complete
-- Context + Expression + Sense + Acceptance tuple.
ALTER TABLE sensa.sense_constructions
  ALTER COLUMN meaning_focus_id DROP NOT NULL,
  ALTER COLUMN meaning_focus_revision_id DROP NOT NULL;

ALTER TABLE sensa.sense_proposal_versions
  ALTER COLUMN meaning_focus_revision_id DROP NOT NULL;

ALTER TABLE sensa.sense_proposal_confirmations
  ALTER COLUMN meaning_focus_revision_id DROP NOT NULL;

ALTER TABLE sensa.personal_meaning_alignments
  ALTER COLUMN meaning_focus_id DROP NOT NULL,
  ALTER COLUMN meaning_focus_revision_id DROP NOT NULL;

ALTER TABLE sensa.sense_constructions
  ADD CONSTRAINT sense_constructions_focus_pair CHECK (
    (meaning_focus_id IS NULL) = (meaning_focus_revision_id IS NULL)
  );

ALTER TABLE sensa.personal_meaning_alignments
  ADD CONSTRAINT personal_meaning_alignments_focus_pair CHECK (
    (meaning_focus_id IS NULL) = (meaning_focus_revision_id IS NULL)
  );

CREATE OR REPLACE FUNCTION sensa.assert_sense_construction_identity()
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
    NEW.meaning_focus_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM sensa.meaning_focus_revisions AS focus_revisions
      WHERE focus_revisions.meaning_focus_revision_id = NEW.meaning_focus_revision_id
        AND focus_revisions.meaning_focus_id = NEW.meaning_focus_id
        AND focus_revisions.personal_meaning_id = NEW.personal_meaning_id
        AND focus_revisions.workspace_id = NEW.workspace_id
        AND focus_revisions.learner_user_id = NEW.learner_user_id
    )
  ) THEN
    RAISE EXCEPTION 'Sense Construction must pin a Personal Meaning revision and, when present, a Focus revision from that Meaning'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sense_confirmation_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  confirmed_sense_id UUID;
  confirmed_version_origin sensa.sense_version_origin;
  confirmed_review_status sensa.semantic_review_status;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.sense_proposal_versions AS versions
    WHERE versions.sense_proposal_version_id = NEW.sense_proposal_version_id
      AND versions.meaning_focus_revision_id IS NOT DISTINCT FROM NEW.meaning_focus_revision_id
      AND versions.workspace_id = NEW.workspace_id
      AND versions.learner_user_id = NEW.learner_user_id
  ) THEN
    RAISE EXCEPTION 'Sense confirmation scope or optional pinned Focus revision is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    versions.sense_id,
    versions.version_origin,
    versions.semantic_review_status
  INTO
    confirmed_sense_id,
    confirmed_version_origin,
    confirmed_review_status
  FROM sensa.sense_versions AS versions
  WHERE versions.sense_version_id = NEW.sense_version_id;
  IF confirmed_sense_id IS DISTINCT FROM NEW.sense_id THEN
    RAISE EXCEPTION 'Sense confirmation must pin a Version of its stable Sense'
      USING ERRCODE = '23514';
  END IF;
  IF confirmed_review_status = 'rejected' THEN
    RAISE EXCEPTION 'Sense confirmation cannot pin a rejected Sense Version'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.resolution = 'create_new'
    AND (
      confirmed_version_origin <> 'learner_confirmed'
      OR confirmed_review_status <> 'learner_confirmed'
    ) THEN
    RAISE EXCEPTION 'create_new confirmation must pin a learner-confirmed Sense Version'
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
    NEW.meaning_focus_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM sensa.meaning_focus_revisions AS focus_revisions
      WHERE focus_revisions.meaning_focus_revision_id = NEW.meaning_focus_revision_id
        AND focus_revisions.meaning_focus_id = NEW.meaning_focus_id
        AND focus_revisions.personal_meaning_id = NEW.personal_meaning_id
    )
  ) OR NOT EXISTS (
    SELECT 1
    FROM sensa.sense_proposal_confirmations AS confirmations
    WHERE confirmations.sense_proposal_confirmation_id = NEW.sense_proposal_confirmation_id
      AND confirmations.workspace_id = NEW.workspace_id
      AND confirmations.learner_user_id = NEW.learner_user_id
      AND confirmations.meaning_focus_revision_id IS NOT DISTINCT FROM NEW.meaning_focus_revision_id
      AND confirmations.sense_id = NEW.sense_id
      AND confirmations.sense_version_id = NEW.sense_version_id
  ) THEN
    RAISE EXCEPTION 'Personal Meaning Alignment must match its exact revisions and confirmation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
