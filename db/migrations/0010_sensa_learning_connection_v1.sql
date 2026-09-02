-- Learning Connection identity v1.
--
-- This migration lands the durable learner × Sense × target-expression seam
-- before Protocol Run and scheduler cutover. It intentionally does not reuse
-- legacy learner × Sense memory rows. Learner Sense Progress remains a derived
-- roll-up and therefore has no writable table here.

DO $$
BEGIN
  CREATE TYPE sensa.retention_target_status AS ENUM ('active', 'paused', 'retired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.content_provisioning_path AS ENUM (
    'published',
    'on_demand',
    'hybrid'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.learning_protocol_purpose AS ENUM (
    'initial_learning',
    'retention_review',
    'relearning'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.personal_anchor_use_purpose AS ENUM (
    'content_generation',
    'learning_scaffold'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.materialization_validation_status AS ENUM (
    'validated',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE sensa.retention_targets (
  retention_target_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_expression_binding_id UUID NOT NULL
    REFERENCES sensa.sense_expression_bindings(sense_expression_binding_id) ON DELETE RESTRICT,
  retention_scope_key TEXT NOT NULL DEFAULT 'general',
  status sensa.retention_target_status NOT NULL DEFAULT 'active',
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retention_targets_scope_key_nonempty CHECK (btrim(retention_scope_key) <> ''),
  CONSTRAINT retention_targets_revision_positive CHECK (revision > 0),
  CONSTRAINT retention_targets_domain_identity_unique UNIQUE (
    learner_user_id,
    sense_id,
    sense_expression_binding_id,
    retention_scope_key
  ),
  CONSTRAINT retention_targets_scope_unique UNIQUE (
    retention_target_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.learning_targets (
  learning_target_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  retention_target_id UUID NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  sense_expression_binding_id UUID NOT NULL
    REFERENCES sensa.sense_expression_bindings(sense_expression_binding_id) ON DELETE RESTRICT,
  binding_version_id UUID NOT NULL
    REFERENCES sensa.sense_expression_binding_versions(binding_version_id) ON DELETE RESTRICT,
  familiar_language_tag TEXT NOT NULL,
  target_language_tag TEXT NOT NULL,
  learner_locale TEXT NOT NULL,
  retention_scope_key TEXT NOT NULL DEFAULT 'general',
  curriculum_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_targets_retention_target_fk FOREIGN KEY (
    retention_target_id, workspace_id, learner_user_id
  ) REFERENCES sensa.retention_targets (
    retention_target_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT learning_targets_languages_nonempty CHECK (
    btrim(familiar_language_tag) <> ''
    AND btrim(target_language_tag) <> ''
    AND familiar_language_tag <> target_language_tag
  ),
  CONSTRAINT learning_targets_locale_nonempty CHECK (btrim(learner_locale) <> ''),
  CONSTRAINT learning_targets_scope_key_nonempty CHECK (btrim(retention_scope_key) <> ''),
  CONSTRAINT learning_targets_curriculum_provenance_object CHECK (
    jsonb_typeof(curriculum_provenance) = 'object'
  ),
  CONSTRAINT learning_targets_scope_unique UNIQUE (
    learning_target_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.learning_target_personal_sources (
  learning_target_personal_source_id UUID PRIMARY KEY,
  learning_target_id UUID NOT NULL,
  personal_meaning_alignment_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_target_personal_sources_target_fk FOREIGN KEY (
    learning_target_id, workspace_id, learner_user_id
  ) REFERENCES sensa.learning_targets (
    learning_target_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT learning_target_personal_sources_alignment_fk FOREIGN KEY (
    personal_meaning_alignment_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meaning_alignments (
    personal_meaning_alignment_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT learning_target_personal_sources_unique UNIQUE (
    learning_target_id, personal_meaning_alignment_id
  )
);

CREATE TABLE sensa.personal_anchor_use_grants (
  personal_anchor_use_grant_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  personal_semantic_anchor_revision_id UUID NOT NULL
    REFERENCES sensa.personal_semantic_anchor_revisions(personal_semantic_anchor_revision_id) ON DELETE CASCADE,
  personal_meaning_alignment_id UUID NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  learning_target_id UUID,
  purpose sensa.personal_anchor_use_purpose NOT NULL,
  granted_by_operation_id UUID NOT NULL UNIQUE,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  CONSTRAINT personal_anchor_use_grants_alignment_fk FOREIGN KEY (
    personal_meaning_alignment_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meaning_alignments (
    personal_meaning_alignment_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_anchor_use_grants_target_fk FOREIGN KEY (
    learning_target_id, workspace_id, learner_user_id
  ) REFERENCES sensa.learning_targets (
    learning_target_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_anchor_use_grants_expiry_order CHECK (
    expires_at IS NULL OR expires_at > granted_at
  ),
  CONSTRAINT personal_anchor_use_grants_scope_unique UNIQUE (
    personal_anchor_use_grant_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.personal_anchor_use_revocations (
  personal_anchor_use_revocation_id UUID PRIMARY KEY,
  personal_anchor_use_grant_id UUID NOT NULL UNIQUE,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  revoked_by_operation_id UUID NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_anchor_use_revocations_grant_fk FOREIGN KEY (
    personal_anchor_use_grant_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_anchor_use_grants (
    personal_anchor_use_grant_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_anchor_use_revocations_reason_nonempty CHECK (btrim(reason) <> '')
);

CREATE TABLE sensa.learning_materializations (
  learning_materialization_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  learning_target_id UUID NOT NULL,
  protocol_purpose sensa.learning_protocol_purpose NOT NULL,
  provisioning_path sensa.content_provisioning_path NOT NULL,
  content_schema_version TEXT NOT NULL,
  content_payload JSONB NOT NULL,
  content_digest TEXT NOT NULL,
  validation_status sensa.materialization_validation_status NOT NULL,
  validator_version TEXT NOT NULL,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_materializations_target_fk FOREIGN KEY (
    learning_target_id, workspace_id, learner_user_id
  ) REFERENCES sensa.learning_targets (
    learning_target_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT learning_materializations_schema_nonempty CHECK (
    btrim(content_schema_version) <> ''
  ),
  CONSTRAINT learning_materializations_payload_object CHECK (
    jsonb_typeof(content_payload) = 'object'
  ),
  CONSTRAINT learning_materializations_digest CHECK (
    content_digest ~ '^[0-9a-f]{64}$' AND content_digest = lower(content_digest)
  ),
  CONSTRAINT learning_materializations_validator_nonempty CHECK (btrim(validator_version) <> ''),
  CONSTRAINT learning_materializations_provenance_object CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT learning_materializations_scope_unique UNIQUE (
    learning_materialization_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.learning_materialization_anchor_grants (
  learning_materialization_id UUID NOT NULL,
  personal_anchor_use_grant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT materialization_anchor_grants_materialization_fk FOREIGN KEY (
    learning_materialization_id, workspace_id, learner_user_id
  ) REFERENCES sensa.learning_materializations (
    learning_materialization_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  PRIMARY KEY (learning_materialization_id, personal_anchor_use_grant_id)
);

CREATE OR REPLACE FUNCTION sensa.guard_retention_target_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'revision', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'revision', 'updated_at']) THEN
    RAISE EXCEPTION 'Retention Target identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Retention Target revisions must advance by one'
      USING ERRCODE = '40001';
  END IF;
  IF OLD.status = 'retired'
    OR (OLD.status = 'active' AND NEW.status NOT IN ('paused', 'retired'))
    OR (OLD.status = 'paused' AND NEW.status NOT IN ('active', 'retired')) THEN
    RAISE EXCEPTION 'Invalid Retention Target transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_retention_target_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.sense_expression_bindings AS bindings
    WHERE bindings.sense_expression_binding_id = NEW.sense_expression_binding_id
      AND bindings.sense_id = NEW.sense_id
  ) THEN
    RAISE EXCEPTION 'Retention Target binding must belong to its stable Sense'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_learning_target_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.retention_targets AS targets
    WHERE targets.retention_target_id = NEW.retention_target_id
      AND targets.workspace_id = NEW.workspace_id
      AND targets.learner_user_id = NEW.learner_user_id
      AND targets.sense_id = NEW.sense_id
      AND targets.sense_expression_binding_id = NEW.sense_expression_binding_id
      AND targets.retention_scope_key = NEW.retention_scope_key
  ) OR NOT EXISTS (
    SELECT 1
    FROM sensa.sense_expression_binding_versions AS binding_versions
    JOIN sensa.sense_expression_bindings AS bindings
      ON bindings.sense_expression_binding_id = binding_versions.sense_expression_binding_id
    WHERE binding_versions.binding_version_id = NEW.binding_version_id
      AND binding_versions.sense_version_id = NEW.sense_version_id
      AND bindings.sense_expression_binding_id = NEW.sense_expression_binding_id
      AND bindings.sense_id = NEW.sense_id
  ) THEN
    RAISE EXCEPTION 'Learning Target must pin matching Retention, Sense and Binding identities'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_personal_anchor_grant_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.personal_semantic_anchor_revisions AS revisions
    JOIN sensa.personal_semantic_anchors AS anchors
      ON anchors.personal_semantic_anchor_id = revisions.personal_semantic_anchor_id
    JOIN sensa.personal_meaning_alignments AS alignments
      ON alignments.personal_meaning_alignment_id = NEW.personal_meaning_alignment_id
    WHERE revisions.personal_semantic_anchor_revision_id = NEW.personal_semantic_anchor_revision_id
      AND revisions.workspace_id = NEW.workspace_id
      AND revisions.learner_user_id = NEW.learner_user_id
      AND alignments.workspace_id = NEW.workspace_id
      AND alignments.learner_user_id = NEW.learner_user_id
      AND alignments.personal_meaning_id = anchors.personal_meaning_id
      AND alignments.sense_id = NEW.sense_id
  ) OR (
    NEW.learning_target_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM sensa.learning_targets AS targets
      WHERE targets.learning_target_id = NEW.learning_target_id
        AND targets.workspace_id = NEW.workspace_id
        AND targets.learner_user_id = NEW.learner_user_id
        AND targets.sense_id = NEW.sense_id
    )
  ) THEN
    RAISE EXCEPTION 'Personal Anchor grant must match owner, Alignment, Sense and optional Learning Target'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_learning_target_personal_source_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.learning_targets AS targets
    JOIN sensa.personal_meaning_alignments AS alignments
      ON alignments.personal_meaning_alignment_id = NEW.personal_meaning_alignment_id
    WHERE targets.learning_target_id = NEW.learning_target_id
      AND targets.workspace_id = NEW.workspace_id
      AND targets.learner_user_id = NEW.learner_user_id
      AND alignments.workspace_id = NEW.workspace_id
      AND alignments.learner_user_id = NEW.learner_user_id
      AND alignments.sense_id = targets.sense_id
  ) THEN
    RAISE EXCEPTION 'Learning Target personal source must align the same learner and stable Sense'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_materialization_anchor_grant_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.learning_materializations AS materializations
    JOIN sensa.learning_targets AS targets
      ON targets.learning_target_id = materializations.learning_target_id
    JOIN sensa.personal_anchor_use_grants AS grants
      ON grants.personal_anchor_use_grant_id = NEW.personal_anchor_use_grant_id
    LEFT JOIN sensa.personal_anchor_use_revocations AS revocations
      ON revocations.personal_anchor_use_grant_id = grants.personal_anchor_use_grant_id
    WHERE materializations.learning_materialization_id = NEW.learning_materialization_id
      AND materializations.workspace_id = NEW.workspace_id
      AND materializations.learner_user_id = NEW.learner_user_id
      AND grants.workspace_id = NEW.workspace_id
      AND grants.learner_user_id = NEW.learner_user_id
      AND grants.sense_id = targets.sense_id
      AND (grants.learning_target_id IS NULL
        OR grants.learning_target_id = materializations.learning_target_id)
      AND revocations.personal_anchor_use_grant_id IS NULL
      AND (grants.expires_at IS NULL OR grants.expires_at > materializations.created_at)
  ) THEN
    RAISE EXCEPTION 'Materialization must cite an active, in-scope Personal Anchor grant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER retention_targets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.retention_targets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_retention_target_identity();
CREATE TRIGGER retention_targets_lifecycle_guard
BEFORE UPDATE ON sensa.retention_targets
FOR EACH ROW EXECUTE FUNCTION sensa.guard_retention_target_lifecycle();
CREATE TRIGGER learning_targets_identity_guard
BEFORE INSERT ON sensa.learning_targets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_learning_target_identity();
CREATE TRIGGER learning_targets_immutable_guard
BEFORE UPDATE ON sensa.learning_targets
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER learning_target_personal_sources_identity_guard
BEFORE INSERT ON sensa.learning_target_personal_sources
FOR EACH ROW EXECUTE FUNCTION sensa.assert_learning_target_personal_source_identity();
CREATE TRIGGER learning_target_personal_sources_immutable_guard
BEFORE UPDATE ON sensa.learning_target_personal_sources
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER personal_anchor_use_grants_identity_guard
BEFORE INSERT ON sensa.personal_anchor_use_grants
FOR EACH ROW EXECUTE FUNCTION sensa.assert_personal_anchor_grant_identity();
CREATE TRIGGER personal_anchor_use_grants_immutable_guard
BEFORE UPDATE ON sensa.personal_anchor_use_grants
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER personal_anchor_use_revocations_immutable_guard
BEFORE UPDATE ON sensa.personal_anchor_use_revocations
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER learning_materializations_immutable_guard
BEFORE UPDATE ON sensa.learning_materializations
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER materialization_anchor_grants_identity_guard
BEFORE INSERT ON sensa.learning_materialization_anchor_grants
FOR EACH ROW EXECUTE FUNCTION sensa.assert_materialization_anchor_grant_identity();
CREATE TRIGGER materialization_anchor_grants_immutable_guard
BEFORE UPDATE ON sensa.learning_materialization_anchor_grants
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();

ALTER TABLE sensa.retention_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_target_personal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_anchor_use_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_anchor_use_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_materializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_materialization_anchor_grants ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE sensa.retention_targets TO backend_app;
GRANT SELECT, INSERT ON TABLE
  sensa.learning_targets,
  sensa.learning_target_personal_sources,
  sensa.personal_anchor_use_grants,
  sensa.personal_anchor_use_revocations,
  sensa.learning_materializations,
  sensa.learning_materialization_anchor_grants
TO backend_app;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'retention_targets',
    'learning_targets',
    'learning_target_personal_sources',
    'personal_anchor_use_grants',
    'personal_anchor_use_revocations',
    'learning_materializations',
    'learning_materialization_anchor_grants'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON sensa.%I FOR ALL TO backend_app USING (
         security.current_workspace_access_allowed(workspace_id)
         AND learner_user_id = security.current_user_id()
       ) WITH CHECK (
         security.current_workspace_access_allowed(workspace_id)
         AND learner_user_id = security.current_user_id()
       )',
      table_name || '_learner_scope',
      table_name
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE sensa.retention_targets IS
  'Durable learner × stable Sense × target Binding × explicit scope identity. Ordinary version, content and Protocol changes do not split it.';
COMMENT ON TABLE sensa.learning_targets IS
  'Immutable formal-learning intent snapshot pinning exact Sense and Binding Versions.';
COMMENT ON TABLE sensa.learning_target_personal_sources IS
  'Removable private provenance seam. Deleting a Personal Meaning does not delete its Learning or Retention Target.';
COMMENT ON TABLE sensa.personal_anchor_use_grants IS
  'Explicit purpose-scoped authorization for one exact Personal Semantic Anchor revision.';
COMMENT ON TABLE sensa.learning_materializations IS
  'Immutable validated content frozen for one Learning Target and Protocol purpose.';

REVOKE ALL ON FUNCTION sensa.guard_retention_target_lifecycle() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_retention_target_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_learning_target_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_learning_target_personal_source_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_personal_anchor_grant_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_materialization_anchor_grant_identity() FROM PUBLIC, backend_app;
