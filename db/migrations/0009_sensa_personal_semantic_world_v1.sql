-- Personal Semantic World v1.
--
-- There is deliberately no personal_semantic_worlds table: V1 has one
-- implicit world per Learner, projected from that Learner's non-deleted
-- Personal Meanings. Stable identities and mutable heads are normalized;
-- every content revision and confirmation is an immutable row.

DO $$
BEGIN
  CREATE TYPE sensa.personal_record_status AS ENUM ('active', 'deleted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.personal_provenance_kind AS ENUM (
    'learner_authored',
    'llm_suggested',
    'reviewed',
    'imported'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.learner_language_role AS ENUM ('familiar', 'target');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.personal_anchor_kind AS ENUM (
    'text',
    'image',
    'audio',
    'scene',
    'action',
    'feeling',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.expression_verification_status AS ENUM (
    'unverified',
    'learner_confirmed',
    'reviewed',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sense_construction_status AS ENUM (
    'active',
    'paused',
    'completed',
    'abandoned'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.construction_turn_actor AS ENUM (
    'learner',
    'semantic_llm',
    'system'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sense_proposal_status AS ENUM (
    'open',
    'superseded',
    'confirmed',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sense_confirmation_resolution AS ENUM (
    'create_new',
    'reuse_existing'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.personal_alignment_event_type AS ENUM (
    'confirmed',
    'withdrawn',
    'restored'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_personal_revision_head()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY[
        'current_revision', 'status', 'updated_at', 'deleted_at'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'current_revision', 'status', 'updated_at', 'deleted_at'
      ]) THEN
    RAISE EXCEPTION 'Sensa % stable identity and scope are immutable', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  IF NEW.current_revision <> OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'Sensa % revisions must advance by one', TG_TABLE_NAME
      USING ERRCODE = '40001';
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_immutable_personal_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Sensa % rows are immutable', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TABLE sensa.personal_meanings (
  personal_meaning_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  current_revision BIGINT NOT NULL DEFAULT 1,
  status sensa.personal_record_status NOT NULL DEFAULT 'active',
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT personal_meanings_revision_positive CHECK (current_revision > 0),
  CONSTRAINT personal_meanings_status_shape CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT personal_meanings_scope_unique UNIQUE (
    personal_meaning_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.personal_meaning_revisions (
  personal_meaning_revision_id UUID PRIMARY KEY,
  personal_meaning_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  display_label TEXT,
  learner_intent_note TEXT,
  provenance_kind sensa.personal_provenance_kind NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_meaning_revisions_parent_fk FOREIGN KEY (
    personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meanings (
    personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_meaning_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT personal_meaning_revisions_label_nonempty CHECK (
    display_label IS NULL OR btrim(display_label) <> ''
  ),
  CONSTRAINT personal_meaning_revisions_note_nonempty CHECK (
    learner_intent_note IS NULL OR btrim(learner_intent_note) <> ''
  ),
  CONSTRAINT personal_meaning_revisions_provenance_object CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT personal_meaning_revisions_number_unique UNIQUE (
    personal_meaning_id, revision
  )
);

ALTER TABLE sensa.personal_meanings
  ADD CONSTRAINT personal_meanings_current_revision_fk FOREIGN KEY (
    personal_meaning_id, current_revision
  ) REFERENCES sensa.personal_meaning_revisions (
    personal_meaning_id, revision
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sensa.meaning_focuses (
  meaning_focus_id UUID PRIMARY KEY,
  personal_meaning_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  split_from_meaning_focus_id UUID REFERENCES sensa.meaning_focuses(meaning_focus_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  current_revision BIGINT NOT NULL DEFAULT 1,
  status sensa.personal_record_status NOT NULL DEFAULT 'active',
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT meaning_focuses_parent_fk FOREIGN KEY (
    personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meanings (
    personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT meaning_focuses_revision_positive CHECK (current_revision > 0),
  CONSTRAINT meaning_focuses_status_shape CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT meaning_focuses_scope_unique UNIQUE (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ),
  CONSTRAINT meaning_focuses_owner_scope_unique UNIQUE (
    meaning_focus_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.meaning_focus_revisions (
  meaning_focus_revision_id UUID PRIMARY KEY,
  meaning_focus_id UUID NOT NULL,
  personal_meaning_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  statement TEXT NOT NULL,
  distinguishing_notes TEXT[] NOT NULL DEFAULT '{}',
  provenance_kind sensa.personal_provenance_kind NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meaning_focus_revisions_parent_fk FOREIGN KEY (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focuses (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT meaning_focus_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT meaning_focus_revisions_statement_nonempty CHECK (btrim(statement) <> ''),
  CONSTRAINT meaning_focus_revisions_notes_nonempty CHECK (
    cardinality(distinguishing_notes) = 0
    OR sensa.array_has_nonempty_text(distinguishing_notes)
  ),
  CONSTRAINT meaning_focus_revisions_provenance_object CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT meaning_focus_revisions_number_unique UNIQUE (meaning_focus_id, revision)
);

ALTER TABLE sensa.meaning_focuses
  ADD CONSTRAINT meaning_focuses_current_revision_fk FOREIGN KEY (
    meaning_focus_id, current_revision
  ) REFERENCES sensa.meaning_focus_revisions (
    meaning_focus_id, revision
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sensa.meaning_focus_acceptances (
  meaning_focus_acceptance_id UUID PRIMARY KEY,
  meaning_focus_id UUID NOT NULL,
  meaning_focus_revision_id UUID NOT NULL
    REFERENCES sensa.meaning_focus_revisions(meaning_focus_revision_id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  operation_id UUID NOT NULL UNIQUE,
  accepted_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meaning_focus_acceptances_parent_fk FOREIGN KEY (
    meaning_focus_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focuses (
    meaning_focus_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT meaning_focus_acceptances_revision_unique UNIQUE (
    meaning_focus_id, meaning_focus_revision_id
  )
);

CREATE TABLE sensa.personal_media_objects (
  personal_media_object_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status sensa.personal_record_status NOT NULL DEFAULT 'active',
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT personal_media_objects_kind CHECK (media_kind IN ('image', 'audio')),
  CONSTRAINT personal_media_objects_mime_nonempty CHECK (btrim(mime_type) <> ''),
  CONSTRAINT personal_media_objects_size_nonnegative CHECK (size_bytes >= 0),
  CONSTRAINT personal_media_objects_sha256 CHECK (
    sha256 ~ '^[0-9a-f]{64}$' AND sha256 = lower(sha256)
  ),
  CONSTRAINT personal_media_objects_storage_key_nonempty CHECK (btrim(storage_key) <> ''),
  CONSTRAINT personal_media_objects_status_shape CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT personal_media_objects_storage_unique UNIQUE (storage_key),
  CONSTRAINT personal_media_objects_scope_unique UNIQUE (
    personal_media_object_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.personal_semantic_anchors (
  personal_semantic_anchor_id UUID PRIMARY KEY,
  personal_meaning_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  current_revision BIGINT NOT NULL DEFAULT 1,
  status sensa.personal_record_status NOT NULL DEFAULT 'active',
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT personal_semantic_anchors_parent_fk FOREIGN KEY (
    personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meanings (
    personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_semantic_anchors_revision_positive CHECK (current_revision > 0),
  CONSTRAINT personal_semantic_anchors_status_shape CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT personal_semantic_anchors_scope_unique UNIQUE (
    personal_semantic_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.personal_semantic_anchor_revisions (
  personal_semantic_anchor_revision_id UUID PRIMARY KEY,
  personal_semantic_anchor_id UUID NOT NULL,
  personal_meaning_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  anchor_kind sensa.personal_anchor_kind NOT NULL,
  language_tag TEXT,
  body_text TEXT,
  personal_media_object_id UUID,
  structured_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance_kind sensa.personal_provenance_kind NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT semantic_anchor_revisions_parent_fk FOREIGN KEY (
    personal_semantic_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_semantic_anchors (
    personal_semantic_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT semantic_anchor_revisions_media_fk FOREIGN KEY (
    personal_media_object_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_media_objects (
    personal_media_object_id, workspace_id, learner_user_id
  ) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT semantic_anchor_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT semantic_anchor_revisions_language_nonempty CHECK (
    language_tag IS NULL OR btrim(language_tag) <> ''
  ),
  CONSTRAINT semantic_anchor_revisions_body_nonempty CHECK (
    body_text IS NULL OR btrim(body_text) <> ''
  ),
  CONSTRAINT semantic_anchor_revisions_payload_object CHECK (
    jsonb_typeof(structured_payload) = 'object'
  ),
  CONSTRAINT semantic_anchor_revisions_provenance_object CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT semantic_anchor_revisions_content_present CHECK (
    body_text IS NOT NULL
    OR personal_media_object_id IS NOT NULL
    OR structured_payload <> '{}'::jsonb
  ),
  CONSTRAINT semantic_anchor_revisions_media_kind_shape CHECK (
    (anchor_kind IN ('image', 'audio') AND personal_media_object_id IS NOT NULL)
    OR anchor_kind NOT IN ('image', 'audio')
  ),
  CONSTRAINT semantic_anchor_revisions_number_unique UNIQUE (
    personal_semantic_anchor_id, revision
  )
);

ALTER TABLE sensa.personal_semantic_anchors
  ADD CONSTRAINT personal_semantic_anchors_current_revision_fk FOREIGN KEY (
    personal_semantic_anchor_id, current_revision
  ) REFERENCES sensa.personal_semantic_anchor_revisions (
    personal_semantic_anchor_id, revision
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sensa.meaning_focus_semantic_anchor_links (
  focus_anchor_link_id UUID PRIMARY KEY,
  personal_meaning_id UUID NOT NULL,
  meaning_focus_id UUID NOT NULL,
  personal_semantic_anchor_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  current_revision BIGINT NOT NULL DEFAULT 1,
  status sensa.personal_record_status NOT NULL DEFAULT 'active',
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT focus_anchor_links_focus_fk FOREIGN KEY (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focuses (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT focus_anchor_links_anchor_fk FOREIGN KEY (
    personal_semantic_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_semantic_anchors (
    personal_semantic_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT focus_anchor_links_revision_positive CHECK (current_revision > 0),
  CONSTRAINT focus_anchor_links_status_shape CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT focus_anchor_links_scope_unique UNIQUE (
    focus_anchor_link_id, workspace_id, learner_user_id
  )
);

CREATE UNIQUE INDEX focus_anchor_links_active_unique
  ON sensa.meaning_focus_semantic_anchor_links (
    meaning_focus_id, personal_semantic_anchor_id
  ) WHERE status = 'active';

CREATE TABLE sensa.meaning_focus_semantic_anchor_link_revisions (
  focus_anchor_link_revision_id UUID PRIMARY KEY,
  focus_anchor_link_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  focus_note TEXT NOT NULL,
  provenance_kind sensa.personal_provenance_kind NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT focus_anchor_link_revisions_parent_fk FOREIGN KEY (
    focus_anchor_link_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focus_semantic_anchor_links (
    focus_anchor_link_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT focus_anchor_link_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT focus_anchor_link_revisions_note_nonempty CHECK (btrim(focus_note) <> ''),
  CONSTRAINT focus_anchor_link_revisions_provenance_object CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT focus_anchor_link_revisions_number_unique UNIQUE (
    focus_anchor_link_id, revision
  )
);

ALTER TABLE sensa.meaning_focus_semantic_anchor_links
  ADD CONSTRAINT focus_anchor_links_current_revision_fk FOREIGN KEY (
    focus_anchor_link_id, current_revision
  ) REFERENCES sensa.meaning_focus_semantic_anchor_link_revisions (
    focus_anchor_link_id, revision
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sensa.personal_expression_anchors (
  personal_expression_anchor_id UUID PRIMARY KEY,
  personal_meaning_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  current_revision BIGINT NOT NULL DEFAULT 1,
  status sensa.personal_record_status NOT NULL DEFAULT 'active',
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT personal_expression_anchors_parent_fk FOREIGN KEY (
    personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meanings (
    personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_expression_anchors_revision_positive CHECK (current_revision > 0),
  CONSTRAINT personal_expression_anchors_status_shape CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT personal_expression_anchors_scope_unique UNIQUE (
    personal_expression_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.personal_expression_anchor_revisions (
  personal_expression_anchor_revision_id UUID PRIMARY KEY,
  personal_expression_anchor_id UUID NOT NULL,
  personal_meaning_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  expression_type sensa.expression_type NOT NULL,
  language_tag TEXT NOT NULL,
  learner_language_role sensa.learner_language_role NOT NULL,
  surface_form TEXT NOT NULL,
  normalized_form TEXT NOT NULL,
  provenance_kind sensa.personal_provenance_kind NOT NULL,
  verification_status sensa.expression_verification_status NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expression_anchor_revisions_parent_fk FOREIGN KEY (
    personal_expression_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_expression_anchors (
    personal_expression_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT expression_anchor_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT expression_anchor_revisions_language_nonempty CHECK (btrim(language_tag) <> ''),
  CONSTRAINT expression_anchor_revisions_surface_nonempty CHECK (btrim(surface_form) <> ''),
  CONSTRAINT expression_anchor_revisions_normalized_nonempty CHECK (btrim(normalized_form) <> ''),
  CONSTRAINT expression_anchor_revisions_provenance_object CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT expression_anchor_revisions_number_unique UNIQUE (
    personal_expression_anchor_id, revision
  )
);

ALTER TABLE sensa.personal_expression_anchors
  ADD CONSTRAINT personal_expression_anchors_current_revision_fk FOREIGN KEY (
    personal_expression_anchor_id, current_revision
  ) REFERENCES sensa.personal_expression_anchor_revisions (
    personal_expression_anchor_id, revision
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sensa.meaning_focus_expression_anchor_links (
  focus_expression_anchor_link_id UUID PRIMARY KEY,
  personal_meaning_id UUID NOT NULL,
  meaning_focus_id UUID NOT NULL,
  personal_expression_anchor_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  current_revision BIGINT NOT NULL DEFAULT 1,
  status sensa.personal_record_status NOT NULL DEFAULT 'active',
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT focus_expression_links_focus_fk FOREIGN KEY (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focuses (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT focus_expression_links_anchor_fk FOREIGN KEY (
    personal_expression_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_expression_anchors (
    personal_expression_anchor_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT focus_expression_links_revision_positive CHECK (current_revision > 0),
  CONSTRAINT focus_expression_links_status_shape CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT focus_expression_links_scope_unique UNIQUE (
    focus_expression_anchor_link_id, workspace_id, learner_user_id
  )
);

CREATE UNIQUE INDEX focus_expression_links_active_unique
  ON sensa.meaning_focus_expression_anchor_links (
    meaning_focus_id, personal_expression_anchor_id
  ) WHERE status = 'active';

CREATE TABLE sensa.meaning_focus_expression_anchor_link_revisions (
  focus_expression_anchor_link_revision_id UUID PRIMARY KEY,
  focus_expression_anchor_link_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  focus_note TEXT NOT NULL,
  provenance_kind sensa.personal_provenance_kind NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT focus_expression_link_revisions_parent_fk FOREIGN KEY (
    focus_expression_anchor_link_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focus_expression_anchor_links (
    focus_expression_anchor_link_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT focus_expression_link_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT focus_expression_link_revisions_note_nonempty CHECK (btrim(focus_note) <> ''),
  CONSTRAINT focus_expression_link_revisions_provenance_object CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT focus_expression_link_revisions_number_unique UNIQUE (
    focus_expression_anchor_link_id, revision
  )
);

ALTER TABLE sensa.meaning_focus_expression_anchor_links
  ADD CONSTRAINT focus_expression_links_current_revision_fk FOREIGN KEY (
    focus_expression_anchor_link_id, current_revision
  ) REFERENCES sensa.meaning_focus_expression_anchor_link_revisions (
    focus_expression_anchor_link_id, revision
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sensa.sense_constructions (
  sense_construction_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  personal_meaning_id UUID NOT NULL,
  personal_meaning_revision_id UUID NOT NULL
    REFERENCES sensa.personal_meaning_revisions(personal_meaning_revision_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  meaning_focus_id UUID NOT NULL,
  meaning_focus_revision_id UUID NOT NULL
    REFERENCES sensa.meaning_focus_revisions(meaning_focus_revision_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  familiar_language_tag TEXT NOT NULL,
  target_language_tag TEXT NOT NULL,
  semantic_policy_version TEXT NOT NULL,
  status sensa.sense_construction_status NOT NULL DEFAULT 'active',
  revision BIGINT NOT NULL DEFAULT 1,
  created_by_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sense_constructions_meaning_fk FOREIGN KEY (
    personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meanings (
    personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT sense_constructions_focus_fk FOREIGN KEY (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focuses (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT sense_constructions_languages_nonempty CHECK (
    btrim(familiar_language_tag) <> '' AND btrim(target_language_tag) <> ''
  ),
  CONSTRAINT sense_constructions_language_roles_distinct CHECK (
    familiar_language_tag <> target_language_tag
  ),
  CONSTRAINT sense_constructions_policy_nonempty CHECK (btrim(semantic_policy_version) <> ''),
  CONSTRAINT sense_constructions_revision_positive CHECK (revision > 0),
  CONSTRAINT sense_constructions_scope_unique UNIQUE (
    sense_construction_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.sense_construction_turns (
  construction_turn_id UUID PRIMARY KEY,
  sense_construction_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  actor sensa.construction_turn_actor NOT NULL,
  body TEXT NOT NULL,
  input_digest TEXT,
  output_digest TEXT NOT NULL,
  model_provenance JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT construction_turns_parent_fk FOREIGN KEY (
    sense_construction_id, workspace_id, learner_user_id
  ) REFERENCES sensa.sense_constructions (
    sense_construction_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT construction_turns_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT construction_turns_body_nonempty CHECK (btrim(body) <> ''),
  CONSTRAINT construction_turns_input_digest CHECK (
    input_digest IS NULL OR (input_digest ~ '^[0-9a-f]{64}$' AND input_digest = lower(input_digest))
  ),
  CONSTRAINT construction_turns_output_digest CHECK (
    output_digest ~ '^[0-9a-f]{64}$' AND output_digest = lower(output_digest)
  ),
  CONSTRAINT construction_turns_model_shape CHECK (
    (actor = 'semantic_llm' AND model_provenance IS NOT NULL AND jsonb_typeof(model_provenance) = 'object')
    OR (actor <> 'semantic_llm' AND model_provenance IS NULL)
  ),
  CONSTRAINT construction_turns_ordinal_unique UNIQUE (sense_construction_id, ordinal)
);

CREATE TABLE sensa.sense_proposals (
  sense_proposal_id UUID PRIMARY KEY,
  sense_construction_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  status sensa.sense_proposal_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sense_proposals_parent_fk FOREIGN KEY (
    sense_construction_id, workspace_id, learner_user_id
  ) REFERENCES sensa.sense_constructions (
    sense_construction_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT sense_proposals_version_positive CHECK (current_version > 0),
  CONSTRAINT sense_proposals_scope_unique UNIQUE (
    sense_proposal_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.sense_proposal_versions (
  sense_proposal_version_id UUID PRIMARY KEY,
  sense_proposal_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  meaning_focus_revision_id UUID NOT NULL
    REFERENCES sensa.meaning_focus_revisions(meaning_focus_revision_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  semantic_spec JSONB NOT NULL,
  expression_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  unresolved_questions TEXT[] NOT NULL DEFAULT '{}',
  semantic_policy_version TEXT NOT NULL,
  generator_provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sense_proposal_versions_parent_fk FOREIGN KEY (
    sense_proposal_id, workspace_id, learner_user_id
  ) REFERENCES sensa.sense_proposals (
    sense_proposal_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT sense_proposal_versions_version_positive CHECK (version > 0),
  CONSTRAINT sense_proposal_versions_spec_object CHECK (jsonb_typeof(semantic_spec) = 'object'),
  CONSTRAINT sense_proposal_versions_candidates_array CHECK (
    jsonb_typeof(expression_candidates) = 'array'
  ),
  CONSTRAINT sense_proposal_versions_questions_nonempty CHECK (
    cardinality(unresolved_questions) = 0
    OR sensa.array_has_nonempty_text(unresolved_questions)
  ),
  CONSTRAINT sense_proposal_versions_policy_nonempty CHECK (btrim(semantic_policy_version) <> ''),
  CONSTRAINT sense_proposal_versions_generator_object CHECK (
    jsonb_typeof(generator_provenance) = 'object'
  ),
  CONSTRAINT sense_proposal_versions_number_unique UNIQUE (sense_proposal_id, version)
);

ALTER TABLE sensa.sense_proposals
  ADD CONSTRAINT sense_proposals_current_version_fk FOREIGN KEY (
    sense_proposal_id, current_version
  ) REFERENCES sensa.sense_proposal_versions (
    sense_proposal_id, version
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sensa.sense_proposal_confirmations (
  sense_proposal_confirmation_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  sense_proposal_version_id UUID NOT NULL
    REFERENCES sensa.sense_proposal_versions(sense_proposal_version_id) ON DELETE CASCADE,
  meaning_focus_revision_id UUID NOT NULL
    REFERENCES sensa.meaning_focus_revisions(meaning_focus_revision_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  resolution sensa.sense_confirmation_resolution NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sense_proposal_confirmations_idempotent UNIQUE (
    learner_user_id, sense_proposal_version_id
  ),
  CONSTRAINT sense_proposal_confirmations_scope_unique UNIQUE (
    sense_proposal_confirmation_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.expression_binding_confirmations (
  expression_binding_confirmation_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  sense_proposal_version_id UUID
    REFERENCES sensa.sense_proposal_versions(sense_proposal_version_id) ON DELETE RESTRICT,
  personal_expression_anchor_revision_id UUID NOT NULL
    REFERENCES sensa.personal_expression_anchor_revisions(personal_expression_anchor_revision_id) ON DELETE CASCADE,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  expression_version_id UUID NOT NULL
    REFERENCES sensa.expression_versions(expression_version_id) ON DELETE RESTRICT,
  binding_version_id UUID NOT NULL
    REFERENCES sensa.sense_expression_binding_versions(binding_version_id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expression_binding_confirmations_idempotent UNIQUE (
    learner_user_id, personal_expression_anchor_revision_id, sense_version_id
  )
);

CREATE TABLE sensa.personal_meaning_alignments (
  personal_meaning_alignment_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  personal_meaning_id UUID NOT NULL,
  personal_meaning_revision_id UUID NOT NULL
    REFERENCES sensa.personal_meaning_revisions(personal_meaning_revision_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  meaning_focus_id UUID NOT NULL,
  meaning_focus_revision_id UUID NOT NULL
    REFERENCES sensa.meaning_focus_revisions(meaning_focus_revision_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  sense_proposal_confirmation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_meaning_alignments_meaning_fk FOREIGN KEY (
    personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meanings (
    personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_meaning_alignments_focus_fk FOREIGN KEY (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) REFERENCES sensa.meaning_focuses (
    meaning_focus_id, personal_meaning_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_meaning_alignments_confirmation_fk FOREIGN KEY (
    sense_proposal_confirmation_id, workspace_id, learner_user_id
  ) REFERENCES sensa.sense_proposal_confirmations (
    sense_proposal_confirmation_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_meaning_alignments_identity_unique UNIQUE (
    learner_user_id, personal_meaning_id, meaning_focus_id, sense_id, sense_version_id
  ),
  CONSTRAINT personal_meaning_alignments_scope_unique UNIQUE (
    personal_meaning_alignment_id, workspace_id, learner_user_id
  )
);

CREATE TABLE sensa.personal_meaning_alignment_events (
  personal_meaning_alignment_event_id UUID PRIMARY KEY,
  personal_meaning_alignment_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  learner_user_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  event_type sensa.personal_alignment_event_type NOT NULL,
  operation_id UUID NOT NULL UNIQUE,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personal_alignment_events_parent_fk FOREIGN KEY (
    personal_meaning_alignment_id, workspace_id, learner_user_id
  ) REFERENCES sensa.personal_meaning_alignments (
    personal_meaning_alignment_id, workspace_id, learner_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT personal_alignment_events_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT personal_alignment_events_reason_nonempty CHECK (
    reason IS NULL OR btrim(reason) <> ''
  ),
  CONSTRAINT personal_alignment_events_initial_shape CHECK (
    (ordinal = 1 AND event_type = 'confirmed') OR ordinal > 1
  ),
  CONSTRAINT personal_alignment_events_ordinal_unique UNIQUE (
    personal_meaning_alignment_id, ordinal
  )
);

CREATE OR REPLACE FUNCTION sensa.guard_personal_media_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'deleted_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'deleted_at']) THEN
    RAISE EXCEPTION 'Personal Media Object identity and bytes are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'deleted' OR NEW.status <> 'deleted' OR NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Personal Media Objects only support active -> deleted'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sense_construction_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'revision', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'revision', 'updated_at']) THEN
    RAISE EXCEPTION 'Sense Construction pinned identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Sense Construction revisions must advance by one'
      USING ERRCODE = '40001';
  END IF;
  IF (OLD.status = 'active' AND NEW.status NOT IN ('paused', 'completed', 'abandoned'))
    OR (OLD.status = 'paused' AND NEW.status NOT IN ('active', 'abandoned'))
    OR OLD.status IN ('completed', 'abandoned') THEN
    RAISE EXCEPTION 'Invalid Sense Construction transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sense_proposal_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['current_version', 'status', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['current_version', 'status', 'updated_at']) THEN
    RAISE EXCEPTION 'Sense Proposal stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.current_version NOT IN (OLD.current_version, OLD.current_version + 1) THEN
    RAISE EXCEPTION 'Sense Proposal versions must stay current or advance by one'
      USING ERRCODE = '40001';
  END IF;
  IF OLD.status IN ('confirmed', 'rejected', 'superseded') THEN
    RAISE EXCEPTION 'Terminal Sense Proposals are immutable'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_meaning_focus_acceptance_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.meaning_focus_revisions AS revisions
    WHERE revisions.meaning_focus_revision_id = NEW.meaning_focus_revision_id
      AND revisions.meaning_focus_id = NEW.meaning_focus_id
      AND revisions.workspace_id = NEW.workspace_id
      AND revisions.learner_user_id = NEW.learner_user_id
  ) THEN
    RAISE EXCEPTION 'Meaning Focus acceptance must pin a revision of the same learner-owned Focus'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

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
  ) OR NOT EXISTS (
    SELECT 1
    FROM sensa.meaning_focus_revisions AS focus_revisions
    WHERE focus_revisions.meaning_focus_revision_id = NEW.meaning_focus_revision_id
      AND focus_revisions.meaning_focus_id = NEW.meaning_focus_id
      AND focus_revisions.personal_meaning_id = NEW.personal_meaning_id
      AND focus_revisions.workspace_id = NEW.workspace_id
      AND focus_revisions.learner_user_id = NEW.learner_user_id
  ) THEN
    RAISE EXCEPTION 'Sense Construction must pin revisions from the same Personal Meaning and Focus'
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
      AND versions.meaning_focus_revision_id = NEW.meaning_focus_revision_id
      AND versions.workspace_id = NEW.workspace_id
      AND versions.learner_user_id = NEW.learner_user_id
  ) THEN
    RAISE EXCEPTION 'Sense confirmation scope or pinned Focus revision is inconsistent'
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

CREATE OR REPLACE FUNCTION sensa.assert_expression_binding_confirmation_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.personal_expression_anchor_revisions AS revisions
    WHERE revisions.personal_expression_anchor_revision_id = NEW.personal_expression_anchor_revision_id
      AND revisions.workspace_id = NEW.workspace_id
      AND revisions.learner_user_id = NEW.learner_user_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM sensa.sense_expression_binding_versions AS binding_versions
    WHERE binding_versions.binding_version_id = NEW.binding_version_id
      AND binding_versions.sense_version_id = NEW.sense_version_id
      AND binding_versions.expression_version_id = NEW.expression_version_id
  ) THEN
    RAISE EXCEPTION 'Expression confirmation scope or pinned Binding Version is inconsistent'
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
  ) OR NOT EXISTS (
    SELECT 1
    FROM sensa.meaning_focus_revisions AS focus_revisions
    WHERE focus_revisions.meaning_focus_revision_id = NEW.meaning_focus_revision_id
      AND focus_revisions.meaning_focus_id = NEW.meaning_focus_id
      AND focus_revisions.personal_meaning_id = NEW.personal_meaning_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM sensa.sense_proposal_confirmations AS confirmations
    WHERE confirmations.sense_proposal_confirmation_id = NEW.sense_proposal_confirmation_id
      AND confirmations.workspace_id = NEW.workspace_id
      AND confirmations.learner_user_id = NEW.learner_user_id
      AND confirmations.meaning_focus_revision_id = NEW.meaning_focus_revision_id
      AND confirmations.sense_id = NEW.sense_id
      AND confirmations.sense_version_id = NEW.sense_version_id
  ) THEN
    RAISE EXCEPTION 'Personal Meaning Alignment must match its exact revisions and confirmation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_personal_alignment_event_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  previous_event_type sensa.personal_alignment_event_type;
BEGIN
  IF NEW.ordinal = 1 THEN
    RETURN NEW;
  END IF;

  SELECT events.event_type INTO previous_event_type
  FROM sensa.personal_meaning_alignment_events AS events
  WHERE events.personal_meaning_alignment_id = NEW.personal_meaning_alignment_id
    AND events.ordinal = NEW.ordinal - 1;

  IF previous_event_type IS NULL THEN
    RAISE EXCEPTION 'Personal Meaning Alignment events must be contiguous'
      USING ERRCODE = '23514';
  END IF;
  IF previous_event_type IN ('confirmed', 'restored') AND NEW.event_type <> 'withdrawn' THEN
    RAISE EXCEPTION 'An active Personal Meaning Alignment can only be withdrawn'
      USING ERRCODE = '23514';
  END IF;
  IF previous_event_type = 'withdrawn' AND NEW.event_type <> 'restored' THEN
    RAISE EXCEPTION 'A withdrawn Personal Meaning Alignment can only be restored'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER personal_media_objects_lifecycle_guard
BEFORE UPDATE ON sensa.personal_media_objects
FOR EACH ROW EXECUTE FUNCTION sensa.guard_personal_media_lifecycle();

CREATE TRIGGER meaning_focus_acceptances_identity_guard
BEFORE INSERT ON sensa.meaning_focus_acceptances
FOR EACH ROW EXECUTE FUNCTION sensa.assert_meaning_focus_acceptance_identity();

CREATE TRIGGER sense_constructions_identity_guard
BEFORE INSERT OR UPDATE ON sensa.sense_constructions
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sense_construction_identity();

CREATE TRIGGER sense_constructions_lifecycle_guard
BEFORE UPDATE ON sensa.sense_constructions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sense_construction_lifecycle();

CREATE TRIGGER sense_proposals_lifecycle_guard
BEFORE UPDATE ON sensa.sense_proposals
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sense_proposal_lifecycle();

CREATE TRIGGER sense_proposal_confirmations_identity_guard
BEFORE INSERT ON sensa.sense_proposal_confirmations
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sense_confirmation_identity();

CREATE TRIGGER expression_binding_confirmations_identity_guard
BEFORE INSERT ON sensa.expression_binding_confirmations
FOR EACH ROW EXECUTE FUNCTION sensa.assert_expression_binding_confirmation_identity();

CREATE TRIGGER personal_meaning_alignments_identity_guard
BEFORE INSERT ON sensa.personal_meaning_alignments
FOR EACH ROW EXECUTE FUNCTION sensa.assert_personal_alignment_identity();

CREATE TRIGGER personal_alignment_events_transition_guard
BEFORE INSERT ON sensa.personal_meaning_alignment_events
FOR EACH ROW EXECUTE FUNCTION sensa.assert_personal_alignment_event_transition();

CREATE TRIGGER personal_meanings_revision_guard
BEFORE UPDATE ON sensa.personal_meanings
FOR EACH ROW EXECUTE FUNCTION sensa.guard_personal_revision_head();
CREATE TRIGGER meaning_focuses_revision_guard
BEFORE UPDATE ON sensa.meaning_focuses
FOR EACH ROW EXECUTE FUNCTION sensa.guard_personal_revision_head();
CREATE TRIGGER personal_semantic_anchors_revision_guard
BEFORE UPDATE ON sensa.personal_semantic_anchors
FOR EACH ROW EXECUTE FUNCTION sensa.guard_personal_revision_head();
CREATE TRIGGER focus_anchor_links_revision_guard
BEFORE UPDATE ON sensa.meaning_focus_semantic_anchor_links
FOR EACH ROW EXECUTE FUNCTION sensa.guard_personal_revision_head();
CREATE TRIGGER personal_expression_anchors_revision_guard
BEFORE UPDATE ON sensa.personal_expression_anchors
FOR EACH ROW EXECUTE FUNCTION sensa.guard_personal_revision_head();
CREATE TRIGGER focus_expression_links_revision_guard
BEFORE UPDATE ON sensa.meaning_focus_expression_anchor_links
FOR EACH ROW EXECUTE FUNCTION sensa.guard_personal_revision_head();

CREATE TRIGGER personal_meaning_revisions_immutable_guard
BEFORE UPDATE ON sensa.personal_meaning_revisions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER meaning_focus_revisions_immutable_guard
BEFORE UPDATE ON sensa.meaning_focus_revisions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER meaning_focus_acceptances_immutable_guard
BEFORE UPDATE ON sensa.meaning_focus_acceptances
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER personal_semantic_anchor_revisions_immutable_guard
BEFORE UPDATE ON sensa.personal_semantic_anchor_revisions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER focus_anchor_link_revisions_immutable_guard
BEFORE UPDATE ON sensa.meaning_focus_semantic_anchor_link_revisions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER personal_expression_anchor_revisions_immutable_guard
BEFORE UPDATE ON sensa.personal_expression_anchor_revisions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER focus_expression_link_revisions_immutable_guard
BEFORE UPDATE ON sensa.meaning_focus_expression_anchor_link_revisions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER sense_construction_turns_immutable_guard
BEFORE UPDATE ON sensa.sense_construction_turns
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER sense_proposal_versions_immutable_guard
BEFORE UPDATE ON sensa.sense_proposal_versions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER sense_proposal_confirmations_immutable_guard
BEFORE UPDATE ON sensa.sense_proposal_confirmations
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER expression_binding_confirmations_immutable_guard
BEFORE UPDATE ON sensa.expression_binding_confirmations
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER personal_meaning_alignments_immutable_guard
BEFORE UPDATE ON sensa.personal_meaning_alignments
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();
CREATE TRIGGER personal_alignment_events_immutable_guard
BEFORE UPDATE ON sensa.personal_meaning_alignment_events
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_personal_fact();

ALTER TABLE sensa.personal_meanings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_meaning_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.meaning_focuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.meaning_focus_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.meaning_focus_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_semantic_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_semantic_anchor_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.meaning_focus_semantic_anchor_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.meaning_focus_semantic_anchor_link_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_expression_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_expression_anchor_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.meaning_focus_expression_anchor_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.meaning_focus_expression_anchor_link_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_constructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_construction_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_proposal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_proposal_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.expression_binding_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_meaning_alignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.personal_meaning_alignment_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE
  sensa.personal_meanings,
  sensa.meaning_focuses,
  sensa.personal_media_objects,
  sensa.personal_semantic_anchors,
  sensa.meaning_focus_semantic_anchor_links,
  sensa.personal_expression_anchors,
  sensa.meaning_focus_expression_anchor_links,
  sensa.sense_constructions,
  sensa.sense_proposals
TO backend_app;

GRANT SELECT, INSERT ON TABLE
  sensa.personal_meaning_revisions,
  sensa.meaning_focus_revisions,
  sensa.meaning_focus_acceptances,
  sensa.personal_semantic_anchor_revisions,
  sensa.meaning_focus_semantic_anchor_link_revisions,
  sensa.personal_expression_anchor_revisions,
  sensa.meaning_focus_expression_anchor_link_revisions,
  sensa.sense_construction_turns,
  sensa.sense_proposal_versions,
  sensa.sense_proposal_confirmations,
  sensa.expression_binding_confirmations,
  sensa.personal_meaning_alignments,
  sensa.personal_meaning_alignment_events
TO backend_app;

GRANT EXECUTE ON FUNCTION sensa.array_has_nonempty_text(TEXT[]) TO backend_app;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'personal_meanings',
    'personal_meaning_revisions',
    'meaning_focuses',
    'meaning_focus_revisions',
    'meaning_focus_acceptances',
    'personal_media_objects',
    'personal_semantic_anchors',
    'personal_semantic_anchor_revisions',
    'meaning_focus_semantic_anchor_links',
    'meaning_focus_semantic_anchor_link_revisions',
    'personal_expression_anchors',
    'personal_expression_anchor_revisions',
    'meaning_focus_expression_anchor_links',
    'meaning_focus_expression_anchor_link_revisions',
    'sense_constructions',
    'sense_construction_turns',
    'sense_proposals',
    'sense_proposal_versions',
    'sense_proposal_confirmations',
    'expression_binding_confirmations',
    'personal_meaning_alignments',
    'personal_meaning_alignment_events'
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

COMMENT ON TABLE sensa.personal_meanings IS
  'Stable learner-owned Personal Meaning identities. Non-deleted rows form the implicit Personal Semantic World.';
COMMENT ON TABLE sensa.personal_meaning_revisions IS
  'Immutable Personal Meaning metadata revisions; Meaning Focus and Anchors are separate objects.';
COMMENT ON TABLE sensa.personal_semantic_anchor_revisions IS
  'Private typed personal grounding. These rows are not public Sense content or Learning Evidence.';
COMMENT ON TABLE sensa.sense_proposal_confirmations IS
  'Idempotent explicit learner confirmation of one exact Sense Proposal Version.';
COMMENT ON TABLE sensa.expression_binding_confirmations IS
  'Explicit expression-binding confirmation, intentionally separate from Sense Proposal confirmation.';
COMMENT ON TABLE sensa.personal_meaning_alignments IS
  'Private provenance link pinning exact Personal Meaning/Focus and Sense Versions.';

REVOKE ALL ON FUNCTION sensa.guard_personal_revision_head() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_immutable_personal_fact() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_personal_media_lifecycle() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_sense_construction_lifecycle() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_sense_proposal_lifecycle() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_meaning_focus_acceptance_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_sense_construction_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_sense_confirmation_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_expression_binding_confirmation_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_personal_alignment_identity() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_personal_alignment_event_transition() FROM PUBLIC, backend_app;
