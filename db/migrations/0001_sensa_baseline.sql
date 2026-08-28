-- Sensa standalone baseline. This is a clean schema, not an upgrade path for
-- the flashcard database. It contains the compatibility seam used by the
-- first extraction packet and the production Sensa objects only.
--
-- Compatibility seam: Sensa runtime rows retain workspace_id and
-- learner_user_id while the application migrates. LearnerScope is the public
-- contract; Workspace is an internal authorization boundary and is not a
-- product concept.
-- Schemas touched/read explicitly: core, org, sync, content, security, sensa,
-- pg_catalog, public.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS sync;
CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS security;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backend_app') THEN
    CREATE ROLE backend_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_app') THEN
    CREATE ROLE auth_app NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS core.accounts (
  account_id TEXT PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.learners (
  learner_user_id TEXT PRIMARY KEY REFERENCES core.accounts(account_id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'zh-Hans',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org.workspaces (
  workspace_id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org.workspace_members (
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, learner_user_id)
);

-- Temporary adapter view for the extracted Sensa application modules.  The
-- product contract is LearnerScope; this view lets the first vertical slice
-- consume the old backend's membership column names without bringing the
-- generic workspace implementation into the standalone repository.
CREATE OR REPLACE VIEW org.workspace_memberships AS
SELECT workspace_id,
       learner_user_id AS user_id,
       role,
       created_at
  FROM org.workspace_members;

CREATE TABLE IF NOT EXISTS org.user_settings (
  user_id TEXT PRIMARY KEY REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL,
  locale TEXT NOT NULL DEFAULT 'zh-Hans',
  progress_time_zone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync.installations (
  installation_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync.workspace_replicas (
  replica_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES core.learners(learner_user_id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('client_installation', 'system')),
  installation_id UUID REFERENCES sync.installations(installation_id) ON DELETE RESTRICT,
  actor_key TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web', 'system')),
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_replicas_actor_shape CHECK (
    (actor_kind = 'client_installation' AND installation_id IS NOT NULL AND actor_key IS NULL)
    OR (actor_kind <> 'client_installation' AND installation_id IS NULL AND actor_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS standalone_workspace_replica_installation_idx
  ON sync.workspace_replicas(workspace_id, installation_id)
  WHERE actor_kind = 'client_installation';

CREATE TABLE IF NOT EXISTS content.media_blobs (
  media_blob_id UUID PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type TEXT NOT NULL CHECK (btrim(mime_type) <> ''),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_key TEXT NOT NULL UNIQUE CHECK (btrim(storage_key) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION security.current_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION security.current_workspace_access_allowed(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT p_workspace_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM org.workspace_members AS members
      WHERE members.workspace_id = p_workspace_id
        AND members.learner_user_id = security.current_user_id()
    );
$$;

GRANT USAGE ON SCHEMA core, org, sync, content, security TO backend_app;
GRANT SELECT, INSERT, UPDATE ON core.accounts, core.learners, org.workspaces,
  org.workspace_members, org.workspace_memberships, org.user_settings,
  sync.installations, sync.workspace_replicas,
  content.media_blobs TO backend_app;
GRANT EXECUTE ON FUNCTION security.current_user_id(),
  security.current_workspace_access_allowed(UUID) TO backend_app;

-- Schemas touched/read explicitly: sensa, content, security, pg_catalog.
-- Migration status: Current / additive.
-- Introduces: the immutable Sensa content kernel and publish-time package gate.

CREATE SCHEMA IF NOT EXISTS sensa;

COMMENT ON SCHEMA sensa IS
  'Sensa sense-first semantic and pedagogical content. Published releases are immutable.';

DO $$
BEGIN
  CREATE TYPE sensa.content_release_status AS ENUM (
    'draft',
    'approved',
    'published',
    'superseded'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.content_review_status AS ENUM (
    'draft',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.manifest_status AS ENUM (
    'incomplete',
    'satisfied',
    'invalid'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.teaching_priority AS ENUM (
    'core',
    'extended',
    'recognition'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.relation_scope AS ENUM (
    'intra_word',
    'cross_word'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.acquisition_need AS ENUM (
    'perceptual_grounding',
    'boundary_formation',
    'abstraction_invariant',
    'spatial_aspectual_tuning',
    'social_normative_calibration',
    'form_binding'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.acquisition_primitive AS ENUM (
    'visual_grounding',
    'motion_grounding',
    'spatial_relation',
    'causal_sequence',
    'temporal_sequence',
    'social_micro_scenario',
    'introspective_scenario',
    'contrast_pair',
    'counterexample',
    'contextual_variation',
    'production_cue'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.asset_kind AS ENUM (
    'experience_sketch',
    'l1_bridge',
    'example',
    'pronunciation_audio',
    'study_example_audio',
    'boundary_note',
    'contrast_pair',
    'counterexample',
    'visual_grounding',
    'spatial_diagram',
    'causal_sequence',
    'temporal_sequence',
    'extended_audio'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.asset_capability AS ENUM (
    'meaning_grounding',
    'l1_mediation',
    'usage_pattern',
    'contextual_variation',
    'pronunciation',
    'study_example_audio',
    'boundary_contrast',
    'counterexample',
    'visual_grounding',
    'spatial_grounding',
    'causal_grounding',
    'temporal_grounding',
    'extended_audio'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.example_role AS ENUM (
    'study',
    'quiz'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.example_construction AS ENUM (
    'head_verb',
    'nonfinite_verb',
    'passive',
    'subject',
    'object',
    'prep_object',
    'predicative',
    'modifier',
    'adverbial'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.scene_domain AS ENUM (
    'daily_life',
    'work_business',
    'study_school',
    'social_relations',
    'media_news',
    'travel_transport',
    'health_body',
    'tech_digital',
    'nature_environment',
    'arts_leisure'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.array_has_nonempty_text(p_values TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT cardinality(p_values) > 0
    AND COALESCE(
      (SELECT bool_and(btrim(value) <> '') FROM unnest(p_values) AS value),
      false
    );
$$;

CREATE TABLE IF NOT EXISTS sensa.content_releases (
  content_release_id UUID PRIMARY KEY,
  release_key TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  target_language TEXT NOT NULL,
  learner_locale TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  status sensa.content_release_status NOT NULL DEFAULT 'draft',
  validator_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  CONSTRAINT content_releases_release_key_nonempty CHECK (btrim(release_key) <> ''),
  CONSTRAINT content_releases_target_language_nonempty CHECK (btrim(target_language) <> ''),
  CONSTRAINT content_releases_learner_locale_nonempty CHECK (btrim(learner_locale) <> ''),
  CONSTRAINT content_releases_schema_version_nonempty CHECK (btrim(schema_version) <> ''),
  CONSTRAINT content_releases_validator_version_nonempty CHECK (
    validator_version IS NULL OR btrim(validator_version) <> ''
  ),
  CONSTRAINT content_releases_version_positive CHECK (version_number > 0),
  CONSTRAINT content_releases_source_digest_sha256 CHECK (
    source_digest ~ '^[0-9a-f]{64}$' AND source_digest = lower(source_digest)
  ),
  CONSTRAINT content_releases_release_version_unique UNIQUE (release_key, version_number),
  CONSTRAINT content_releases_source_digest_unique UNIQUE (source_digest)
);

CREATE TABLE IF NOT EXISTS sensa.lexemes (
  lexeme_id UUID PRIMARY KEY,
  language_tag TEXT NOT NULL,
  lemma TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lexemes_language_tag_nonempty CHECK (btrim(language_tag) <> ''),
  CONSTRAINT lexemes_lemma_nonempty CHECK (btrim(lemma) <> ''),
  CONSTRAINT lexemes_language_lemma_unique UNIQUE (language_tag, lemma)
);

CREATE TABLE IF NOT EXISTS sensa.lexeme_versions (
  lexeme_version_id UUID PRIMARY KEY,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  lexeme_id UUID NOT NULL REFERENCES sensa.lexemes(lexeme_id) ON DELETE RESTRICT,
  ipa_us TEXT,
  ipa_uk TEXT,
  syllables TEXT,
  forms TEXT[] NOT NULL,
  frequency_rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lexeme_versions_forms_nonempty CHECK (sensa.array_has_nonempty_text(forms)),
  CONSTRAINT lexeme_versions_frequency_positive CHECK (frequency_rank IS NULL OR frequency_rank > 0),
  CONSTRAINT lexeme_versions_release_lexeme_unique UNIQUE (content_release_id, lexeme_id)
);

CREATE TABLE IF NOT EXISTS sensa.senses (
  sense_id UUID PRIMARY KEY,
  sense_key TEXT NOT NULL,
  lexeme_id UUID NOT NULL REFERENCES sensa.lexemes(lexeme_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT senses_sense_key_nonempty CHECK (btrim(sense_key) <> ''),
  CONSTRAINT senses_sense_key_unique UNIQUE (sense_key)
);

CREATE TABLE IF NOT EXISTS sensa.sense_versions (
  sense_version_id UUID PRIMARY KEY,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_rank SMALLINT NOT NULL,
  part_of_speech TEXT NOT NULL,
  guide_label_l1 TEXT NOT NULL,
  definition_l2 TEXT NOT NULL,
  teaching_priority sensa.teaching_priority NOT NULL DEFAULT 'core',
  register_label TEXT,
  domain_label TEXT,
  semantic_type TEXT,
  semantic_dimension TEXT,
  valency TEXT,
  semantic_note TEXT,
  change_of_state BOOLEAN NOT NULL DEFAULT false,
  causative BOOLEAN NOT NULL DEFAULT false,
  inventory_version INTEGER NOT NULL,
  evidence_digest TEXT NOT NULL,
  identity_digest TEXT NOT NULL,
  review_status sensa.content_review_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT sense_versions_rank_positive CHECK (sense_rank > 0),
  CONSTRAINT sense_versions_part_of_speech_nonempty CHECK (btrim(part_of_speech) <> ''),
  CONSTRAINT sense_versions_guide_label_nonempty CHECK (btrim(guide_label_l1) <> ''),
  CONSTRAINT sense_versions_definition_nonempty CHECK (btrim(definition_l2) <> ''),
  CONSTRAINT sense_versions_inventory_version_positive CHECK (inventory_version > 0),
  CONSTRAINT sense_versions_evidence_digest_nonempty CHECK (btrim(evidence_digest) <> ''),
  CONSTRAINT sense_versions_identity_digest_nonempty CHECK (btrim(identity_digest) <> ''),
  CONSTRAINT sense_versions_release_sense_unique UNIQUE (content_release_id, sense_id)
);

CREATE TABLE IF NOT EXISTS sensa.sense_relations (
  sense_relation_id UUID PRIMARY KEY,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  source_sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  target_sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL,
  scope sensa.relation_scope NOT NULL,
  distinguishing_feature TEXT NOT NULL,
  source_evidence_refs TEXT[] NOT NULL,
  review_status sensa.content_review_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT sense_relations_not_self CHECK (source_sense_id <> target_sense_id),
  CONSTRAINT sense_relations_type_nonempty CHECK (btrim(relation_type) <> ''),
  CONSTRAINT sense_relations_feature_nonempty CHECK (btrim(distinguishing_feature) <> ''),
  CONSTRAINT sense_relations_evidence_nonempty CHECK (sensa.array_has_nonempty_text(source_evidence_refs)),
  CONSTRAINT sense_relations_unique UNIQUE (
    content_release_id,
    source_sense_id,
    target_sense_id,
    relation_type
  )
);

CREATE TABLE IF NOT EXISTS sensa.usage_patterns (
  usage_pattern_id UUID PRIMARY KEY,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE CASCADE,
  ordinal SMALLINT NOT NULL,
  canonical_pattern TEXT NOT NULL,
  common_collocations TEXT[] NOT NULL DEFAULT '{}',
  register_label TEXT,
  domain_label TEXT,
  usage_restriction TEXT,
  source_evidence_refs TEXT[] NOT NULL,
  review_status sensa.content_review_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT usage_patterns_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT usage_patterns_pattern_nonempty CHECK (btrim(canonical_pattern) <> ''),
  CONSTRAINT usage_patterns_evidence_nonempty CHECK (sensa.array_has_nonempty_text(source_evidence_refs)),
  CONSTRAINT usage_patterns_sense_ordinal_unique UNIQUE (sense_version_id, ordinal),
  CONSTRAINT usage_patterns_release_id_unique UNIQUE (content_release_id, usage_pattern_id)
);

CREATE TABLE IF NOT EXISTS sensa.usage_pattern_slots (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  usage_pattern_id UUID NOT NULL REFERENCES sensa.usage_patterns(usage_pattern_id) ON DELETE CASCADE,
  ordinal SMALLINT NOT NULL,
  slot_name TEXT NOT NULL,
  semantic_role TEXT NOT NULL,
  value_description TEXT NOT NULL,
  is_optional BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (usage_pattern_id, ordinal),
  CONSTRAINT usage_pattern_slots_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT usage_pattern_slots_name_nonempty CHECK (btrim(slot_name) <> ''),
  CONSTRAINT usage_pattern_slots_role_nonempty CHECK (btrim(semantic_role) <> ''),
  CONSTRAINT usage_pattern_slots_description_nonempty CHECK (btrim(value_description) <> ''),
  CONSTRAINT usage_pattern_slots_release_id_unique UNIQUE (content_release_id, usage_pattern_id, ordinal)
);

CREATE TABLE IF NOT EXISTS sensa.acquisition_profiles (
  acquisition_profile_id UUID PRIMARY KEY,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE CASCADE,
  learner_locale TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  acquisition_needs sensa.acquisition_need[] NOT NULL,
  minimum_sufficient_experience TEXT NOT NULL,
  distinguishing_features TEXT[] NOT NULL,
  preferred_primitives sensa.acquisition_primitive[] NOT NULL,
  required_asset_capabilities sensa.asset_capability[] NOT NULL DEFAULT '{}',
  optional_asset_capabilities sensa.asset_capability[] NOT NULL DEFAULT '{}',
  fallback_primitives sensa.acquisition_primitive[] NOT NULL,
  domain_bound BOOLEAN NOT NULL DEFAULT false,
  domain_constraints TEXT[] NOT NULL DEFAULT '{}',
  generator_provider TEXT,
  generator_model TEXT,
  prompt_version TEXT,
  source_digest TEXT NOT NULL,
  review_status sensa.content_review_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT acquisition_profiles_locale_nonempty CHECK (btrim(learner_locale) <> ''),
  CONSTRAINT acquisition_profiles_schema_nonempty CHECK (btrim(schema_version) <> ''),
  CONSTRAINT acquisition_profiles_needs_nonempty CHECK (cardinality(acquisition_needs) > 0),
  CONSTRAINT acquisition_profiles_experience_nonempty CHECK (btrim(minimum_sufficient_experience) <> ''),
  CONSTRAINT acquisition_profiles_features_nonempty CHECK (sensa.array_has_nonempty_text(distinguishing_features)),
  CONSTRAINT acquisition_profiles_primitives_nonempty CHECK (cardinality(preferred_primitives) > 0),
  CONSTRAINT acquisition_profiles_fallback_nonempty CHECK (cardinality(fallback_primitives) > 0),
  CONSTRAINT acquisition_profiles_capabilities_disjoint CHECK (
    NOT (required_asset_capabilities && optional_asset_capabilities)
  ),
  CONSTRAINT acquisition_profiles_domain_constraints_nonempty CHECK (
    NOT domain_bound OR cardinality(domain_constraints) > 0
  ),
  CONSTRAINT acquisition_profiles_source_digest_nonempty CHECK (btrim(source_digest) <> ''),
  CONSTRAINT acquisition_profiles_sense_locale_unique UNIQUE (sense_version_id, learner_locale),
  CONSTRAINT acquisition_profiles_release_id_unique UNIQUE (content_release_id, acquisition_profile_id)
);

CREATE TABLE IF NOT EXISTS sensa.profile_boundary_targets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  acquisition_profile_id UUID NOT NULL REFERENCES sensa.acquisition_profiles(acquisition_profile_id) ON DELETE CASCADE,
  sense_relation_id UUID NOT NULL REFERENCES sensa.sense_relations(sense_relation_id) ON DELETE RESTRICT,
  ordinal SMALLINT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (acquisition_profile_id, sense_relation_id),
  CONSTRAINT profile_boundary_targets_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT profile_boundary_targets_ordinal_unique UNIQUE (acquisition_profile_id, ordinal),
  CONSTRAINT profile_boundary_targets_release_id_unique UNIQUE (
    content_release_id,
    acquisition_profile_id,
    sense_relation_id
  )
);

CREATE TABLE IF NOT EXISTS sensa.learning_assets (
  learning_asset_id UUID PRIMARY KEY,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  asset_kind sensa.asset_kind NOT NULL,
  sense_version_id UUID REFERENCES sensa.sense_versions(sense_version_id) ON DELETE CASCADE,
  lexeme_version_id UUID REFERENCES sensa.lexeme_versions(lexeme_version_id) ON DELETE CASCADE,
  learner_locale TEXT,
  content_digest TEXT NOT NULL,
  source_evidence_refs TEXT[] NOT NULL,
  generator_provider TEXT,
  generator_model TEXT,
  prompt_version TEXT,
  source_license TEXT,
  source_attribution TEXT,
  review_status sensa.content_review_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT learning_assets_digest_nonempty CHECK (btrim(content_digest) <> ''),
  CONSTRAINT learning_assets_evidence_nonempty CHECK (sensa.array_has_nonempty_text(source_evidence_refs)),
  CONSTRAINT learning_assets_owner_shape CHECK (
    (asset_kind = 'pronunciation_audio' AND lexeme_version_id IS NOT NULL AND sense_version_id IS NULL)
    OR (asset_kind <> 'pronunciation_audio' AND sense_version_id IS NOT NULL AND lexeme_version_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS learning_assets_sense_digest_unique
  ON sensa.learning_assets(content_release_id, asset_kind, sense_version_id, content_digest)
  WHERE sense_version_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS learning_assets_lexeme_digest_unique
  ON sensa.learning_assets(content_release_id, asset_kind, lexeme_version_id, content_digest)
  WHERE lexeme_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sensa.text_assets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID PRIMARY KEY REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  sense_relation_id UUID REFERENCES sensa.sense_relations(sense_relation_id) ON DELETE RESTRICT,
  CONSTRAINT text_assets_body_nonempty CHECK (btrim(body) <> '')
);

CREATE TABLE IF NOT EXISTS sensa.example_assets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID PRIMARY KEY REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE CASCADE,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE CASCADE,
  ordinal SMALLINT NOT NULL,
  text_l2 TEXT NOT NULL,
  text_l1 TEXT NOT NULL,
  target_form TEXT NOT NULL,
  target_start INTEGER NOT NULL,
  target_end INTEGER NOT NULL,
  disambiguating_cue TEXT,
  variation_note TEXT,
  construction sensa.example_construction NOT NULL,
  scene_domain sensa.scene_domain NOT NULL,
  collocations TEXT[] NOT NULL DEFAULT '{}',
  role sensa.example_role NOT NULL,
  context_l2 TEXT,
  context_l1 TEXT,
  CONSTRAINT example_assets_ordinal_range CHECK (ordinal > 0),
  CONSTRAINT example_assets_text_nonempty CHECK (
    btrim(text_l2) <> '' AND btrim(text_l1) <> '' AND btrim(target_form) <> ''
  ),
  CONSTRAINT example_assets_span_shape CHECK (
    target_start >= 0 AND target_end > target_start AND target_end <= char_length(text_l2)
  ),
  CONSTRAINT example_assets_sense_ordinal_unique UNIQUE (sense_version_id, ordinal),
  CONSTRAINT example_assets_release_id_unique UNIQUE (content_release_id, learning_asset_id)
);

CREATE TABLE IF NOT EXISTS sensa.contrast_case_assets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID PRIMARY KEY REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE CASCADE,
  sense_relation_id UUID NOT NULL REFERENCES sensa.sense_relations(sense_relation_id) ON DELETE RESTRICT,
  positive_text_l2 TEXT NOT NULL,
  positive_text_l1 TEXT NOT NULL,
  negative_text_l2 TEXT NOT NULL,
  negative_text_l1 TEXT NOT NULL,
  distinguishing_feature TEXT NOT NULL,
  CONSTRAINT contrast_case_assets_text_nonempty CHECK (
    btrim(positive_text_l2) <> '' AND btrim(positive_text_l1) <> ''
    AND btrim(negative_text_l2) <> '' AND btrim(negative_text_l1) <> ''
    AND btrim(distinguishing_feature) <> ''
  )
);

CREATE TABLE IF NOT EXISTS sensa.visual_assets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID PRIMARY KEY REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE CASCADE,
  media_blob_id UUID NOT NULL REFERENCES content.media_blobs(media_blob_id) ON DELETE RESTRICT,
  alt_text TEXT NOT NULL,
  distinguishing_feature TEXT NOT NULL,
  source_license TEXT NOT NULL,
  source_attribution TEXT NOT NULL,
  CONSTRAINT visual_assets_text_nonempty CHECK (
    btrim(alt_text) <> '' AND btrim(distinguishing_feature) <> ''
    AND btrim(source_license) <> '' AND btrim(source_attribution) <> ''
  )
);

CREATE TABLE IF NOT EXISTS sensa.diagram_assets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID PRIMARY KEY REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE CASCADE,
  figure_label TEXT NOT NULL,
  ground_label TEXT NOT NULL,
  path_description TEXT NOT NULL,
  topology TEXT NOT NULL,
  text_fallback TEXT NOT NULL,
  start_description TEXT,
  endpoint_description TEXT,
  contrast_relation_id UUID REFERENCES sensa.sense_relations(sense_relation_id) ON DELETE RESTRICT,
  CONSTRAINT diagram_assets_text_nonempty CHECK (
    btrim(figure_label) <> '' AND btrim(ground_label) <> ''
    AND btrim(path_description) <> '' AND btrim(topology) <> ''
    AND btrim(text_fallback) <> ''
  )
);

CREATE TABLE IF NOT EXISTS sensa.sequence_assets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID PRIMARY KEY REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE CASCADE,
  text_fallback TEXT NOT NULL,
  CONSTRAINT sequence_assets_text_fallback_nonempty CHECK (btrim(text_fallback) <> '')
);

CREATE TABLE IF NOT EXISTS sensa.sequence_asset_steps (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID NOT NULL REFERENCES sensa.sequence_assets(learning_asset_id) ON DELETE CASCADE,
  ordinal SMALLINT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  PRIMARY KEY (learning_asset_id, ordinal),
  CONSTRAINT sequence_asset_steps_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT sequence_asset_steps_label_nonempty CHECK (btrim(label) <> ''),
  CONSTRAINT sequence_asset_steps_description_nonempty CHECK (btrim(description) <> ''),
  CONSTRAINT sequence_asset_steps_release_id_unique UNIQUE (content_release_id, learning_asset_id, ordinal)
);

CREATE TABLE IF NOT EXISTS sensa.audio_assets (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  learning_asset_id UUID PRIMARY KEY REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE CASCADE,
  media_blob_id UUID NOT NULL REFERENCES content.media_blobs(media_blob_id) ON DELETE RESTRICT,
  source_example_asset_id UUID REFERENCES sensa.example_assets(learning_asset_id) ON DELETE RESTRICT,
  accent_locale TEXT,
  provider TEXT,
  model TEXT,
  voice TEXT,
  source_text_digest TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  CONSTRAINT audio_assets_source_digest_nonempty CHECK (btrim(source_text_digest) <> ''),
  CONSTRAINT audio_assets_duration_positive CHECK (duration_ms > 0)
);

CREATE TABLE IF NOT EXISTS sensa.required_asset_manifests (
  required_asset_manifest_id UUID PRIMARY KEY,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE CASCADE,
  acquisition_profile_id UUID NOT NULL REFERENCES sensa.acquisition_profiles(acquisition_profile_id) ON DELETE CASCADE,
  validator_version TEXT NOT NULL,
  status sensa.manifest_status NOT NULL DEFAULT 'incomplete',
  package_digest TEXT NOT NULL,
  validated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT required_asset_manifests_validator_nonempty CHECK (btrim(validator_version) <> ''),
  CONSTRAINT required_asset_manifests_package_digest_sha256 CHECK (
    package_digest ~ '^[0-9a-f]{64}$' AND package_digest = lower(package_digest)
  ),
  CONSTRAINT required_asset_manifests_unique UNIQUE (
    sense_version_id,
    acquisition_profile_id,
    validator_version,
    package_digest
  )
);

CREATE TABLE IF NOT EXISTS sensa.manifest_requirements (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  manifest_requirement_id UUID PRIMARY KEY,
  required_asset_manifest_id UUID NOT NULL REFERENCES sensa.required_asset_manifests(required_asset_manifest_id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL,
  capability sensa.asset_capability NOT NULL,
  required_count INTEGER NOT NULL,
  satisfied_count INTEGER NOT NULL DEFAULT 0,
  status sensa.manifest_status NOT NULL DEFAULT 'incomplete',
  CONSTRAINT manifest_requirements_key_nonempty CHECK (btrim(requirement_key) <> ''),
  CONSTRAINT manifest_requirements_required_count_nonnegative CHECK (required_count >= 0),
  CONSTRAINT manifest_requirements_satisfied_count_nonnegative CHECK (satisfied_count >= 0),
  CONSTRAINT manifest_requirements_satisfied_count_not_below_required CHECK (
    status <> 'satisfied' OR satisfied_count >= required_count
  ),
  CONSTRAINT manifest_requirements_manifest_key_unique UNIQUE (required_asset_manifest_id, requirement_key),
  CONSTRAINT manifest_requirements_release_id_unique UNIQUE (
    content_release_id,
    manifest_requirement_id
  )
);

CREATE TABLE IF NOT EXISTS sensa.manifest_requirement_asset_matches (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  manifest_requirement_id UUID NOT NULL REFERENCES sensa.manifest_requirements(manifest_requirement_id) ON DELETE CASCADE,
  learning_asset_id UUID NOT NULL REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE RESTRICT,
  PRIMARY KEY (manifest_requirement_id, learning_asset_id)
);

CREATE TABLE IF NOT EXISTS sensa.manifest_requirement_usage_pattern_matches (
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE CASCADE,
  manifest_requirement_id UUID NOT NULL REFERENCES sensa.manifest_requirements(manifest_requirement_id) ON DELETE CASCADE,
  usage_pattern_id UUID NOT NULL REFERENCES sensa.usage_patterns(usage_pattern_id) ON DELETE RESTRICT,
  PRIMARY KEY (manifest_requirement_id, usage_pattern_id)
);

CREATE INDEX IF NOT EXISTS sensa_lexeme_versions_release_idx
  ON sensa.lexeme_versions(content_release_id, lexeme_id);
CREATE INDEX IF NOT EXISTS sensa_sense_versions_release_rank_idx
  ON sensa.sense_versions(content_release_id, sense_rank);
CREATE INDEX IF NOT EXISTS sensa_sense_relations_release_source_idx
  ON sensa.sense_relations(content_release_id, source_sense_id);
CREATE INDEX IF NOT EXISTS sensa_usage_patterns_release_sense_idx
  ON sensa.usage_patterns(content_release_id, sense_version_id);
CREATE INDEX IF NOT EXISTS sensa_profiles_release_sense_idx
  ON sensa.acquisition_profiles(content_release_id, sense_version_id);
CREATE INDEX IF NOT EXISTS sensa_assets_release_kind_idx
  ON sensa.learning_assets(content_release_id, asset_kind);
CREATE INDEX IF NOT EXISTS sensa_examples_release_sense_idx
  ON sensa.example_assets(content_release_id, sense_version_id, ordinal);
CREATE INDEX IF NOT EXISTS sensa_manifests_release_sense_idx
  ON sensa.required_asset_manifests(content_release_id, sense_version_id);

CREATE OR REPLACE FUNCTION sensa.release_status(p_content_release_id UUID)
RETURNS sensa.content_release_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
  SELECT status
  FROM sensa.content_releases
  WHERE content_release_id = p_content_release_id;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_release_mutable(p_content_release_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  release_status sensa.content_release_status;
BEGIN
  SELECT status INTO release_status
  FROM sensa.content_releases
  WHERE content_release_id = p_content_release_id;

  IF release_status IS NULL THEN
    RAISE EXCEPTION 'Sensa content release % does not exist', p_content_release_id
      USING ERRCODE = '23503';
  END IF;

  IF release_status IN ('published', 'superseded') THEN
    RAISE EXCEPTION 'Sensa content release % is immutable in status %', p_content_release_id, release_status
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_release_identity(
  p_expected_release UUID,
  p_actual_release UUID,
  p_context TEXT
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_expected_release IS DISTINCT FROM p_actual_release THEN
    RAISE EXCEPTION 'Sensa % crosses content releases', p_context
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_content_release_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'superseded') THEN
      RAISE EXCEPTION 'Published or superseded Sensa content releases cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'approved') THEN
    RAISE EXCEPTION 'Invalid Sensa content release transition draft -> %', NEW.status
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'published') THEN
    RAISE EXCEPTION 'Invalid Sensa content release transition approved -> %', NEW.status
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'published' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'Published Sensa content releases may only transition to superseded'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'Superseded Sensa content releases are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('published', 'superseded')
    AND (
      NEW.content_release_id IS DISTINCT FROM OLD.content_release_id
      OR NEW.release_key IS DISTINCT FROM OLD.release_key
      OR NEW.version_number IS DISTINCT FROM OLD.version_number
      OR NEW.target_language IS DISTINCT FROM OLD.target_language
      OR NEW.learner_locale IS DISTINCT FROM OLD.learner_locale
      OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
      OR NEW.source_digest IS DISTINCT FROM OLD.source_digest
      OR NEW.validator_version IS DISTINCT FROM OLD.validator_version
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR (OLD.status = 'superseded' AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
    ) THEN
    RAISE EXCEPTION 'Published Sensa content release metadata is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sense_version_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  sense_lexeme UUID;
  lexeme_language TEXT;
  release_target_language TEXT;
BEGIN
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);

  SELECT senses.lexeme_id, lexemes.language_tag
    INTO sense_lexeme, lexeme_language
  FROM sensa.senses AS senses
  JOIN sensa.lexemes AS lexemes ON lexemes.lexeme_id = senses.lexeme_id
  WHERE senses.sense_id = NEW.sense_id;
  IF sense_lexeme IS NULL THEN
    RAISE EXCEPTION 'Sensa sense % has no stable lexeme identity', NEW.sense_id
      USING ERRCODE = '23503';
  END IF;

  SELECT target_language INTO release_target_language
  FROM sensa.content_releases
  WHERE content_release_id = NEW.content_release_id;
  IF lexeme_language IS DISTINCT FROM release_target_language THEN
    RAISE EXCEPTION 'Sensa lexeme language % does not match release target language %',
      lexeme_language, release_target_language
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sensa.lexeme_versions
    WHERE content_release_id = NEW.content_release_id
      AND lexeme_id = sense_lexeme
  ) THEN
    RAISE EXCEPTION 'Sensa sense % has no lexeme version in release %', NEW.sense_id, NEW.content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.sense_versions AS other
    JOIN sensa.senses AS other_sense ON other_sense.sense_id = other.sense_id
    WHERE other.content_release_id = NEW.content_release_id
      AND other_sense.lexeme_id = sense_lexeme
      AND other.sense_rank = NEW.sense_rank
      AND other.sense_version_id <> NEW.sense_version_id
  ) THEN
    RAISE EXCEPTION 'Sensa sense rank % is duplicated for lexeme % in release %',
      NEW.sense_rank, sense_lexeme, NEW.content_release_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_lexeme_version_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  lexeme_language TEXT;
  release_target_language TEXT;
BEGIN
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);

  SELECT language_tag INTO lexeme_language
  FROM sensa.lexemes
  WHERE lexeme_id = NEW.lexeme_id;
  SELECT target_language INTO release_target_language
  FROM sensa.content_releases
  WHERE content_release_id = NEW.content_release_id;
  IF lexeme_language IS NULL THEN
    RAISE EXCEPTION 'Sensa lexeme version % has no stable lexeme identity', NEW.lexeme_version_id
      USING ERRCODE = '23503';
  END IF;
  IF lexeme_language IS DISTINCT FROM release_target_language THEN
    RAISE EXCEPTION 'Sensa lexeme language % does not match release target language %',
      lexeme_language, release_target_language
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_relation_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  source_lexeme UUID;
  target_lexeme UUID;
BEGIN
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);

  SELECT lexeme_id INTO source_lexeme FROM sensa.senses WHERE sense_id = NEW.source_sense_id;
  SELECT lexeme_id INTO target_lexeme FROM sensa.senses WHERE sense_id = NEW.target_sense_id;
  IF source_lexeme IS NULL OR target_lexeme IS NULL THEN
    RAISE EXCEPTION 'Sensa relation references an unknown stable sense'
      USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sensa.sense_versions
    WHERE content_release_id = NEW.content_release_id AND sense_id = NEW.source_sense_id
  ) OR NOT EXISTS (
    SELECT 1 FROM sensa.sense_versions
    WHERE content_release_id = NEW.content_release_id AND sense_id = NEW.target_sense_id
  ) THEN
    RAISE EXCEPTION 'Sensa relation references a sense outside release %', NEW.content_release_id
      USING ERRCODE = '23514';
  END IF;
  IF (NEW.scope = 'intra_word' AND source_lexeme <> target_lexeme)
    OR (NEW.scope = 'cross_word' AND source_lexeme = target_lexeme) THEN
    RAISE EXCEPTION 'Sensa relation scope does not match its lexeme identities'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_usage_pattern_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  owner_release UUID;
BEGIN
  SELECT content_release_id INTO owner_release
  FROM sensa.sense_versions
  WHERE sense_version_id = NEW.sense_version_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, owner_release, 'usage pattern');
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_profile_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  owner_release UUID;
  release_locale TEXT;
BEGIN
  SELECT content_release_id INTO owner_release
  FROM sensa.sense_versions
  WHERE sense_version_id = NEW.sense_version_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, owner_release, 'acquisition profile');
  SELECT learner_locale INTO release_locale
  FROM sensa.content_releases
  WHERE content_release_id = NEW.content_release_id;
  IF NEW.learner_locale IS DISTINCT FROM release_locale THEN
    RAISE EXCEPTION 'Acquisition profile locale % does not match release learner locale %',
      NEW.learner_locale, release_locale
      USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_profile_boundary_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  profile_release UUID;
  relation_release UUID;
BEGIN
  SELECT content_release_id INTO profile_release
  FROM sensa.acquisition_profiles
  WHERE acquisition_profile_id = NEW.acquisition_profile_id;
  SELECT content_release_id INTO relation_release
  FROM sensa.sense_relations
  WHERE sense_relation_id = NEW.sense_relation_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, profile_release, 'profile boundary target');
  PERFORM sensa.assert_release_identity(NEW.content_release_id, relation_release, 'profile boundary target relation');
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_learning_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  owner_release UUID;
BEGIN
  IF NEW.sense_version_id IS NOT NULL THEN
    SELECT content_release_id INTO owner_release
    FROM sensa.sense_versions
    WHERE sense_version_id = NEW.sense_version_id;
  ELSE
    SELECT content_release_id INTO owner_release
    FROM sensa.lexeme_versions
    WHERE lexeme_version_id = NEW.lexeme_version_id;
  END IF;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, owner_release, 'learning asset');
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_text_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
  relation_release UUID;
  asset_kind sensa.asset_kind;
BEGIN
  SELECT assets.content_release_id, assets.asset_kind
    INTO asset_release, asset_kind
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = NEW.learning_asset_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'text asset');
  SELECT content_release_id INTO relation_release
  FROM sensa.sense_relations
  WHERE sense_relation_id = NEW.sense_relation_id;
  IF asset_kind = 'boundary_note' THEN
    IF NEW.sense_relation_id IS NULL THEN
      RAISE EXCEPTION 'Boundary Note assets require a Sense Relation' USING ERRCODE = '23514';
    END IF;
    PERFORM sensa.assert_release_identity(NEW.content_release_id, relation_release, 'boundary note relation');
  ELSIF NEW.sense_relation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only Boundary Note assets may reference a Sense Relation' USING ERRCODE = '23514';
  END IF;
  IF asset_kind NOT IN ('experience_sketch', 'l1_bridge', 'boundary_note') THEN
    RAISE EXCEPTION 'Text assets may only back text asset kinds' USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_example_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
  asset_kind sensa.asset_kind;
  asset_sense UUID;
BEGIN
  SELECT assets.content_release_id, assets.asset_kind, assets.sense_version_id
    INTO asset_release, asset_kind, asset_sense
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = NEW.learning_asset_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'example asset');
  IF asset_kind <> 'example' OR asset_sense IS DISTINCT FROM NEW.sense_version_id THEN
    RAISE EXCEPTION 'Example asset owner does not match its Learning Asset' USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_relation_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
  asset_kind sensa.asset_kind;
  relation_release UUID;
BEGIN
  SELECT assets.content_release_id, assets.asset_kind
    INTO asset_release, asset_kind
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = NEW.learning_asset_id;
  SELECT content_release_id INTO relation_release
  FROM sensa.sense_relations
  WHERE sense_relation_id = NEW.sense_relation_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'relation asset');
  PERFORM sensa.assert_release_identity(NEW.content_release_id, relation_release, 'relation asset relation');
  IF asset_kind NOT IN ('contrast_pair', 'counterexample') THEN
    RAISE EXCEPTION 'Contrast case table has an incompatible Learning Asset kind' USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_visual_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
  asset_kind sensa.asset_kind;
BEGIN
  SELECT assets.content_release_id, assets.asset_kind
    INTO asset_release, asset_kind
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = NEW.learning_asset_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'visual asset');
  IF asset_kind <> 'visual_grounding' THEN
    RAISE EXCEPTION 'Visual asset has an incompatible Learning Asset kind' USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_diagram_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
  asset_kind sensa.asset_kind;
  relation_release UUID;
BEGIN
  SELECT assets.content_release_id, assets.asset_kind
    INTO asset_release, asset_kind
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = NEW.learning_asset_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'diagram asset');
  SELECT content_release_id INTO relation_release
  FROM sensa.sense_relations
  WHERE sense_relation_id = NEW.contrast_relation_id;
  IF NEW.contrast_relation_id IS NOT NULL THEN
    PERFORM sensa.assert_release_identity(NEW.content_release_id, relation_release, 'diagram contrast relation');
  END IF;
  IF asset_kind <> 'spatial_diagram' THEN
    RAISE EXCEPTION 'Diagram asset has an incompatible Learning Asset kind' USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sequence_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
  asset_kind sensa.asset_kind;
BEGIN
  SELECT assets.content_release_id, assets.asset_kind
    INTO asset_release, asset_kind
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = NEW.learning_asset_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'sequence asset');
  IF asset_kind NOT IN ('causal_sequence', 'temporal_sequence') THEN
    RAISE EXCEPTION 'Sequence asset has an incompatible Learning Asset kind' USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_audio_asset_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
  asset_kind sensa.asset_kind;
  asset_sense UUID;
  asset_lexeme UUID;
  example_release UUID;
  example_sense UUID;
  example_role sensa.example_role;
BEGIN
  SELECT assets.content_release_id,
         assets.asset_kind,
         assets.sense_version_id,
         assets.lexeme_version_id
    INTO asset_release, asset_kind, asset_sense, asset_lexeme
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = NEW.learning_asset_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'audio asset');
  IF asset_kind NOT IN ('pronunciation_audio', 'study_example_audio', 'extended_audio') THEN
    RAISE EXCEPTION 'Audio asset has an incompatible Learning Asset kind' USING ERRCODE = '23514';
  END IF;
  IF asset_kind = 'pronunciation_audio' THEN
    IF asset_lexeme IS NULL OR NEW.source_example_asset_id IS NOT NULL THEN
      RAISE EXCEPTION 'Pronunciation audio must belong to a Lexeme and have no source example'
        USING ERRCODE = '23514';
    END IF;
  ELSIF asset_sense IS NULL THEN
    RAISE EXCEPTION 'Sense-owned audio must belong to a Sense Version' USING ERRCODE = '23514';
  END IF;
  IF asset_kind = 'study_example_audio' THEN
    IF NEW.source_example_asset_id IS NULL THEN
      RAISE EXCEPTION 'Study Example Audio requires a source study Example' USING ERRCODE = '23514';
    END IF;
    SELECT ea.content_release_id, ea.sense_version_id, ea.role
      INTO example_release, example_sense, example_role
    FROM sensa.example_assets AS ea
    WHERE ea.learning_asset_id = NEW.source_example_asset_id;
    PERFORM sensa.assert_release_identity(NEW.content_release_id, example_release, 'study audio example');
    IF example_role <> 'study' OR example_sense IS DISTINCT FROM asset_sense THEN
      RAISE EXCEPTION 'Study Example Audio must reference a study Example' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_example_asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only Study Example Audio may reference an Example' USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_manifest_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  sense_release UUID;
  profile_release UUID;
  profile_sense UUID;
BEGIN
  SELECT content_release_id INTO sense_release
  FROM sensa.sense_versions WHERE sense_version_id = NEW.sense_version_id;
  SELECT content_release_id, sense_version_id INTO profile_release, profile_sense
  FROM sensa.acquisition_profiles WHERE acquisition_profile_id = NEW.acquisition_profile_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, sense_release, 'manifest sense');
  PERFORM sensa.assert_release_identity(NEW.content_release_id, profile_release, 'manifest profile');
  IF profile_sense IS DISTINCT FROM NEW.sense_version_id THEN
    RAISE EXCEPTION 'Manifest profile and Sense Version do not match' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  ELSE
    PERFORM sensa.assert_release_mutable(OLD.content_release_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_manifest_requirement_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  manifest_release UUID;
BEGIN
  SELECT content_release_id INTO manifest_release
  FROM sensa.required_asset_manifests
  WHERE required_asset_manifest_id = NEW.required_asset_manifest_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, manifest_release, 'manifest requirement');
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_manifest_match_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  requirement_release UUID;
  referenced_release UUID;
BEGIN
  SELECT content_release_id INTO requirement_release
  FROM sensa.manifest_requirements
  WHERE manifest_requirement_id = NEW.manifest_requirement_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, requirement_release, 'manifest match requirement');
  IF TG_TABLE_NAME = 'manifest_requirement_asset_matches' THEN
    SELECT content_release_id INTO referenced_release
    FROM sensa.learning_assets
    WHERE learning_asset_id = NEW.learning_asset_id;
  ELSE
    SELECT content_release_id INTO referenced_release
    FROM sensa.usage_patterns
    WHERE usage_pattern_id = NEW.usage_pattern_id;
  END IF;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, referenced_release, 'manifest match reference');
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sequence_step_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  asset_release UUID;
BEGIN
  SELECT content_release_id INTO asset_release
  FROM sensa.sequence_assets
  WHERE learning_asset_id = NEW.learning_asset_id;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, asset_release, 'sequence asset step');
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_text_parent_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  parent_release UUID;
BEGIN
  IF TG_TABLE_NAME = 'usage_pattern_slots' THEN
    SELECT content_release_id INTO parent_release FROM sensa.usage_patterns WHERE usage_pattern_id = NEW.usage_pattern_id;
  ELSIF TG_TABLE_NAME = 'profile_boundary_targets' THEN
    SELECT content_release_id INTO parent_release FROM sensa.acquisition_profiles WHERE acquisition_profile_id = NEW.acquisition_profile_id;
  ELSE
    RAISE EXCEPTION 'Unexpected Sensa parent table %', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_release_identity(NEW.content_release_id, parent_release, 'derived content row');
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_manifest_requirement_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  matched_count INTEGER;
BEGIN
  IF NEW.status = 'satisfied' THEN
    SELECT COUNT(*)::INTEGER INTO matched_count
    FROM (
      SELECT learning_asset_id AS referenced_id
      FROM sensa.manifest_requirement_asset_matches
      WHERE manifest_requirement_id = NEW.manifest_requirement_id
      UNION
      SELECT usage_pattern_id AS referenced_id
      FROM sensa.manifest_requirement_usage_pattern_matches
      WHERE manifest_requirement_id = NEW.manifest_requirement_id
    ) AS matches;
    IF matched_count < NEW.required_count OR NEW.satisfied_count < NEW.required_count THEN
      RAISE EXCEPTION 'Manifest requirement % cannot be marked satisfied before its matches satisfy the count',
        NEW.requirement_key USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_manifest_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NEW.status = 'satisfied' AND EXISTS (
    SELECT 1
    FROM sensa.manifest_requirements
    WHERE required_asset_manifest_id = NEW.required_asset_manifest_id
      AND status <> 'satisfied'
  ) THEN
    RAISE EXCEPTION 'Manifest % cannot be marked satisfied while a requirement is not satisfied',
      NEW.required_asset_manifest_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_release_publish_gate(p_content_release_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sensa.sense_versions
    WHERE content_release_id = p_content_release_id
  ) THEN
    RAISE EXCEPTION 'Sensa release % cannot be published without Sense Versions', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM sensa.content_releases
    WHERE content_release_id = p_content_release_id
      AND (validator_version IS NULL OR btrim(validator_version) = '')
  ) THEN
    RAISE EXCEPTION 'Sensa release % cannot be published without a validator version', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.sense_versions AS senses
    WHERE senses.content_release_id = p_content_release_id
      AND senses.review_status <> 'approved'
  ) THEN
    RAISE EXCEPTION 'Sensa release % contains a non-approved Sense Version', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.sense_relations AS relations
    WHERE relations.content_release_id = p_content_release_id
      AND relations.review_status <> 'approved'
  ) THEN
    RAISE EXCEPTION 'Sensa release % contains a non-approved Sense Relation', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.usage_patterns AS patterns
    WHERE patterns.content_release_id = p_content_release_id
      AND patterns.review_status <> 'approved'
  ) THEN
    RAISE EXCEPTION 'Sensa release % contains a non-approved Usage Pattern', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.acquisition_profiles AS profiles
    WHERE profiles.content_release_id = p_content_release_id
      AND profiles.review_status <> 'approved'
  ) THEN
    RAISE EXCEPTION 'Sensa release % contains a non-approved Acquisition Profile', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.learning_assets AS assets
    WHERE assets.content_release_id = p_content_release_id
      AND assets.review_status <> 'approved'
  ) THEN
    RAISE EXCEPTION 'Sensa release % contains a non-approved Learning Asset', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.required_asset_manifests AS manifests
    JOIN sensa.content_releases AS releases
      ON releases.content_release_id = manifests.content_release_id
    WHERE manifests.content_release_id = p_content_release_id
      AND manifests.validator_version IS DISTINCT FROM releases.validator_version
  ) THEN
    RAISE EXCEPTION 'Sensa release % contains a manifest from a stale validator version', p_content_release_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.sense_versions AS senses
    WHERE senses.content_release_id = p_content_release_id
      AND NOT EXISTS (
        SELECT 1
        FROM sensa.required_asset_manifests AS manifests
        JOIN sensa.acquisition_profiles AS profiles
          ON profiles.acquisition_profile_id = manifests.acquisition_profile_id
        WHERE manifests.content_release_id = p_content_release_id
          AND manifests.sense_version_id = senses.sense_version_id
          AND profiles.sense_version_id = senses.sense_version_id
          AND profiles.review_status = 'approved'
          AND manifests.status = 'satisfied'
          AND manifests.validator_version = (
            SELECT releases.validator_version
            FROM sensa.content_releases AS releases
            WHERE releases.content_release_id = p_content_release_id
          )
          AND EXISTS (
            SELECT 1
            FROM sensa.manifest_requirements AS requirements
            WHERE requirements.required_asset_manifest_id = manifests.required_asset_manifest_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM sensa.manifest_requirements AS requirements
            WHERE requirements.required_asset_manifest_id = manifests.required_asset_manifest_id
              AND (
                requirements.status <> 'satisfied'
                OR requirements.satisfied_count < requirements.required_count
                OR requirements.satisfied_count <> (
                  SELECT COUNT(*)::INTEGER
                  FROM (
                    SELECT matches.learning_asset_id AS matched_id
                    FROM sensa.manifest_requirement_asset_matches AS matches
                    WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                    UNION
                    SELECT matches.usage_pattern_id AS matched_id
                    FROM sensa.manifest_requirement_usage_pattern_matches AS matches
                    WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                  ) AS actual_matches
                )
              )
          )
      )
  ) THEN
    RAISE EXCEPTION 'Sensa release % contains a Sense Version without a satisfied approved manifest', p_content_release_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_stable_identity_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_TABLE_NAME = 'lexemes' AND EXISTS (
    SELECT 1
    FROM sensa.lexeme_versions AS versions
    WHERE versions.lexeme_id = OLD.lexeme_id
      AND sensa.release_status(versions.content_release_id) IN ('published', 'superseded')
  ) THEN
    RAISE EXCEPTION 'Lexeme identities referenced by published Sensa releases are immutable'
      USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'senses' AND EXISTS (
    SELECT 1
    FROM sensa.sense_versions AS versions
    WHERE versions.sense_id = OLD.sense_id
      AND sensa.release_status(versions.content_release_id) IN ('published', 'superseded')
  ) THEN
    RAISE EXCEPTION 'Sense identities referenced by published Sensa releases are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_content_release_publish()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    PERFORM sensa.assert_release_publish_gate(NEW.content_release_id);
    NEW.published_at := COALESCE(NEW.published_at, now());
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    PERFORM sensa.assert_release_publish_gate(NEW.content_release_id);
    NEW.published_at := COALESCE(NEW.published_at, now());
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'superseded' AND OLD.status = 'published' THEN
    NEW.superseded_at := COALESCE(NEW.superseded_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER content_releases_transition_guard
BEFORE UPDATE OR DELETE ON sensa.content_releases
FOR EACH ROW EXECUTE FUNCTION sensa.guard_content_release_transition();

CREATE TRIGGER content_releases_publish_gate
BEFORE INSERT OR UPDATE ON sensa.content_releases
FOR EACH ROW EXECUTE FUNCTION sensa.guard_content_release_publish();

CREATE TRIGGER lexemes_stable_identity_guard
BEFORE UPDATE OR DELETE ON sensa.lexemes
FOR EACH ROW EXECUTE FUNCTION sensa.guard_stable_identity_mutation();

CREATE TRIGGER senses_stable_identity_guard
BEFORE UPDATE OR DELETE ON sensa.senses
FOR EACH ROW EXECUTE FUNCTION sensa.guard_stable_identity_mutation();

CREATE TRIGGER lexeme_versions_identity_guard
BEFORE INSERT OR UPDATE ON sensa.lexeme_versions
FOR EACH ROW EXECUTE FUNCTION sensa.assert_lexeme_version_identity();

CREATE TRIGGER sense_versions_identity_guard
BEFORE INSERT OR UPDATE ON sensa.sense_versions
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sense_version_identity();

CREATE TRIGGER sense_relations_identity_guard
BEFORE INSERT OR UPDATE ON sensa.sense_relations
FOR EACH ROW EXECUTE FUNCTION sensa.assert_relation_identity();

CREATE TRIGGER usage_patterns_identity_guard
BEFORE INSERT OR UPDATE ON sensa.usage_patterns
FOR EACH ROW EXECUTE FUNCTION sensa.assert_usage_pattern_identity();

CREATE TRIGGER acquisition_profiles_identity_guard
BEFORE INSERT OR UPDATE ON sensa.acquisition_profiles
FOR EACH ROW EXECUTE FUNCTION sensa.assert_profile_identity();

CREATE TRIGGER learning_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.learning_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_learning_asset_identity();

CREATE TRIGGER example_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.example_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_example_asset_identity();

CREATE TRIGGER contrast_case_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.contrast_case_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_relation_asset_identity();

CREATE TRIGGER visual_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.visual_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_visual_asset_identity();

CREATE TRIGGER diagram_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.diagram_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_diagram_asset_identity();

CREATE TRIGGER sequence_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.sequence_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sequence_asset_identity();

CREATE TRIGGER audio_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.audio_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_audio_asset_identity();

CREATE TRIGGER text_assets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.text_assets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_text_asset_identity();

CREATE TRIGGER usage_pattern_slots_identity_guard
BEFORE INSERT OR UPDATE ON sensa.usage_pattern_slots
FOR EACH ROW EXECUTE FUNCTION sensa.assert_text_parent_release();

CREATE TRIGGER profile_boundary_targets_identity_guard
BEFORE INSERT OR UPDATE ON sensa.profile_boundary_targets
FOR EACH ROW EXECUTE FUNCTION sensa.assert_profile_boundary_identity();

CREATE TRIGGER sequence_asset_steps_identity_guard
BEFORE INSERT OR UPDATE ON sensa.sequence_asset_steps
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sequence_step_identity();

CREATE TRIGGER required_asset_manifests_identity_guard
BEFORE INSERT OR UPDATE ON sensa.required_asset_manifests
FOR EACH ROW EXECUTE FUNCTION sensa.assert_manifest_identity();

CREATE TRIGGER manifest_requirements_identity_guard
BEFORE INSERT OR UPDATE ON sensa.manifest_requirements
FOR EACH ROW EXECUTE FUNCTION sensa.assert_manifest_requirement_identity();

CREATE TRIGGER manifest_requirements_status_guard
BEFORE INSERT OR UPDATE ON sensa.manifest_requirements
FOR EACH ROW EXECUTE FUNCTION sensa.assert_manifest_requirement_status();

CREATE TRIGGER manifest_requirement_asset_matches_identity_guard
BEFORE INSERT OR UPDATE ON sensa.manifest_requirement_asset_matches
FOR EACH ROW EXECUTE FUNCTION sensa.assert_manifest_match_identity();

CREATE TRIGGER manifest_requirement_usage_pattern_matches_identity_guard
BEFORE INSERT OR UPDATE ON sensa.manifest_requirement_usage_pattern_matches
FOR EACH ROW EXECUTE FUNCTION sensa.assert_manifest_match_identity();

CREATE TRIGGER required_asset_manifests_status_guard
BEFORE INSERT OR UPDATE ON sensa.required_asset_manifests
FOR EACH ROW EXECUTE FUNCTION sensa.assert_manifest_status();

CREATE OR REPLACE FUNCTION sensa.suppress_published_child_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sensa.assert_release_mutable(OLD.content_release_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    PERFORM sensa.assert_release_mutable(OLD.content_release_id);
  END IF;
  PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  RETURN NEW;
END;
$$;

-- A dedicated trigger is attached to every table with a denormalized release id.
-- The identity triggers above also perform this check for rows whose owner needs
-- cross-table validation. This trigger covers direct child updates/deletes.
CREATE TRIGGER lexeme_versions_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.lexeme_versions
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER sense_versions_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sense_versions
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER sense_relations_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sense_relations
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER usage_patterns_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.usage_patterns
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER usage_pattern_slots_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.usage_pattern_slots
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER acquisition_profiles_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.acquisition_profiles
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER profile_boundary_targets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.profile_boundary_targets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER learning_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learning_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER text_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.text_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER example_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.example_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER contrast_case_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.contrast_case_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER visual_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.visual_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER diagram_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.diagram_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER sequence_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sequence_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER sequence_asset_steps_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sequence_asset_steps
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER audio_assets_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.audio_assets
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER required_asset_manifests_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.required_asset_manifests
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER manifest_requirements_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.manifest_requirements
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER manifest_requirement_asset_matches_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.manifest_requirement_asset_matches
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE TRIGGER manifest_usage_pattern_matches_release_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.manifest_requirement_usage_pattern_matches
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_child_mutation();

CREATE OR REPLACE FUNCTION sensa.assert_release_status_policy(p_content_release_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
  SELECT sensa.release_status(p_content_release_id) IN ('published', 'superseded');
$$;

COMMENT ON FUNCTION sensa.assert_release_status_policy(UUID) IS
  'Backend content reads include published and superseded releases; HTTP catalog policy decides which versions to list.';

REVOKE ALL ON SCHEMA sensa FROM PUBLIC, backend_app;
GRANT USAGE ON SCHEMA sensa TO backend_app;

ALTER TABLE sensa.content_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.lexemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.lexeme_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.senses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.usage_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.usage_pattern_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.acquisition_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.profile_boundary_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.text_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.example_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.contrast_case_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.visual_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.diagram_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sequence_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sequence_asset_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.audio_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.required_asset_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.manifest_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.manifest_requirement_asset_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.manifest_requirement_usage_pattern_matches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA sensa FROM PUBLIC, backend_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sensa FROM PUBLIC, backend_app;

GRANT SELECT ON TABLE
  sensa.content_releases,
  sensa.lexemes,
  sensa.lexeme_versions,
  sensa.senses,
  sensa.sense_versions,
  sensa.sense_relations,
  sensa.usage_patterns,
  sensa.usage_pattern_slots,
  sensa.acquisition_profiles,
  sensa.profile_boundary_targets,
  sensa.learning_assets,
  sensa.text_assets,
  sensa.example_assets,
  sensa.contrast_case_assets,
  sensa.visual_assets,
  sensa.diagram_assets,
  sensa.sequence_assets,
  sensa.sequence_asset_steps,
  sensa.audio_assets,
  sensa.required_asset_manifests,
  sensa.manifest_requirements,
  sensa.manifest_requirement_asset_matches,
  sensa.manifest_requirement_usage_pattern_matches
TO backend_app;

GRANT EXECUTE ON FUNCTION sensa.release_status(UUID) TO backend_app;
GRANT EXECUTE ON FUNCTION sensa.assert_release_status_policy(UUID) TO backend_app;

CREATE POLICY content_releases_backend_published_select
  ON sensa.content_releases FOR SELECT TO backend_app
  USING (status IN ('published', 'superseded'));

CREATE POLICY lexemes_backend_published_select
  ON sensa.lexemes FOR SELECT TO backend_app
  USING (EXISTS (
    SELECT 1 FROM sensa.lexeme_versions AS versions
    WHERE versions.lexeme_id = lexemes.lexeme_id
      AND sensa.assert_release_status_policy(versions.content_release_id)
  ));

CREATE POLICY lexeme_versions_backend_published_select
  ON sensa.lexeme_versions FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY senses_backend_published_select
  ON sensa.senses FOR SELECT TO backend_app
  USING (EXISTS (
    SELECT 1 FROM sensa.sense_versions AS versions
    WHERE versions.sense_id = senses.sense_id
      AND sensa.assert_release_status_policy(versions.content_release_id)
  ));

CREATE POLICY sense_versions_backend_published_select
  ON sensa.sense_versions FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY sense_relations_backend_published_select
  ON sensa.sense_relations FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY usage_patterns_backend_published_select
  ON sensa.usage_patterns FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY usage_pattern_slots_backend_published_select
  ON sensa.usage_pattern_slots FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY acquisition_profiles_backend_published_select
  ON sensa.acquisition_profiles FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY profile_boundary_targets_backend_published_select
  ON sensa.profile_boundary_targets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY learning_assets_backend_published_select
  ON sensa.learning_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY text_assets_backend_published_select
  ON sensa.text_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY example_assets_backend_published_select
  ON sensa.example_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY contrast_case_assets_backend_published_select
  ON sensa.contrast_case_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY visual_assets_backend_published_select
  ON sensa.visual_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY diagram_assets_backend_published_select
  ON sensa.diagram_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY sequence_assets_backend_published_select
  ON sensa.sequence_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY sequence_asset_steps_backend_published_select
  ON sensa.sequence_asset_steps FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY audio_assets_backend_published_select
  ON sensa.audio_assets FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY required_asset_manifests_backend_published_select
  ON sensa.required_asset_manifests FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY manifest_requirements_backend_published_select
  ON sensa.manifest_requirements FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY manifest_requirement_asset_matches_backend_published_select
  ON sensa.manifest_requirement_asset_matches FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));

CREATE POLICY manifest_usage_pattern_matches_backend_published_select
  ON sensa.manifest_requirement_usage_pattern_matches FOR SELECT TO backend_app
  USING (sensa.assert_release_status_policy(content_release_id));
-- Schemas touched/read explicitly: sensa, org, security, sync, pg_catalog, public.
-- Migration status: Current / additive.
-- Introduces: immutable ordered Sensa Books and learner-scoped Study Plans.

DO $$
BEGIN
  CREATE TYPE sensa.book_version_status AS ENUM (
    'draft',
    'published',
    'retired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.study_plan_status AS ENUM (
    'active',
    'paused',
    'completed',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS sensa.books (
  book_id UUID PRIMARY KEY,
  book_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT books_key_nonempty CHECK (book_key = btrim(book_key) AND btrim(book_key) <> '')
);

CREATE TABLE IF NOT EXISTS sensa.book_versions (
  book_version_id UUID PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES sensa.books(book_id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE RESTRICT,
  target_language TEXT NOT NULL,
  learner_locale TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status sensa.book_version_status NOT NULL DEFAULT 'draft',
  manifest_digest TEXT NOT NULL,
  sense_count INTEGER NOT NULL DEFAULT 0,
  lexeme_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  CONSTRAINT book_versions_book_version_unique UNIQUE (book_id, version_number),
  CONSTRAINT book_versions_version_positive CHECK (version_number > 0),
  CONSTRAINT book_versions_target_language_nonempty CHECK (btrim(target_language) <> ''),
  CONSTRAINT book_versions_learner_locale_nonempty CHECK (btrim(learner_locale) <> ''),
  CONSTRAINT book_versions_title_nonempty CHECK (btrim(title) <> ''),
  CONSTRAINT book_versions_description_nonnull CHECK (description IS NOT NULL),
  CONSTRAINT book_versions_manifest_digest_sha256 CHECK (
    manifest_digest ~ '^[0-9a-f]{64}$' AND manifest_digest = lower(manifest_digest)
  ),
  CONSTRAINT book_versions_counts_nonnegative CHECK (sense_count >= 0 AND lexeme_count >= 0),
  CONSTRAINT book_versions_lifecycle_timestamps CHECK (
    (
      status = 'draft'
      AND published_at IS NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'published'
      AND published_at IS NOT NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'retired'
      AND published_at IS NOT NULL
      AND retired_at IS NOT NULL
      AND retired_at >= published_at
    )
  ),
  CONSTRAINT book_versions_timestamp_order CHECK (
    created_at <= COALESCE(published_at, created_at)
    AND COALESCE(published_at, created_at) <= COALESCE(retired_at, COALESCE(published_at, created_at))
  ),
  CONSTRAINT book_versions_manifest_digest_unique UNIQUE (manifest_digest)
);

CREATE TABLE IF NOT EXISTS sensa.book_version_senses (
  book_version_id UUID NOT NULL REFERENCES sensa.book_versions(book_version_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_version_id, ordinal),
  CONSTRAINT book_version_senses_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT book_version_senses_sense_unique UNIQUE (book_version_id, sense_version_id)
);

CREATE TABLE IF NOT EXISTS sensa.study_plans (
  study_plan_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  book_version_id UUID NOT NULL REFERENCES sensa.book_versions(book_version_id) ON DELETE RESTRICT,
  status sensa.study_plan_status NOT NULL DEFAULT 'active',
  daily_new_sense_target SMALLINT NOT NULL DEFAULT 10,
  revision BIGINT NOT NULL DEFAULT 1,
  created_by_replica_id UUID NOT NULL REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  CONSTRAINT study_plans_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT study_plans_daily_target_range CHECK (daily_new_sense_target BETWEEN 1 AND 100),
  CONSTRAINT study_plans_revision_positive CHECK (revision > 0),
  CONSTRAINT study_plans_timestamp_order CHECK (
    created_at <= updated_at
    AND created_at <= activated_at
    AND (paused_at IS NULL OR activated_at <= paused_at)
    AND (completed_at IS NULL OR activated_at <= completed_at)
    AND (archived_at IS NULL OR activated_at <= archived_at)
  ),
  CONSTRAINT study_plans_status_timestamp_shape CHECK (
    (
      status = 'active'
      AND paused_at IS NULL
      AND completed_at IS NULL
      AND archived_at IS NULL
    )
    OR (
      status = 'paused'
      AND paused_at IS NOT NULL
      AND completed_at IS NULL
      AND archived_at IS NULL
    )
    OR (
      status = 'completed'
      AND paused_at IS NULL
      AND completed_at IS NOT NULL
      AND archived_at IS NULL
    )
    OR (
      status = 'archived'
      AND paused_at IS NULL
      AND archived_at IS NOT NULL
      AND (completed_at IS NULL OR completed_at <= archived_at)
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sensa_study_plans_one_active_per_learner
  ON sensa.study_plans(workspace_id, learner_user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS sensa_book_versions_catalog_status_idx
  ON sensa.book_versions(status, book_id, version_number);

CREATE INDEX IF NOT EXISTS sensa_book_version_senses_order_idx
  ON sensa.book_version_senses(book_version_id, ordinal);

CREATE INDEX IF NOT EXISTS sensa_study_plans_learner_status_idx
  ON sensa.study_plans(workspace_id, learner_user_id, status, updated_at DESC);

-- Fixed v1 Book manifest digest. The UTF-8 payload is exactly:
--   sensa-book-manifest-v1\n
--   book_version_id\n
--   content_release_id\n
--   ordinal:sense_version_id rows joined by \n in ordinal order.
CREATE OR REPLACE FUNCTION sensa.book_manifest_digest(p_book_version_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_content_release_id UUID;
  v_ordered_members TEXT;
  v_payload TEXT;
BEGIN
  SELECT versions.content_release_id
    INTO v_content_release_id
  FROM sensa.book_versions AS versions
  WHERE versions.book_version_id = p_book_version_id;

  IF v_content_release_id IS NULL THEN
    RAISE EXCEPTION 'Sensa Book Version % does not exist', p_book_version_id
      USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(
    string_agg(
      members.ordinal::TEXT || ':' || members.sense_version_id::TEXT,
      E'\n' ORDER BY members.ordinal
    ),
    ''
  )
    INTO v_ordered_members
  FROM sensa.book_version_senses AS members
  WHERE members.book_version_id = p_book_version_id;

  v_payload := 'sensa-book-manifest-v1'
    || E'\n' || p_book_version_id::TEXT
    || E'\n' || v_content_release_id::TEXT
    || E'\n' || v_ordered_members;

  RETURN encode(public.digest(convert_to(v_payload, 'UTF8'), 'sha256'), 'hex');
END;
$$;

COMMENT ON FUNCTION sensa.book_manifest_digest(UUID) IS
  'sensa-book-manifest-v1: lowercase SHA-256 over UTF-8 version, Book Version id, Content Release id, and ordered ordinal:sense_version_id rows.';

CREATE OR REPLACE FUNCTION sensa.book_member_manifest_satisfied(
  p_book_version_id UUID,
  p_sense_version_id UUID,
  p_content_release_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM sensa.required_asset_manifests AS manifests
    JOIN sensa.acquisition_profiles AS profiles
      ON profiles.acquisition_profile_id = manifests.acquisition_profile_id
    WHERE manifests.content_release_id = p_content_release_id
      AND manifests.sense_version_id = p_sense_version_id
      AND manifests.validator_version = (
        SELECT releases.validator_version
        FROM sensa.content_releases AS releases
        WHERE releases.content_release_id = p_content_release_id
      )
      AND manifests.status = 'satisfied'
      AND profiles.content_release_id = p_content_release_id
      AND profiles.sense_version_id = p_sense_version_id
      AND profiles.review_status = 'approved'
      AND EXISTS (
        SELECT 1
        FROM sensa.manifest_requirements AS requirements
        WHERE requirements.required_asset_manifest_id = manifests.required_asset_manifest_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM sensa.manifest_requirements AS requirements
        WHERE requirements.required_asset_manifest_id = manifests.required_asset_manifest_id
          AND (
            requirements.content_release_id IS DISTINCT FROM p_content_release_id
            OR requirements.status <> 'satisfied'
            OR requirements.satisfied_count < requirements.required_count
            OR requirements.satisfied_count <> (
              SELECT COUNT(*)::INTEGER
              FROM (
                SELECT matches.learning_asset_id AS matched_id
                FROM sensa.manifest_requirement_asset_matches AS matches
                WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                  AND matches.content_release_id = p_content_release_id
                UNION ALL
                SELECT matches.usage_pattern_id AS matched_id
                FROM sensa.manifest_requirement_usage_pattern_matches AS matches
                WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                  AND matches.content_release_id = p_content_release_id
              ) AS actual_matches
            )
            OR EXISTS (
              SELECT 1
              FROM sensa.manifest_requirement_asset_matches AS matches
              JOIN sensa.learning_assets AS assets
                ON assets.learning_asset_id = matches.learning_asset_id
              WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                AND (
                  matches.content_release_id IS DISTINCT FROM p_content_release_id
                  OR assets.content_release_id IS DISTINCT FROM p_content_release_id
                  OR assets.review_status <> 'approved'
                  OR (
                    assets.asset_kind = 'pronunciation_audio'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM sensa.lexeme_versions AS lexeme_versions
                      JOIN sensa.sense_versions AS member_senses
                        ON member_senses.sense_version_id = p_sense_version_id
                      JOIN sensa.senses AS stable_senses
                        ON stable_senses.sense_id = member_senses.sense_id
                      WHERE lexeme_versions.lexeme_version_id = assets.lexeme_version_id
                        AND lexeme_versions.content_release_id = p_content_release_id
                        AND lexeme_versions.lexeme_id = stable_senses.lexeme_id
                    )
                  )
                  OR (
                    assets.asset_kind <> 'pronunciation_audio'
                    AND assets.sense_version_id IS DISTINCT FROM p_sense_version_id
                  )
                )
            )
            OR EXISTS (
              SELECT 1
              FROM sensa.manifest_requirement_usage_pattern_matches AS matches
              JOIN sensa.usage_patterns AS patterns
                ON patterns.usage_pattern_id = matches.usage_pattern_id
              WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                AND (
                  matches.content_release_id IS DISTINCT FROM p_content_release_id
                  OR patterns.content_release_id IS DISTINCT FROM p_content_release_id
                  OR patterns.sense_version_id IS DISTINCT FROM p_sense_version_id
                  OR patterns.review_status <> 'approved'
                )
            )
          )
      )
  );
$$;

DROP FUNCTION IF EXISTS sensa.assert_book_publish_gate(UUID);

CREATE OR REPLACE FUNCTION sensa.assert_book_publish_gate(
  p_book_version_id UUID,
  p_content_release_id UUID,
  p_target_language TEXT,
  p_learner_locale TEXT,
  p_manifest_digest TEXT,
  p_sense_count INTEGER,
  p_lexeme_count INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_existing_content_release_id UUID;
  v_release_status sensa.content_release_status;
  v_release_target_language TEXT;
  v_release_learner_locale TEXT;
  v_member_count INTEGER;
  v_min_ordinal INTEGER;
  v_max_ordinal INTEGER;
  v_sense_count INTEGER;
  v_lexeme_count INTEGER;
  v_manifest_digest TEXT;
BEGIN
  SELECT versions.content_release_id
    INTO v_existing_content_release_id
  FROM sensa.book_versions AS versions
  WHERE versions.book_version_id = p_book_version_id;

  IF v_existing_content_release_id IS NULL THEN
    RAISE EXCEPTION 'Sensa Book Version % does not exist', p_book_version_id
      USING ERRCODE = '23503';
  END IF;

  IF v_existing_content_release_id IS DISTINCT FROM p_content_release_id THEN
    RAISE EXCEPTION 'Book Version % Content Release identity is immutable', p_book_version_id
      USING ERRCODE = '23514';
  END IF;

  SELECT releases.status,
         releases.target_language,
         releases.learner_locale
    INTO v_release_status,
         v_release_target_language,
         v_release_learner_locale
  FROM sensa.content_releases AS releases
  WHERE releases.content_release_id = p_content_release_id;

  IF v_release_status <> 'published' THEN
    RAISE EXCEPTION 'Book Version % requires a published Content Release', p_book_version_id
      USING ERRCODE = '23514';
  END IF;
  IF p_target_language IS DISTINCT FROM v_release_target_language
    OR p_learner_locale IS DISTINCT FROM v_release_learner_locale THEN
    RAISE EXCEPTION 'Book Version % language or learner locale does not match its Content Release', p_book_version_id
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER, MIN(members.ordinal), MAX(members.ordinal)
    INTO v_member_count, v_min_ordinal, v_max_ordinal
  FROM sensa.book_version_senses AS members
  WHERE members.book_version_id = p_book_version_id;

  IF v_member_count = 0 THEN
    RAISE EXCEPTION 'Book Version % cannot publish without members', p_book_version_id
      USING ERRCODE = '23514';
  END IF;
  IF v_min_ordinal <> 1 OR v_max_ordinal <> v_member_count THEN
    RAISE EXCEPTION 'Book Version % member ordinals must be contiguous from 1', p_book_version_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.book_version_senses AS members
    LEFT JOIN sensa.sense_versions AS senses
      ON senses.sense_version_id = members.sense_version_id
    WHERE members.book_version_id = p_book_version_id
      AND (
        senses.sense_version_id IS NULL
        OR senses.content_release_id IS DISTINCT FROM p_content_release_id
        OR senses.review_status <> 'approved'
      )
  ) THEN
    RAISE EXCEPTION 'Book Version % contains a missing, cross-release, or non-approved Sense Version', p_book_version_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sensa.book_version_senses AS members
    WHERE members.book_version_id = p_book_version_id
      AND NOT sensa.book_member_manifest_satisfied(
        p_book_version_id,
        members.sense_version_id,
        p_content_release_id
      )
  ) THEN
    RAISE EXCEPTION 'Book Version % contains a Sense without a current satisfied Manifest', p_book_version_id
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER,
         COUNT(DISTINCT lexemes.lexeme_id)::INTEGER
    INTO v_sense_count, v_lexeme_count
  FROM sensa.book_version_senses AS members
  JOIN sensa.sense_versions AS senses
    ON senses.sense_version_id = members.sense_version_id
  JOIN sensa.senses AS stable_senses
    ON stable_senses.sense_id = senses.sense_id
  JOIN sensa.lexemes AS lexemes
    ON lexemes.lexeme_id = stable_senses.lexeme_id
  WHERE members.book_version_id = p_book_version_id;

  IF v_sense_count <> p_sense_count
    OR v_lexeme_count <> p_lexeme_count THEN
    RAISE EXCEPTION 'Book Version % stored Sense/Lexeme counts do not match membership', p_book_version_id
      USING ERRCODE = '23514';
  END IF;

  v_manifest_digest := sensa.book_manifest_digest(p_book_version_id);
  IF v_manifest_digest <> p_manifest_digest THEN
    RAISE EXCEPTION 'Book Version % manifest digest does not match ordered membership', p_book_version_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_book_member_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_book_release UUID;
  v_book_status sensa.book_version_status;
  v_sense_release UUID;
BEGIN
  SELECT versions.content_release_id, versions.status
    INTO v_book_release, v_book_status
  FROM sensa.book_versions AS versions
  WHERE versions.book_version_id = NEW.book_version_id;
  IF v_book_release IS NULL THEN
    RAISE EXCEPTION 'Book Version % does not exist', NEW.book_version_id
      USING ERRCODE = '23503';
  END IF;
  IF v_book_status IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published or retired Book Version membership is immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT senses.content_release_id
    INTO v_sense_release
  FROM sensa.sense_versions AS senses
  WHERE senses.sense_version_id = NEW.sense_version_id;
  IF v_sense_release IS NULL THEN
    RAISE EXCEPTION 'Sense Version % does not exist', NEW.sense_version_id
      USING ERRCODE = '23503';
  END IF;
  IF v_sense_release IS DISTINCT FROM v_book_release THEN
    RAISE EXCEPTION 'Book membership crosses Content Releases'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.suppress_published_book_member_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (SELECT versions.status FROM sensa.book_versions AS versions WHERE versions.book_version_id = OLD.book_version_id)
      IN ('published', 'retired') THEN
      RAISE EXCEPTION 'Published or retired Book Version membership cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (SELECT versions.status FROM sensa.book_versions AS versions WHERE versions.book_version_id = OLD.book_version_id)
      IN ('published', 'retired') THEN
      RAISE EXCEPTION 'Published or retired Book Version membership cannot be moved or updated'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (SELECT versions.status FROM sensa.book_versions AS versions WHERE versions.book_version_id = NEW.book_version_id)
    IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published or retired Book Version membership cannot be inserted or moved into'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_book_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sensa Book stable identities cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.book_id IS DISTINCT FROM OLD.book_id
    OR NEW.book_key IS DISTINCT FROM OLD.book_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sensa Book stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_book_version_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Book Versions must be created in draft status'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'retired') THEN
      RAISE EXCEPTION 'Published or retired Book Versions cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.book_version_id IS DISTINCT FROM OLD.book_version_id
    OR NEW.book_id IS DISTINCT FROM OLD.book_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.content_release_id IS DISTINCT FROM OLD.content_release_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Book Version stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Invalid Book Version transition draft -> %', NEW.status
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'published' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'Published Book Versions may only transition to retired'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'Retired Book Versions are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    PERFORM sensa.assert_book_publish_gate(
      NEW.book_version_id,
      NEW.content_release_id,
      NEW.target_language,
      NEW.learner_locale,
      NEW.manifest_digest,
      NEW.sense_count,
      NEW.lexeme_count
    );
    NEW.published_at := COALESCE(NEW.published_at, statement_timestamp());
    NEW.retired_at := NULL;
  ELSIF OLD.status = 'published' AND NEW.status = 'retired' THEN
    IF NEW.book_version_id IS DISTINCT FROM OLD.book_version_id
      OR NEW.book_id IS DISTINCT FROM OLD.book_id
      OR NEW.version_number IS DISTINCT FROM OLD.version_number
      OR NEW.content_release_id IS DISTINCT FROM OLD.content_release_id
      OR NEW.target_language IS DISTINCT FROM OLD.target_language
      OR NEW.learner_locale IS DISTINCT FROM OLD.learner_locale
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.manifest_digest IS DISTINCT FROM OLD.manifest_digest
      OR NEW.sense_count IS DISTINCT FROM OLD.sense_count
      OR NEW.lexeme_count IS DISTINCT FROM OLD.lexeme_count
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'Published Book Version metadata is immutable'
        USING ERRCODE = '23514';
    END IF;
    NEW.retired_at := COALESCE(NEW.retired_at, statement_timestamp());
  ELSIF OLD.status IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published or retired Book Version metadata is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_study_plan_replica_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_replica_workspace UUID;
  v_replica_user TEXT;
BEGIN
  SELECT replicas.workspace_id, replicas.user_id
    INTO v_replica_workspace, v_replica_user
  FROM sync.workspace_replicas AS replicas
  WHERE replicas.replica_id = NEW.created_by_replica_id;
  IF v_replica_workspace IS NULL THEN
    RAISE EXCEPTION 'Study Plan replica % does not exist', NEW.created_by_replica_id
      USING ERRCODE = '23503';
  END IF;
  IF v_replica_workspace IS DISTINCT FROM NEW.workspace_id
    OR v_replica_user IS DISTINCT FROM NEW.learner_user_id THEN
    RAISE EXCEPTION 'Study Plan replica workspace and learner must match the Plan'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_study_plan_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_book_status sensa.book_version_status;
  v_now TIMESTAMPTZ := statement_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT versions.status INTO v_book_status
    FROM sensa.book_versions AS versions
    WHERE versions.book_version_id = NEW.book_version_id;
    IF v_book_status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'Study Plans may only pin published Book Versions'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'Study Plans must be created active'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Study Plans must start at revision 1'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := COALESCE(NEW.updated_at, v_now);
    NEW.activated_at := COALESCE(NEW.activated_at, v_now);
    NEW.paused_at := NULL;
    NEW.completed_at := NULL;
    NEW.archived_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Account/Workspace cleanup reaches this row through FK CASCADE.  The
    -- product Interface remains archive-only because backend_app has no
    -- DELETE privilege; owner-level cleanup is intentionally allowed here.
    RETURN OLD;
  END IF;

  IF NEW.study_plan_id IS DISTINCT FROM OLD.study_plan_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.book_version_id IS DISTINCT FROM OLD.book_version_id
    OR NEW.created_by_replica_id IS DISTINCT FROM OLD.created_by_replica_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'Study Plan stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'Archived Study Plans are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'completed'
    AND NEW.status = 'completed'
    AND NEW.daily_new_sense_target IS DISTINCT FROM OLD.daily_new_sense_target THEN
    RAISE EXCEPTION 'Completed Study Plans cannot change their daily target'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'paused', 'completed', 'archived') THEN
    RAISE EXCEPTION 'Invalid Study Plan transition active -> %', NEW.status USING ERRCODE = '23514';
  ELSIF OLD.status = 'paused' AND NEW.status NOT IN ('paused', 'active', 'completed', 'archived') THEN
    RAISE EXCEPTION 'Invalid Study Plan transition paused -> %', NEW.status USING ERRCODE = '23514';
  ELSIF OLD.status = 'completed' AND NEW.status NOT IN ('completed', 'archived') THEN
    RAISE EXCEPTION 'Invalid Study Plan transition completed -> %', NEW.status USING ERRCODE = '23514';
  ELSIF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    RAISE EXCEPTION 'Archived Study Plans are immutable' USING ERRCODE = '23514';
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := v_now;

  IF NEW.status = OLD.status THEN
    NEW.paused_at := OLD.paused_at;
    NEW.completed_at := OLD.completed_at;
    NEW.archived_at := OLD.archived_at;
  ELSIF NEW.status = 'active' THEN
    NEW.paused_at := NULL;
    NEW.completed_at := NULL;
    NEW.archived_at := NULL;
  ELSIF NEW.status = 'paused' THEN
    NEW.paused_at := v_now;
    NEW.completed_at := NULL;
    NEW.archived_at := NULL;
  ELSIF NEW.status = 'completed' THEN
    NEW.paused_at := NULL;
    NEW.completed_at := v_now;
    NEW.archived_at := NULL;
  ELSIF NEW.status = 'archived' THEN
    NEW.paused_at := NULL;
    NEW.archived_at := v_now;
    IF OLD.status <> 'completed' THEN
      NEW.completed_at := NULL;
    ELSE
      NEW.completed_at := OLD.completed_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sensa_books_stable_identity_guard
BEFORE UPDATE OR DELETE ON sensa.books
FOR EACH ROW EXECUTE FUNCTION sensa.guard_book_identity();

CREATE TRIGGER sensa_book_versions_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.book_versions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_book_version_lifecycle();

CREATE TRIGGER sensa_book_version_senses_identity_guard
BEFORE INSERT OR UPDATE ON sensa.book_version_senses
FOR EACH ROW EXECUTE FUNCTION sensa.assert_book_member_identity();

CREATE TRIGGER sensa_book_version_senses_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.book_version_senses
FOR EACH ROW EXECUTE FUNCTION sensa.suppress_published_book_member_mutation();

CREATE TRIGGER sensa_study_plans_replica_identity_guard
BEFORE INSERT OR UPDATE ON sensa.study_plans
FOR EACH ROW EXECUTE FUNCTION sensa.assert_study_plan_replica_identity();

CREATE TRIGGER sensa_study_plans_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.study_plans
FOR EACH ROW EXECUTE FUNCTION sensa.guard_study_plan_lifecycle();

COMMENT ON TABLE sensa.books IS
  'Stable Book identities. Public metadata and ordered members live on immutable Book Versions.';
COMMENT ON TABLE sensa.book_versions IS
  'Immutable ordered curriculum versions. Published and retired versions remain readable; only published versions are selectable for new Study Plans.';
COMMENT ON TABLE sensa.book_version_senses IS
  'Ordered Sense Version membership. Membership is immutable after Book Version publication.';
COMMENT ON TABLE sensa.study_plans IS
  'Learner and workspace scoped mutable pins to published Book Versions. Archive instead of hard delete.';

REVOKE ALL ON SCHEMA sensa FROM PUBLIC, backend_app;
GRANT USAGE ON SCHEMA sensa TO backend_app;

ALTER TABLE sensa.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.book_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.book_version_senses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.study_plans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  sensa.books,
  sensa.book_versions,
  sensa.book_version_senses,
  sensa.study_plans
FROM PUBLIC, backend_app;

GRANT SELECT ON TABLE
  sensa.books,
  sensa.book_versions,
  sensa.book_version_senses
TO backend_app;

GRANT SELECT, INSERT, UPDATE ON TABLE sensa.study_plans TO backend_app;

REVOKE ALL ON FUNCTION sensa.book_manifest_digest(UUID) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.book_member_manifest_satisfied(UUID, UUID, UUID) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_book_publish_gate(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER)
FROM PUBLIC, backend_app;

DROP POLICY IF EXISTS sensa_books_backend_catalog_select ON sensa.books;
CREATE POLICY sensa_books_backend_catalog_select
  ON sensa.books FOR SELECT TO backend_app
  USING (EXISTS (
    SELECT 1
    FROM sensa.book_versions AS versions
    WHERE versions.book_id = books.book_id
      AND versions.status IN ('published', 'retired')
  ));

DROP POLICY IF EXISTS sensa_book_versions_backend_content_select ON sensa.book_versions;
CREATE POLICY sensa_book_versions_backend_content_select
  ON sensa.book_versions FOR SELECT TO backend_app
  USING (status IN ('published', 'retired'));

DROP POLICY IF EXISTS sensa_book_version_senses_backend_content_select ON sensa.book_version_senses;
CREATE POLICY sensa_book_version_senses_backend_content_select
  ON sensa.book_version_senses FOR SELECT TO backend_app
  USING (EXISTS (
    SELECT 1
    FROM sensa.book_versions AS versions
    WHERE versions.book_version_id = book_version_senses.book_version_id
      AND versions.status IN ('published', 'retired')
  ));

DROP POLICY IF EXISTS sensa_study_plans_backend_select ON sensa.study_plans;
DROP POLICY IF EXISTS sensa_study_plans_backend_insert ON sensa.study_plans;
DROP POLICY IF EXISTS sensa_study_plans_backend_update ON sensa.study_plans;

CREATE POLICY sensa_study_plans_backend_select
  ON sensa.study_plans FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_study_plans_backend_insert
  ON sensa.study_plans FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_study_plans_backend_update
  ON sensa.study_plans FOR UPDATE TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
-- Schemas touched/read explicitly: sensa, org, sync, security, content, pg_catalog.
-- Migration status: Current / additive.
-- Introduces: learner-scoped Sensa Sessions, Encounters, immutable facts, and
-- server-owned semantic/FSRS projections.

DO $$
BEGIN
  CREATE TYPE sensa.learning_session_status AS ENUM (
    'active',
    'completed',
    'abandoned'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.encounter_status AS ENUM (
    'planned',
    'active',
    'completed',
    'interrupted',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.encounter_kind AS ENUM (
    'introduction',
    'review'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.mastery_dimension AS ENUM (
    'grounding',
    'boundary',
    'form_mapping',
    'retrieval',
    'transfer'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.mastery_level AS ENUM (
    'unknown',
    'emerging',
    'stable'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.evidence_polarity AS ENUM (
    'positive',
    'negative'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.context_novelty AS ENUM (
    'familiar',
    'novel'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.scaffold_level AS ENUM (
    'full',
    'reduced',
    'minimal',
    'none'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.renderer_kind AS ENUM (
    'content',
    'single_choice',
    'text_input'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.attempt_validity AS ENUM (
    'valid',
    'invalid'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.memory_outcome_kind AS ENUM (
    'introduced',
    'retrieval_failed',
    'supported_retrieval',
    'independent_retrieval',
    'transfer_confirmed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.review_time_clamp_reason AS ENUM (
    'previous_accepted_review_time'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON TYPE sensa.review_time_clamp_reason IS
  'V1 reason for moving an observed review timestamp forward: a previous accepted review time.';

DO $$
BEGIN
  CREATE TYPE sensa.fsrs_card_state AS ENUM (
    'new',
    'learning',
    'review',
    'relearning'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS sensa.learning_sessions (
  learning_session_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  study_plan_id UUID NOT NULL REFERENCES sensa.study_plans(study_plan_id) ON DELETE CASCADE,
  created_by_replica_id UUID NOT NULL REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT,
  status sensa.learning_session_status NOT NULL DEFAULT 'active',
  revision BIGINT NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_sessions_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT learning_sessions_revision_positive CHECK (revision > 0),
  CONSTRAINT learning_sessions_timestamp_order CHECK (
    created_at <= started_at
    AND started_at <= COALESCE(ended_at, started_at)
    AND created_at <= updated_at
  ),
  CONSTRAINT learning_sessions_status_timestamp_shape CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status IN ('completed', 'abandoned') AND ended_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS sensa.sense_encounters (
  sense_encounter_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  learning_session_id UUID NOT NULL REFERENCES sensa.learning_sessions(learning_session_id) ON DELETE CASCADE,
  study_plan_id UUID NOT NULL REFERENCES sensa.study_plans(study_plan_id) ON DELETE CASCADE,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  content_release_id UUID NOT NULL REFERENCES sensa.content_releases(content_release_id) ON DELETE RESTRICT,
  book_version_id UUID NOT NULL REFERENCES sensa.book_versions(book_version_id) ON DELETE RESTRICT,
  session_ordinal INTEGER NOT NULL,
  kind sensa.encounter_kind NOT NULL,
  status sensa.encounter_status NOT NULL DEFAULT 'planned',
  revision BIGINT NOT NULL DEFAULT 1,
  semantic_policy_version TEXT NOT NULL,
  stop_policy_version TEXT NOT NULL,
  evidence_rule_version TEXT NOT NULL,
  state_updater_version TEXT NOT NULL,
  outcome_mapping_version TEXT NOT NULL DEFAULT 'sensa-memory-outcome-v1',
  semantic_state_revision_at_open BIGINT NOT NULL DEFAULT 0,
  memory_state_revision_at_open BIGINT NOT NULL DEFAULT 0,
  planned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sense_encounters_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT sense_encounters_ordinal_positive CHECK (session_ordinal > 0),
  CONSTRAINT sense_encounters_revision_positive CHECK (revision > 0),
  CONSTRAINT sense_encounters_versions_nonempty CHECK (
    btrim(semantic_policy_version) <> ''
    AND btrim(stop_policy_version) <> ''
    AND btrim(evidence_rule_version) <> ''
    AND btrim(state_updater_version) <> ''
    AND outcome_mapping_version = 'sensa-memory-outcome-v1'
  ),
  CONSTRAINT sense_encounters_open_revisions_nonnegative CHECK (
    semantic_state_revision_at_open >= 0
    AND memory_state_revision_at_open >= 0
  ),
  CONSTRAINT sense_encounters_timestamp_order CHECK (
    created_at <= planned_at
    AND planned_at <= COALESCE(opened_at, planned_at)
    AND planned_at <= COALESCE(closed_at, planned_at)
    AND COALESCE(opened_at, planned_at) <= COALESCE(closed_at, COALESCE(opened_at, planned_at))
    AND created_at <= updated_at
  ),
  CONSTRAINT sense_encounters_status_timestamp_shape CHECK (
    (status = 'planned' AND opened_at IS NULL AND closed_at IS NULL)
    OR (status = 'active' AND opened_at IS NOT NULL AND closed_at IS NULL)
    OR (status = 'completed' AND opened_at IS NOT NULL AND closed_at IS NOT NULL)
    OR (status IN ('interrupted', 'cancelled') AND closed_at IS NOT NULL)
  ),
  CONSTRAINT sense_encounters_session_ordinal_unique UNIQUE (learning_session_id, session_ordinal)
);

CREATE TABLE IF NOT EXISTS sensa.learning_actions (
  learning_action_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  sense_encounter_id UUID NOT NULL REFERENCES sensa.sense_encounters(sense_encounter_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  target_dimension sensa.mastery_dimension NOT NULL,
  primitive sensa.acquisition_primitive NOT NULL,
  scaffold_level sensa.scaffold_level NOT NULL,
  renderer_kind sensa.renderer_kind NOT NULL,
  action_schema_version TEXT NOT NULL,
  evidence_rule_version TEXT NOT NULL,
  action_payload JSONB NOT NULL,
  action_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_actions_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT learning_actions_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT learning_actions_schema_nonempty CHECK (
    btrim(action_schema_version) <> '' AND btrim(evidence_rule_version) <> ''
  ),
  CONSTRAINT learning_actions_payload_object CHECK (jsonb_typeof(action_payload) = 'object'),
  CONSTRAINT learning_actions_digest_sha256 CHECK (
    action_digest ~ '^[0-9a-f]{64}$' AND action_digest = lower(action_digest)
  ),
  CONSTRAINT learning_actions_encounter_ordinal_unique UNIQUE (sense_encounter_id, ordinal),
  CONSTRAINT learning_actions_encounter_digest_unique UNIQUE (sense_encounter_id, action_digest)
);

CREATE TABLE IF NOT EXISTS sensa.learning_action_assets (
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  learning_action_id UUID NOT NULL REFERENCES sensa.learning_actions(learning_action_id) ON DELETE CASCADE,
  ordinal SMALLINT NOT NULL,
  learning_asset_id UUID NOT NULL REFERENCES sensa.learning_assets(learning_asset_id) ON DELETE RESTRICT,
  asset_role TEXT NOT NULL,
  CONSTRAINT learning_action_assets_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT learning_action_assets_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT learning_action_assets_role_nonempty CHECK (btrim(asset_role) <> ''),
  PRIMARY KEY (learning_action_id, ordinal),
  CONSTRAINT learning_action_assets_unique_asset_role UNIQUE (
    learning_action_id, learning_asset_id, asset_role
  )
);

CREATE TABLE IF NOT EXISTS sensa.learning_attempts (
  learning_attempt_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  sense_encounter_id UUID NOT NULL REFERENCES sensa.sense_encounters(sense_encounter_id) ON DELETE CASCADE,
  learning_action_id UUID NOT NULL REFERENCES sensa.learning_actions(learning_action_id) ON DELETE CASCADE,
  ordinal SMALLINT NOT NULL,
  source_replica_id UUID NOT NULL REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT,
  response_schema_version TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  response_digest TEXT NOT NULL,
  duration_ms INTEGER,
  validity sensa.attempt_validity NOT NULL,
  is_correct BOOLEAN,
  evaluation_code TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_attempts_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT learning_attempts_ordinal_positive CHECK (ordinal > 0),
  CONSTRAINT learning_attempts_schema_nonempty CHECK (btrim(response_schema_version) <> ''),
  CONSTRAINT learning_attempts_payload_object CHECK (jsonb_typeof(response_payload) = 'object'),
  CONSTRAINT learning_attempts_digest_sha256 CHECK (
    response_digest ~ '^[0-9a-f]{64}$' AND response_digest = lower(response_digest)
  ),
  CONSTRAINT learning_attempts_duration_nonnegative CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT learning_attempts_evaluation_nonempty CHECK (btrim(evaluation_code) <> ''),
  CONSTRAINT learning_attempts_action_ordinal_unique UNIQUE (learning_action_id, ordinal)
);

CREATE TABLE IF NOT EXISTS sensa.learning_evidence (
  learning_evidence_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  sense_encounter_id UUID NOT NULL REFERENCES sensa.sense_encounters(sense_encounter_id) ON DELETE CASCADE,
  learning_action_id UUID NOT NULL REFERENCES sensa.learning_actions(learning_action_id) ON DELETE CASCADE,
  learning_attempt_id UUID NOT NULL REFERENCES sensa.learning_attempts(learning_attempt_id) ON DELETE CASCADE,
  dimension sensa.mastery_dimension NOT NULL,
  polarity sensa.evidence_polarity NOT NULL,
  context_novelty sensa.context_novelty NOT NULL,
  evidence_rule_version TEXT NOT NULL,
  basis_code TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_evidence_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT learning_evidence_rule_nonempty CHECK (btrim(evidence_rule_version) <> ''),
  CONSTRAINT learning_evidence_basis_nonempty CHECK (btrim(basis_code) <> ''),
  CONSTRAINT learning_evidence_attempt_dimension_unique UNIQUE (
    learning_attempt_id, dimension, evidence_rule_version, basis_code
  )
);

CREATE TABLE IF NOT EXISTS sensa.learner_semantic_states (
  learner_semantic_state_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  grounding_level sensa.mastery_level NOT NULL DEFAULT 'unknown',
  grounding_positive_count INTEGER NOT NULL DEFAULT 0,
  grounding_failure_streak INTEGER NOT NULL DEFAULT 0,
  boundary_level sensa.mastery_level NOT NULL DEFAULT 'unknown',
  boundary_positive_count INTEGER NOT NULL DEFAULT 0,
  boundary_failure_streak INTEGER NOT NULL DEFAULT 0,
  form_mapping_level sensa.mastery_level NOT NULL DEFAULT 'unknown',
  form_mapping_positive_count INTEGER NOT NULL DEFAULT 0,
  form_mapping_failure_streak INTEGER NOT NULL DEFAULT 0,
  retrieval_level sensa.mastery_level NOT NULL DEFAULT 'unknown',
  retrieval_positive_count INTEGER NOT NULL DEFAULT 0,
  retrieval_failure_streak INTEGER NOT NULL DEFAULT 0,
  transfer_level sensa.mastery_level NOT NULL DEFAULT 'unknown',
  transfer_positive_count INTEGER NOT NULL DEFAULT 0,
  transfer_failure_streak INTEGER NOT NULL DEFAULT 0,
  projection_version TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  state_digest TEXT NOT NULL,
  projected_through_evidence_id UUID REFERENCES sensa.learning_evidence(learning_evidence_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learner_semantic_states_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT learner_semantic_states_counts_nonnegative CHECK (
    grounding_positive_count >= 0 AND grounding_failure_streak >= 0
    AND boundary_positive_count >= 0 AND boundary_failure_streak >= 0
    AND form_mapping_positive_count >= 0 AND form_mapping_failure_streak >= 0
    AND retrieval_positive_count >= 0 AND retrieval_failure_streak >= 0
    AND transfer_positive_count >= 0 AND transfer_failure_streak >= 0
  ),
  CONSTRAINT learner_semantic_states_projection_nonempty CHECK (btrim(projection_version) <> ''),
  CONSTRAINT learner_semantic_states_revision_positive CHECK (revision > 0),
  CONSTRAINT learner_semantic_states_digest_sha256 CHECK (
    state_digest ~ '^[0-9a-f]{64}$' AND state_digest = lower(state_digest)
  ),
  CONSTRAINT learner_semantic_states_scope_unique UNIQUE (workspace_id, learner_user_id, sense_id)
);

CREATE TABLE IF NOT EXISTS sensa.sense_memory_states (
  sense_memory_state_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  due_at TIMESTAMPTZ,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  fsrs_card_state sensa.fsrs_card_state NOT NULL DEFAULT 'new',
  fsrs_step_index INTEGER,
  fsrs_stability DOUBLE PRECISION,
  fsrs_difficulty DOUBLE PRECISION,
  fsrs_last_reviewed_at TIMESTAMPTZ,
  fsrs_scheduled_days INTEGER,
  revision BIGINT NOT NULL DEFAULT 1,
  last_memory_outcome_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sense_memory_states_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT sense_memory_states_reps_nonnegative CHECK (reps >= 0 AND lapses >= 0),
  CONSTRAINT sense_memory_states_step_nonnegative CHECK (fsrs_step_index IS NULL OR fsrs_step_index >= 0),
  CONSTRAINT sense_memory_states_scheduled_days_nonnegative CHECK (
    fsrs_scheduled_days IS NULL OR fsrs_scheduled_days >= 0
  ),
  CONSTRAINT sense_memory_states_revision_positive CHECK (revision > 0),
  CONSTRAINT sense_memory_states_fsrs_shape CHECK (
    (
      fsrs_card_state = 'new'
      AND due_at IS NULL
      AND fsrs_step_index IS NULL
      AND fsrs_stability IS NULL
      AND fsrs_difficulty IS NULL
      AND fsrs_last_reviewed_at IS NULL
      AND fsrs_scheduled_days IS NULL
    )
    OR (
      fsrs_card_state <> 'new'
      AND fsrs_stability IS NOT NULL
      AND fsrs_difficulty IS NOT NULL
      AND fsrs_last_reviewed_at IS NOT NULL
      AND fsrs_scheduled_days IS NOT NULL
      AND (
        (fsrs_card_state = 'review' AND fsrs_step_index IS NULL)
        OR (fsrs_card_state IN ('learning', 'relearning') AND fsrs_step_index IS NOT NULL)
      )
    )
  ),
  CONSTRAINT sense_memory_states_scope_unique UNIQUE (workspace_id, learner_user_id, sense_id)
);

CREATE TABLE IF NOT EXISTS sensa.memory_outcomes (
  memory_outcome_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  sense_encounter_id UUID NOT NULL REFERENCES sensa.sense_encounters(sense_encounter_id) ON DELETE CASCADE,
  outcome_kind sensa.memory_outcome_kind NOT NULL,
  outcome_mapping_version TEXT NOT NULL DEFAULT 'sensa-memory-outcome-v1',
  fsrs_rating SMALLINT NOT NULL,
  observed_completed_at TIMESTAMPTZ NOT NULL,
  effective_reviewed_at TIMESTAMPTZ NOT NULL,
  review_time_clamped BOOLEAN NOT NULL DEFAULT false,
  review_time_clamp_reason sensa.review_time_clamp_reason,
  prior_memory_revision BIGINT NOT NULL,
  resulting_memory_revision BIGINT NOT NULL,
  fsrs_adapter_version TEXT NOT NULL,
  scheduler_settings_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_outcomes_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT memory_outcomes_mapping_version CHECK (
    outcome_mapping_version = 'sensa-memory-outcome-v1'
  ),
  CONSTRAINT memory_outcomes_rating_range CHECK (fsrs_rating BETWEEN 0 AND 3),
  CONSTRAINT memory_outcomes_revision_nonnegative CHECK (
    prior_memory_revision >= 0
    AND resulting_memory_revision = prior_memory_revision + 1
  ),
  CONSTRAINT memory_outcomes_time_shape CHECK (
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
  ),
  CONSTRAINT memory_outcomes_adapter_nonempty CHECK (
    btrim(fsrs_adapter_version) <> ''
    AND scheduler_settings_digest ~ '^[0-9a-f]{64}$'
    AND scheduler_settings_digest = lower(scheduler_settings_digest)
  ),
  CONSTRAINT memory_outcomes_mapping_rating CHECK (
    (outcome_kind IN ('introduced', 'retrieval_failed') AND fsrs_rating = 0)
    OR (outcome_kind = 'supported_retrieval' AND fsrs_rating = 1)
    OR (outcome_kind = 'independent_retrieval' AND fsrs_rating = 2)
    OR (outcome_kind = 'transfer_confirmed' AND fsrs_rating = 3)
  ),
  CONSTRAINT memory_outcomes_encounter_unique UNIQUE (sense_encounter_id)
);

-- Every persisted Memory State is the projection of one accepted Outcome.  A
-- deferred NO ACTION FK keeps that link mandatory while still allowing an
-- owner Workspace delete to cascade both rows before deferred validation.
ALTER TABLE sensa.sense_memory_states
  ADD CONSTRAINT sense_memory_states_last_outcome_fk
  FOREIGN KEY (last_memory_outcome_id)
  REFERENCES sensa.memory_outcomes(memory_outcome_id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS sensa_learning_sessions_learner_status_idx
  ON sensa.learning_sessions(workspace_id, learner_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sensa_sense_encounters_session_ordinal_idx
  ON sensa.sense_encounters(learning_session_id, session_ordinal);
CREATE INDEX IF NOT EXISTS sensa_sense_encounters_learner_status_idx
  ON sensa.sense_encounters(workspace_id, learner_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sensa_learning_actions_encounter_ordinal_idx
  ON sensa.learning_actions(sense_encounter_id, ordinal);
CREATE INDEX IF NOT EXISTS sensa_learning_attempts_learner_time_idx
  ON sensa.learning_attempts(workspace_id, learner_user_id, occurred_at, learning_attempt_id);
CREATE INDEX IF NOT EXISTS sensa_learning_evidence_rebuild_idx
  ON sensa.learning_evidence(
    workspace_id, learner_user_id, sense_id, occurred_at, learning_evidence_id
  );
CREATE INDEX IF NOT EXISTS sensa_semantic_states_learner_idx
  ON sensa.learner_semantic_states(workspace_id, learner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sensa_memory_states_due_idx
  ON sensa.sense_memory_states(workspace_id, learner_user_id, due_at, sense_id)
  WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS sensa_memory_outcomes_learner_time_idx
  ON sensa.memory_outcomes(workspace_id, learner_user_id, observed_completed_at, memory_outcome_id);

CREATE OR REPLACE FUNCTION sensa.assert_runtime_replica_scope(
  p_replica_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_user_id TEXT;
BEGIN
  SELECT replicas.workspace_id, replicas.user_id
    INTO v_workspace_id, v_user_id
  FROM sync.workspace_replicas AS replicas
  WHERE replicas.replica_id = p_replica_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Runtime replica % does not exist', p_replica_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_user_id IS DISTINCT FROM p_learner_user_id THEN
    RAISE EXCEPTION 'Runtime replica scope does not match learner and Workspace'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_runtime_plan_scope(
  p_study_plan_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_status sensa.study_plan_status;
  v_book_version_id UUID;
BEGIN
  SELECT plans.workspace_id,
         plans.learner_user_id,
         plans.status,
         plans.book_version_id
    INTO v_workspace_id,
         v_learner_user_id,
         v_status,
         v_book_version_id
  FROM sensa.study_plans AS plans
  WHERE plans.study_plan_id = p_study_plan_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Runtime Study Plan % does not exist', p_study_plan_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_learner_user_id IS DISTINCT FROM p_learner_user_id THEN
    RAISE EXCEPTION 'Runtime Study Plan scope does not match learner and Workspace'
      USING ERRCODE = '23514';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Runtime facts require an active Study Plan'
      USING ERRCODE = '23514';
  END IF;
  RETURN v_book_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_runtime_session_scope(
  p_learning_session_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT,
  p_study_plan_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_plan_id UUID;
  v_status sensa.learning_session_status;
BEGIN
  SELECT sessions.workspace_id,
         sessions.learner_user_id,
         sessions.study_plan_id,
         sessions.status
    INTO v_workspace_id,
         v_learner_user_id,
         v_plan_id,
         v_status
  FROM sensa.learning_sessions AS sessions
  WHERE sessions.learning_session_id = p_learning_session_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Learning Session % does not exist', p_learning_session_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_learner_user_id IS DISTINCT FROM p_learner_user_id
    OR v_plan_id IS DISTINCT FROM p_study_plan_id THEN
    RAISE EXCEPTION 'Learning Session scope does not match runtime row'
      USING ERRCODE = '23514';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Runtime rows require an active Learning Session'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_runtime_book_member(
  p_book_version_id UUID,
  p_content_release_id UUID,
  p_sense_id UUID,
  p_sense_version_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_book_release UUID;
  v_book_status sensa.book_version_status;
  v_release_status sensa.content_release_status;
  v_sense_id UUID;
  v_sense_release UUID;
BEGIN
  SELECT versions.content_release_id, versions.status
    INTO v_book_release, v_book_status
  FROM sensa.book_versions AS versions
  WHERE versions.book_version_id = p_book_version_id;
  IF v_book_release IS NULL THEN
    RAISE EXCEPTION 'Runtime Book Version % does not exist', p_book_version_id
      USING ERRCODE = '23503';
  END IF;
  IF v_book_status NOT IN ('published', 'retired')
    OR v_book_release IS DISTINCT FROM p_content_release_id THEN
    RAISE EXCEPTION 'Runtime Book Version is unavailable or crosses Content Release'
      USING ERRCODE = '23514';
  END IF;

  SELECT releases.status INTO v_release_status
  FROM sensa.content_releases AS releases
  WHERE releases.content_release_id = p_content_release_id;
  IF v_release_status NOT IN ('published', 'superseded') THEN
    RAISE EXCEPTION 'Runtime Content Release is unavailable'
      USING ERRCODE = '23514';
  END IF;

  SELECT senses.sense_id, senses.content_release_id
    INTO v_sense_id, v_sense_release
  FROM sensa.sense_versions AS senses
  WHERE senses.sense_version_id = p_sense_version_id;
  IF v_sense_id IS NULL
    OR v_sense_id IS DISTINCT FROM p_sense_id
    OR v_sense_release IS DISTINCT FROM p_content_release_id THEN
    RAISE EXCEPTION 'Runtime Sense Version does not match Sense and Content Release'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM sensa.book_version_senses AS members
    WHERE members.book_version_id = p_book_version_id
      AND members.sense_version_id = p_sense_version_id
  ) THEN
    RAISE EXCEPTION 'Runtime Sense Version is not a member of the Book Version'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_runtime_asset_scope(
  p_learning_asset_id UUID,
  p_content_release_id UUID,
  p_sense_id UUID,
  p_sense_version_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_asset_release UUID;
  v_asset_kind sensa.asset_kind;
  v_asset_sense UUID;
  v_asset_lexeme_version UUID;
  v_member_lexeme UUID;
  v_asset_lexeme UUID;
  v_asset_lexeme_release UUID;
BEGIN
  SELECT assets.content_release_id,
         assets.asset_kind,
         assets.sense_version_id,
         assets.lexeme_version_id
    INTO v_asset_release,
         v_asset_kind,
         v_asset_sense,
         v_asset_lexeme_version
  FROM sensa.learning_assets AS assets
  WHERE assets.learning_asset_id = p_learning_asset_id
    AND assets.review_status = 'approved';

  IF v_asset_release IS NULL
    OR v_asset_release IS DISTINCT FROM p_content_release_id THEN
    RAISE EXCEPTION 'Runtime Action Asset is unavailable or crosses Content Release'
      USING ERRCODE = '23514';
  END IF;

  IF v_asset_kind = 'pronunciation_audio' THEN
    SELECT versions.content_release_id, versions.lexeme_id
      INTO v_asset_lexeme_release, v_asset_lexeme
    FROM sensa.lexeme_versions AS versions
    WHERE versions.lexeme_version_id = v_asset_lexeme_version;
    SELECT stable_senses.lexeme_id INTO v_member_lexeme
    FROM sensa.sense_versions AS member_versions
    JOIN sensa.senses AS stable_senses ON stable_senses.sense_id = member_versions.sense_id
    WHERE member_versions.sense_version_id = p_sense_version_id
      AND member_versions.sense_id = p_sense_id;
    IF v_asset_lexeme_release IS DISTINCT FROM p_content_release_id
      OR v_asset_lexeme IS DISTINCT FROM v_member_lexeme THEN
      RAISE EXCEPTION 'Pronunciation Action Asset does not belong to the Encounter Lexeme'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_asset_sense IS DISTINCT FROM p_sense_version_id THEN
    RAISE EXCEPTION 'Sense-owned Action Asset does not belong to the Encounter Sense Version'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_runtime_action_scope(
  p_learning_action_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT,
  p_encounter_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_encounter_id UUID;
BEGIN
  SELECT actions.workspace_id, actions.learner_user_id, actions.sense_encounter_id
    INTO v_workspace_id, v_learner_user_id, v_encounter_id
  FROM sensa.learning_actions AS actions
  WHERE actions.learning_action_id = p_learning_action_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Learning Action % does not exist', p_learning_action_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_learner_user_id IS DISTINCT FROM p_learner_user_id
    OR v_encounter_id IS DISTINCT FROM p_encounter_id THEN
    RAISE EXCEPTION 'Learning Action scope does not match runtime row'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_learning_session_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_runtime_plan_scope(
      NEW.study_plan_id, NEW.workspace_id, NEW.learner_user_id
    );
    PERFORM sensa.assert_runtime_replica_scope(
      NEW.created_by_replica_id, NEW.workspace_id, NEW.learner_user_id
    );
    IF NEW.status <> 'active' OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Learning Sessions must start active at revision 1'
        USING ERRCODE = '23514';
    END IF;
    NEW.ended_at := NULL;
    NEW.updated_at := COALESCE(NEW.updated_at, statement_timestamp());
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Product deletion is unavailable to backend_app; owner/workspace cleanup
    -- may cascade through this row.
    RETURN OLD;
  END IF;

  IF NEW.learning_session_id IS DISTINCT FROM OLD.learning_session_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.study_plan_id IS DISTINCT FROM OLD.study_plan_id
    OR NEW.created_by_replica_id IS DISTINCT FROM OLD.created_by_replica_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Learning Session stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'completed', 'abandoned') THEN
    RAISE EXCEPTION 'Invalid Learning Session transition active -> %', NEW.status
      USING ERRCODE = '23514';
  ELSIF OLD.status IN ('completed', 'abandoned') THEN
    RAISE EXCEPTION 'Terminal Learning Sessions are immutable'
      USING ERRCODE = '23514';
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := statement_timestamp();
  IF NEW.status = 'active' THEN
    NEW.ended_at := NULL;
  ELSE
    NEW.ended_at := COALESCE(NEW.ended_at, statement_timestamp());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sense_encounter_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_review_status sensa.content_review_status;
  v_plan_book_version_id UUID;
  v_semantic_revision BIGINT;
  v_memory_revision BIGINT;
  v_is_opening BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT sensa.assert_runtime_plan_scope(
      NEW.study_plan_id, NEW.workspace_id, NEW.learner_user_id
    ) INTO v_plan_book_version_id;
    IF NEW.book_version_id IS DISTINCT FROM v_plan_book_version_id THEN
      RAISE EXCEPTION 'Encounter Book Version must match the pinned Study Plan'
        USING ERRCODE = '23514';
    END IF;
    PERFORM sensa.assert_runtime_session_scope(
      NEW.learning_session_id,
      NEW.workspace_id,
      NEW.learner_user_id,
      NEW.study_plan_id
    );
    PERFORM sensa.assert_runtime_book_member(
      NEW.book_version_id,
      NEW.content_release_id,
      NEW.sense_id,
      NEW.sense_version_id
    );
    SELECT versions.review_status INTO v_review_status
    FROM sensa.sense_versions AS versions
    WHERE versions.sense_version_id = NEW.sense_version_id;
    IF v_review_status <> 'approved' THEN
      RAISE EXCEPTION 'Encounters require an approved Sense Version'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'planned' OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Sense Encounters must start planned at revision 1'
        USING ERRCODE = '23514';
    END IF;
    -- Planning cannot snapshot caller-supplied projection revisions.  The
    -- server captures the actual revisions only when the Encounter opens.
    NEW.semantic_state_revision_at_open := 0;
    NEW.memory_state_revision_at_open := 0;
    NEW.opened_at := NULL;
    NEW.closed_at := NULL;
    NEW.updated_at := COALESCE(NEW.updated_at, statement_timestamp());
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Product deletion is unavailable to backend_app; owner/workspace cleanup
    -- may cascade through this row.
    RETURN OLD;
  END IF;

  v_is_opening := OLD.status = 'planned' AND NEW.status = 'active';

  IF NEW.sense_encounter_id IS DISTINCT FROM OLD.sense_encounter_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.learning_session_id IS DISTINCT FROM OLD.learning_session_id
    OR NEW.study_plan_id IS DISTINCT FROM OLD.study_plan_id
    OR NEW.sense_id IS DISTINCT FROM OLD.sense_id
    OR NEW.sense_version_id IS DISTINCT FROM OLD.sense_version_id
    OR NEW.content_release_id IS DISTINCT FROM OLD.content_release_id
    OR NEW.book_version_id IS DISTINCT FROM OLD.book_version_id
    OR NEW.session_ordinal IS DISTINCT FROM OLD.session_ordinal
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.semantic_policy_version IS DISTINCT FROM OLD.semantic_policy_version
    OR NEW.stop_policy_version IS DISTINCT FROM OLD.stop_policy_version
    OR NEW.evidence_rule_version IS DISTINCT FROM OLD.evidence_rule_version
    OR NEW.state_updater_version IS DISTINCT FROM OLD.state_updater_version
    OR NEW.outcome_mapping_version IS DISTINCT FROM OLD.outcome_mapping_version
    OR (
      NOT v_is_opening
      AND NEW.semantic_state_revision_at_open IS DISTINCT FROM OLD.semantic_state_revision_at_open
    )
    OR (
      NOT v_is_opening
      AND NEW.memory_state_revision_at_open IS DISTINCT FROM OLD.memory_state_revision_at_open
    )
    OR NEW.planned_at IS DISTINCT FROM OLD.planned_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sense Encounter stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'planned' AND NEW.status NOT IN ('planned', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid Sense Encounter transition planned -> %', NEW.status
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'active' AND NEW.status NOT IN ('active', 'completed', 'interrupted', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid Sense Encounter transition active -> %', NEW.status
      USING ERRCODE = '23514';
  ELSIF OLD.status IN ('completed', 'interrupted', 'cancelled') THEN
    RAISE EXCEPTION 'Terminal Sense Encounters are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF v_is_opening THEN
    -- A planned Encounter may outlive a paused/completed Plan or Session;
    -- opening must revalidate both scopes before snapshotting revisions.
    PERFORM sensa.assert_runtime_plan_scope(
      NEW.study_plan_id, NEW.workspace_id, NEW.learner_user_id
    );
    PERFORM sensa.assert_runtime_session_scope(
      NEW.learning_session_id,
      NEW.workspace_id,
      NEW.learner_user_id,
      NEW.study_plan_id
    );

    SELECT COALESCE(
      (
        SELECT states.revision
        FROM sensa.learner_semantic_states AS states
        WHERE states.workspace_id = NEW.workspace_id
          AND states.learner_user_id = NEW.learner_user_id
          AND states.sense_id = NEW.sense_id
      ),
      0
    ) INTO v_semantic_revision;
    SELECT COALESCE(
      (
        SELECT states.revision
        FROM sensa.sense_memory_states AS states
        WHERE states.workspace_id = NEW.workspace_id
          AND states.learner_user_id = NEW.learner_user_id
          AND states.sense_id = NEW.sense_id
      ),
      0
    ) INTO v_memory_revision;
    NEW.semantic_state_revision_at_open := v_semantic_revision;
    NEW.memory_state_revision_at_open := v_memory_revision;
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := statement_timestamp();
  IF NEW.status = 'active' THEN
    NEW.opened_at := COALESCE(OLD.opened_at, statement_timestamp());
    NEW.closed_at := NULL;
  ELSIF NEW.status IN ('completed', 'interrupted', 'cancelled') THEN
    IF NEW.status = 'completed' AND OLD.status <> 'active' THEN
      RAISE EXCEPTION 'Only active Sense Encounters may complete'
        USING ERRCODE = '23514';
    END IF;
    NEW.closed_at := COALESCE(NEW.closed_at, statement_timestamp());
    IF NEW.status = 'completed' THEN
      NEW.opened_at := COALESCE(OLD.opened_at, statement_timestamp());
    ELSE
      NEW.opened_at := OLD.opened_at;
    END IF;
  ELSE
    NEW.opened_at := NULL;
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_learning_action_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_encounter_workspace UUID;
  v_encounter_user TEXT;
  v_encounter_release UUID;
  v_encounter_rule TEXT;
  v_encounter_status sensa.encounter_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT encounters.workspace_id,
           encounters.learner_user_id,
           encounters.content_release_id,
           encounters.evidence_rule_version,
           encounters.status
      INTO v_encounter_workspace,
           v_encounter_user,
           v_encounter_release,
           v_encounter_rule,
           v_encounter_status
    FROM sensa.sense_encounters AS encounters
    WHERE encounters.sense_encounter_id = NEW.sense_encounter_id;
    IF v_encounter_workspace IS DISTINCT FROM NEW.workspace_id
      OR v_encounter_user IS DISTINCT FROM NEW.learner_user_id
      OR v_encounter_status <> 'active'
      OR NEW.evidence_rule_version IS DISTINCT FROM v_encounter_rule THEN
      RAISE EXCEPTION 'Learning Action must belong to an active Encounter and its rule version'
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

CREATE OR REPLACE FUNCTION sensa.guard_learning_action_asset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_encounter_id UUID;
  v_release_id UUID;
  v_sense_id UUID;
  v_sense_version_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT actions.sense_encounter_id
      INTO v_encounter_id
    FROM sensa.learning_actions AS actions
    WHERE actions.learning_action_id = NEW.learning_action_id;
    IF v_encounter_id IS NULL THEN
      RAISE EXCEPTION 'Learning Action % does not exist', NEW.learning_action_id
        USING ERRCODE = '23503';
    END IF;
    PERFORM sensa.assert_runtime_action_scope(
      NEW.learning_action_id, NEW.workspace_id, NEW.learner_user_id, v_encounter_id
    );
    SELECT encounters.content_release_id,
           encounters.sense_id,
           encounters.sense_version_id
      INTO v_release_id, v_sense_id, v_sense_version_id
    FROM sensa.sense_encounters AS encounters
    WHERE encounters.sense_encounter_id = v_encounter_id;
    PERFORM sensa.assert_runtime_asset_scope(
      NEW.learning_asset_id, v_release_id, v_sense_id, v_sense_version_id
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Learning Action Asset rows are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_learning_attempt_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_encounter_status sensa.encounter_status;
  v_action_encounter UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_runtime_action_scope(
      NEW.learning_action_id,
      NEW.workspace_id,
      NEW.learner_user_id,
      NEW.sense_encounter_id
    );
    SELECT encounters.status INTO v_encounter_status
    FROM sensa.sense_encounters AS encounters
    WHERE encounters.sense_encounter_id = NEW.sense_encounter_id;
    SELECT actions.sense_encounter_id INTO v_action_encounter
    FROM sensa.learning_actions AS actions
    WHERE actions.learning_action_id = NEW.learning_action_id;
    PERFORM sensa.assert_runtime_replica_scope(
      NEW.source_replica_id, NEW.workspace_id, NEW.learner_user_id
    );
    IF v_encounter_status <> 'active'
      OR v_action_encounter IS DISTINCT FROM NEW.sense_encounter_id THEN
      RAISE EXCEPTION 'Learning Attempt must reference an active Encounter Action'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Learning Attempts are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_learning_evidence_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_attempt_validity sensa.attempt_validity;
  v_attempt_workspace UUID;
  v_attempt_user TEXT;
  v_attempt_encounter UUID;
  v_attempt_action UUID;
  v_encounter_sense UUID;
  v_encounter_sense_version UUID;
  v_encounter_rule TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT attempts.validity,
           attempts.workspace_id,
           attempts.learner_user_id,
           attempts.sense_encounter_id,
           attempts.learning_action_id
      INTO v_attempt_validity,
           v_attempt_workspace,
           v_attempt_user,
           v_attempt_encounter,
           v_attempt_action
    FROM sensa.learning_attempts AS attempts
    WHERE attempts.learning_attempt_id = NEW.learning_attempt_id;
    IF v_attempt_validity IS NULL THEN
      RAISE EXCEPTION 'Learning Attempt % does not exist', NEW.learning_attempt_id
        USING ERRCODE = '23503';
    END IF;
    IF v_attempt_validity <> 'valid'
      OR v_attempt_workspace IS DISTINCT FROM NEW.workspace_id
      OR v_attempt_user IS DISTINCT FROM NEW.learner_user_id
      OR v_attempt_encounter IS DISTINCT FROM NEW.sense_encounter_id
      OR v_attempt_action IS DISTINCT FROM NEW.learning_action_id THEN
      RAISE EXCEPTION 'Evidence must reference the same valid Attempt scope'
        USING ERRCODE = '23514';
    END IF;
    SELECT encounters.sense_id,
           encounters.sense_version_id,
           encounters.evidence_rule_version
      INTO v_encounter_sense,
           v_encounter_sense_version,
           v_encounter_rule
    FROM sensa.sense_encounters AS encounters
    WHERE encounters.sense_encounter_id = NEW.sense_encounter_id;
    IF v_encounter_sense IS DISTINCT FROM NEW.sense_id
      OR v_encounter_sense_version IS DISTINCT FROM NEW.sense_version_id
      OR v_encounter_rule IS DISTINCT FROM NEW.evidence_rule_version THEN
      RAISE EXCEPTION 'Evidence does not match its Encounter Sense and rule version'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Learning Evidence is immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_learner_semantic_state_projection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_evidence_workspace UUID;
  v_evidence_user TEXT;
  v_evidence_sense UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Semantic State projections must start at revision 1'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sensa.senses WHERE sense_id = NEW.sense_id) THEN
      RAISE EXCEPTION 'Semantic State references an unknown Sense'
        USING ERRCODE = '23503';
    END IF;
    IF NEW.projected_through_evidence_id IS NOT NULL THEN
        SELECT evidence.workspace_id,
             evidence.learner_user_id,
             evidence.sense_id
        INTO v_evidence_workspace, v_evidence_user, v_evidence_sense
      FROM sensa.learning_evidence AS evidence
      WHERE evidence.learning_evidence_id = NEW.projected_through_evidence_id;
      IF v_evidence_workspace IS DISTINCT FROM NEW.workspace_id
        OR v_evidence_user IS DISTINCT FROM NEW.learner_user_id
        OR v_evidence_sense IS DISTINCT FROM NEW.sense_id THEN
        RAISE EXCEPTION 'Semantic State projection Evidence scope does not match'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.learner_semantic_state_id IS DISTINCT FROM OLD.learner_semantic_state_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.sense_id IS DISTINCT FROM OLD.sense_id THEN
    RAISE EXCEPTION 'Semantic State scope and identity are immutable'
      USING ERRCODE = '23514';
  END IF;
  NEW.revision := OLD.revision + 1;
  IF NEW.projected_through_evidence_id IS NOT NULL THEN
    SELECT evidence.workspace_id,
           evidence.learner_user_id,
           evidence.sense_id
      INTO v_evidence_workspace, v_evidence_user, v_evidence_sense
    FROM sensa.learning_evidence AS evidence
    WHERE evidence.learning_evidence_id = NEW.projected_through_evidence_id;
    IF v_evidence_workspace IS DISTINCT FROM NEW.workspace_id
      OR v_evidence_user IS DISTINCT FROM NEW.learner_user_id
      OR v_evidence_sense IS DISTINCT FROM NEW.sense_id THEN
      RAISE EXCEPTION 'Semantic State projection Evidence scope does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sense_memory_state_projection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_outcome_workspace UUID;
  v_outcome_user TEXT;
  v_outcome_sense UUID;
  v_outcome_revision BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Sense Memory State projections must start at revision 1'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sensa.senses WHERE sense_id = NEW.sense_id) THEN
      RAISE EXCEPTION 'Memory State references an unknown Sense'
        USING ERRCODE = '23503';
    END IF;
    IF NEW.last_memory_outcome_id IS NOT NULL THEN
      SELECT outcomes.workspace_id,
             outcomes.learner_user_id,
             outcomes.sense_id,
             outcomes.resulting_memory_revision
        INTO v_outcome_workspace,
             v_outcome_user,
             v_outcome_sense,
             v_outcome_revision
      FROM sensa.memory_outcomes AS outcomes
      WHERE outcomes.memory_outcome_id = NEW.last_memory_outcome_id;
      IF v_outcome_workspace IS DISTINCT FROM NEW.workspace_id
        OR v_outcome_user IS DISTINCT FROM NEW.learner_user_id
        OR v_outcome_sense IS DISTINCT FROM NEW.sense_id
        OR v_outcome_revision IS DISTINCT FROM NEW.revision THEN
        RAISE EXCEPTION 'Memory State last Outcome does not match scope and revision'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.sense_memory_state_id IS DISTINCT FROM OLD.sense_memory_state_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.sense_id IS DISTINCT FROM OLD.sense_id THEN
    RAISE EXCEPTION 'Memory State scope and identity are immutable'
      USING ERRCODE = '23514';
  END IF;
  NEW.revision := OLD.revision + 1;
  IF NEW.last_memory_outcome_id IS NOT NULL THEN
    SELECT outcomes.workspace_id,
           outcomes.learner_user_id,
           outcomes.sense_id,
           outcomes.resulting_memory_revision
      INTO v_outcome_workspace,
           v_outcome_user,
           v_outcome_sense,
           v_outcome_revision
    FROM sensa.memory_outcomes AS outcomes
    WHERE outcomes.memory_outcome_id = NEW.last_memory_outcome_id;
    IF v_outcome_workspace IS DISTINCT FROM NEW.workspace_id
      OR v_outcome_user IS DISTINCT FROM NEW.learner_user_id
      OR v_outcome_sense IS DISTINCT FROM NEW.sense_id
      OR v_outcome_revision IS DISTINCT FROM NEW.revision THEN
      RAISE EXCEPTION 'Memory State last Outcome does not match scope and revision'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

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
    IF NEW.outcome_mapping_version <> 'sensa-memory-outcome-v1' THEN
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

CREATE OR REPLACE FUNCTION sensa.assert_encounter_completion_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_encounter_id UUID;
  v_status sensa.encounter_status;
  v_outcome_id UUID;
  v_outcome_workspace UUID;
  v_outcome_user TEXT;
  v_outcome_sense UUID;
  v_outcome_revision BIGINT;
  v_state_outcome UUID;
  v_state_revision BIGINT;
  v_outcome_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'sense_encounters' THEN
    v_encounter_id := COALESCE(NEW.sense_encounter_id, OLD.sense_encounter_id);
  ELSIF TG_TABLE_NAME = 'memory_outcomes' THEN
    v_encounter_id := COALESCE(NEW.sense_encounter_id, OLD.sense_encounter_id);
  ELSIF TG_TABLE_NAME = 'sense_memory_states' THEN
    SELECT outcomes.sense_encounter_id
      INTO v_encounter_id
    FROM sensa.memory_outcomes AS outcomes
    WHERE outcomes.memory_outcome_id = COALESCE(NEW.last_memory_outcome_id, OLD.last_memory_outcome_id);
  END IF;

  IF v_encounter_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT encounters.status INTO v_status
  FROM sensa.sense_encounters AS encounters
  WHERE encounters.sense_encounter_id = v_encounter_id;
  IF v_status IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::INTEGER
    INTO v_outcome_count
  FROM sensa.memory_outcomes AS outcomes
  WHERE outcomes.sense_encounter_id = v_encounter_id;
  SELECT outcomes.memory_outcome_id
    INTO v_outcome_id
  FROM sensa.memory_outcomes AS outcomes
  WHERE outcomes.sense_encounter_id = v_encounter_id
  ORDER BY outcomes.memory_outcome_id
  LIMIT 1;

  IF v_status IN ('interrupted', 'cancelled') THEN
    IF v_outcome_count <> 0 THEN
      RAISE EXCEPTION 'Interrupted or cancelled Encounter cannot have a Memory Outcome'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_status IN ('planned', 'active') THEN
    IF v_outcome_count <> 0 THEN
      RAISE EXCEPTION 'Planned or active Encounter cannot have a Memory Outcome'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF v_outcome_count <> 1 THEN
    RAISE EXCEPTION 'Completed Encounter must have exactly one Memory Outcome'
      USING ERRCODE = '23514';
  END IF;

  SELECT outcomes.workspace_id,
         outcomes.learner_user_id,
         outcomes.sense_id,
         outcomes.resulting_memory_revision
    INTO v_outcome_workspace,
         v_outcome_user,
         v_outcome_sense,
         v_outcome_revision
  FROM sensa.memory_outcomes AS outcomes
  WHERE outcomes.memory_outcome_id = v_outcome_id;
  SELECT states.last_memory_outcome_id, states.revision
    INTO v_state_outcome, v_state_revision
  FROM sensa.sense_memory_states AS states
  JOIN sensa.sense_encounters AS encounters
    ON encounters.workspace_id = states.workspace_id
   AND encounters.learner_user_id = states.learner_user_id
   AND encounters.sense_id = states.sense_id
  WHERE encounters.sense_encounter_id = v_encounter_id;
  IF v_outcome_workspace IS DISTINCT FROM (
       SELECT encounters.workspace_id FROM sensa.sense_encounters AS encounters
       WHERE encounters.sense_encounter_id = v_encounter_id
     )
    OR v_outcome_user IS DISTINCT FROM (
       SELECT encounters.learner_user_id FROM sensa.sense_encounters AS encounters
       WHERE encounters.sense_encounter_id = v_encounter_id
     )
    OR v_outcome_sense IS DISTINCT FROM (
       SELECT encounters.sense_id FROM sensa.sense_encounters AS encounters
       WHERE encounters.sense_encounter_id = v_encounter_id
     )
    OR v_state_outcome IS DISTINCT FROM v_outcome_id
    OR v_state_revision IS DISTINCT FROM v_outcome_revision THEN
    RAISE EXCEPTION 'Completed Encounter Outcome and Memory State are inconsistent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sensa_learning_sessions_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learning_sessions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_learning_session_lifecycle();

CREATE TRIGGER sensa_sense_encounters_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sense_encounters
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sense_encounter_lifecycle();

CREATE TRIGGER sensa_learning_actions_fact_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learning_actions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_learning_action_fact();

CREATE TRIGGER sensa_learning_action_assets_fact_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learning_action_assets
FOR EACH ROW EXECUTE FUNCTION sensa.guard_learning_action_asset();

CREATE TRIGGER sensa_learning_attempts_fact_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learning_attempts
FOR EACH ROW EXECUTE FUNCTION sensa.guard_learning_attempt_fact();

CREATE TRIGGER sensa_learning_evidence_fact_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learning_evidence
FOR EACH ROW EXECUTE FUNCTION sensa.guard_learning_evidence_fact();

CREATE TRIGGER sensa_learner_semantic_states_projection_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learner_semantic_states
FOR EACH ROW EXECUTE FUNCTION sensa.guard_learner_semantic_state_projection();

CREATE TRIGGER sensa_sense_memory_states_projection_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sense_memory_states
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sense_memory_state_projection();

CREATE TRIGGER sensa_memory_outcomes_fact_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.memory_outcomes
FOR EACH ROW EXECUTE FUNCTION sensa.guard_memory_outcome_fact();

-- Completion is checked at transaction end so a server transaction may write
-- Outcome and projections before closing the Encounter. The normal completion
-- path closes the Encounter last; no caller is required to insert a fake
-- terminal row before its derived facts exist.
CREATE CONSTRAINT TRIGGER sensa_sense_encounters_completion_consistency
AFTER INSERT OR UPDATE ON sensa.sense_encounters
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_encounter_completion_consistency();

CREATE CONSTRAINT TRIGGER sensa_memory_outcomes_completion_consistency
AFTER INSERT OR UPDATE ON sensa.memory_outcomes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_encounter_completion_consistency();

CREATE CONSTRAINT TRIGGER sensa_sense_memory_states_completion_consistency
AFTER INSERT OR UPDATE ON sensa.sense_memory_states
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_encounter_completion_consistency();

COMMENT ON TABLE sensa.learning_sessions IS
  'Learner-scoped runtime Sessions. Terminal rows are immutable through the product path and may be removed only by owner/workspace cleanup cascades.';
COMMENT ON TABLE sensa.sense_encounters IS
  'Encounter-level Semantic Learning Loop facts. A completed Encounter has exactly one Memory Outcome; interruption/cancellation has none.';
COMMENT ON TABLE sensa.learning_actions IS
  'Immutable typed learning Action facts selected inside an Encounter.';
COMMENT ON TABLE sensa.learning_action_assets IS
  'Immutable links from an Action to approved Content Kernel Learning Assets.';
COMMENT ON TABLE sensa.learning_attempts IS
  'Immutable learner response facts. Validity and evaluation are server-owned.';
COMMENT ON TABLE sensa.learning_evidence IS
  'Immutable versioned Evidence derived only from valid Attempts.';
COMMENT ON TABLE sensa.learner_semantic_states IS
  'Rebuildable server-owned five-dimension Semantic State projection.';
COMMENT ON TABLE sensa.sense_memory_states IS
  'Server-owned FSRS-shaped Memory State for one learner Sense; no Carrier Card is created.';
COMMENT ON TABLE sensa.memory_outcomes IS
  'Immutable Encounter-level mapping from Sensa learning result to one FSRS rating.';
COMMENT ON COLUMN sensa.memory_outcomes.review_time_clamp_reason IS
  'Nullable when review_time_clamped is false; V1 requires previous_accepted_review_time when true.';

ALTER TABLE sensa.learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_action_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learning_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.learner_semantic_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_memory_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.memory_outcomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  sensa.learning_sessions,
  sensa.sense_encounters,
  sensa.learning_actions,
  sensa.learning_action_assets,
  sensa.learning_attempts,
  sensa.learning_evidence,
  sensa.learner_semantic_states,
  sensa.sense_memory_states,
  sensa.memory_outcomes
FROM PUBLIC, backend_app;

GRANT SELECT, INSERT, UPDATE ON TABLE
  sensa.learning_sessions,
  sensa.sense_encounters,
  sensa.learner_semantic_states,
  sensa.sense_memory_states
TO backend_app;

GRANT SELECT, INSERT ON TABLE
  sensa.learning_actions,
  sensa.learning_action_assets,
  sensa.learning_attempts,
  sensa.learning_evidence,
  sensa.memory_outcomes
TO backend_app;

CREATE POLICY sensa_learning_sessions_runtime_select
  ON sensa.learning_sessions FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learning_sessions_runtime_insert
  ON sensa.learning_sessions FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learning_sessions_runtime_update
  ON sensa.learning_sessions FOR UPDATE TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_sense_encounters_runtime_select
  ON sensa.sense_encounters FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_sense_encounters_runtime_insert
  ON sensa.sense_encounters FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_sense_encounters_runtime_update
  ON sensa.sense_encounters FOR UPDATE TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_learning_actions_runtime_select
  ON sensa.learning_actions FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learning_actions_runtime_insert
  ON sensa.learning_actions FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_learning_action_assets_runtime_select
  ON sensa.learning_action_assets FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learning_action_assets_runtime_insert
  ON sensa.learning_action_assets FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_learning_attempts_runtime_select
  ON sensa.learning_attempts FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learning_attempts_runtime_insert
  ON sensa.learning_attempts FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_learning_evidence_runtime_select
  ON sensa.learning_evidence FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learning_evidence_runtime_insert
  ON sensa.learning_evidence FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_semantic_states_runtime_select
  ON sensa.learner_semantic_states FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_semantic_states_runtime_insert
  ON sensa.learner_semantic_states FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_semantic_states_runtime_update
  ON sensa.learner_semantic_states FOR UPDATE TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_memory_states_runtime_select
  ON sensa.sense_memory_states FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_memory_states_runtime_insert
  ON sensa.sense_memory_states FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_memory_states_runtime_update
  ON sensa.sense_memory_states FOR UPDATE TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY sensa_memory_outcomes_runtime_select
  ON sensa.memory_outcomes FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_memory_outcomes_runtime_insert
  ON sensa.memory_outcomes FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

REVOKE ALL ON FUNCTION sensa.assert_runtime_replica_scope(UUID, UUID, TEXT) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_runtime_plan_scope(UUID, UUID, TEXT) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_runtime_session_scope(UUID, UUID, TEXT, UUID) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_runtime_book_member(UUID, UUID, UUID, UUID) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_runtime_asset_scope(UUID, UUID, UUID, UUID) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_runtime_action_scope(UUID, UUID, TEXT, UUID) FROM PUBLIC, backend_app;
-- Schemas touched/read explicitly: sensa, org, sync, security, pg_catalog.
-- Migration status: Current / additive.
-- Introduces: the isolated sensa-sync-v1 operation ledger, change feeds, and
-- verified learner replica cursors.  Existing generic sync tables remain out
-- of scope and are deliberately not referenced by the feed tables.

CREATE SCHEMA IF NOT EXISTS sensa;

DO $$
BEGIN
  CREATE TYPE sensa.sync_operation_kind AS ENUM (
    'study_plan.create',
    'study_plan.update',
    'learning_session.start',
    'learning_session.complete',
    'sense_encounter.open',
    'learning_attempt.record',
    'sense_encounter.complete',
    'sense_encounter.interrupt'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sync_operation_result_status AS ENUM (
    'applied',
    'rebased',
    'conflict'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sync_error_code AS ENUM (
    'authentication_required',
    'workspace_access_denied',
    'replica_scope_mismatch',
    'upgrade_required',
    'version_mismatch',
    'invalid_cursor',
    'bootstrap_required',
    'invalid_operation',
    'operation_id_reuse',
    'missing_dependency',
    'blocked_by_prior_operation',
    'immutable_fact_conflict',
    'revision_conflict',
    'terminal_state_conflict',
    'kernel_replay_failed',
    'content_unavailable',
    'schedule_conflict'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sync_mutable_entity_type AS ENUM (
    'study_plan',
    'learning_session',
    'sense_encounter',
    'learner_semantic_state',
    'sense_memory_state'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sync_change_action AS ENUM (
    'upsert',
    'tombstone'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.sync_append_fact_type AS ENUM (
    'learning_action',
    'learning_attempt',
    'learning_evidence',
    'memory_outcome'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS sensa.sync_operation_acceptance_seq AS BIGINT START WITH 1;
CREATE SEQUENCE IF NOT EXISTS sensa.sync_mutable_change_seq AS BIGINT START WITH 1;
CREATE SEQUENCE IF NOT EXISTS sensa.sync_append_fact_seq AS BIGINT START WITH 1;

CREATE TABLE IF NOT EXISTS sensa.sync_operations (
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  server_acceptance_sequence BIGINT NOT NULL,
  replica_id UUID NOT NULL
    REFERENCES sync.workspace_replicas(replica_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  wire_version TEXT NOT NULL,
  canonicalizer_version TEXT NOT NULL,
  result_schema_version TEXT NOT NULL,
  kind sensa.sync_operation_kind NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_digest TEXT NOT NULL,
  result_digest TEXT NOT NULL,
  result_payload JSONB NOT NULL,
  stored_status sensa.sync_operation_result_status NOT NULL,
  error_code sensa.sync_error_code,
  acknowledged BOOLEAN NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  first_mutable_sequence BIGINT,
  last_mutable_sequence BIGINT,
  first_fact_sequence BIGINT,
  last_fact_sequence BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_operations_pkey PRIMARY KEY (workspace_id, learner_user_id, operation_id),
  CONSTRAINT sync_operations_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT sync_operations_operation_id_shape CHECK (
    operation_id = btrim(operation_id)
    AND char_length(operation_id) BETWEEN 1 AND 256
  ),
  CONSTRAINT sync_operations_acceptance_positive CHECK (server_acceptance_sequence > 0),
  CONSTRAINT sync_operations_wire_version CHECK (wire_version = 'sensa-sync-v1'),
  CONSTRAINT sync_operations_canonicalizer_version CHECK (
    canonicalizer_version = 'sensa-sync-v1'
  ),
  CONSTRAINT sync_operations_result_schema_version CHECK (
    result_schema_version = 'sensa-sync-result-v1'
  ),
  CONSTRAINT sync_operations_payload_digest_sha256 CHECK (
    payload_digest ~ '^[0-9a-f]{64}$' AND payload_digest = lower(payload_digest)
  ),
  CONSTRAINT sync_operations_result_digest_sha256 CHECK (
    result_digest ~ '^[0-9a-f]{64}$' AND result_digest = lower(result_digest)
  ),
  CONSTRAINT sync_operations_result_object CHECK (jsonb_typeof(result_payload) = 'object'),
  CONSTRAINT sync_operations_ack_shape CHECK (
    (
      stored_status IN ('applied', 'rebased')
      AND acknowledged
      AND error_code IS NULL
      AND acknowledged_at IS NOT NULL
    )
    OR (
      stored_status = 'conflict'
      AND NOT acknowledged
      AND error_code IS NOT NULL
      AND acknowledged_at IS NULL
    )
  ),
  CONSTRAINT sync_operations_mutable_bounds CHECK (
    (
      first_mutable_sequence IS NULL
      AND last_mutable_sequence IS NULL
    )
    OR (
      first_mutable_sequence > 0
      AND last_mutable_sequence >= first_mutable_sequence
    )
  ),
  CONSTRAINT sync_operations_fact_bounds CHECK (
    (
      first_fact_sequence IS NULL
      AND last_fact_sequence IS NULL
    )
    OR (
      first_fact_sequence > 0
      AND last_fact_sequence >= first_fact_sequence
    )
  ),
  CONSTRAINT sync_operations_timestamp_order CHECK (created_at <= accepted_at),
  CONSTRAINT sync_operations_acceptance_sequence_unique UNIQUE (server_acceptance_sequence)
);

CREATE TABLE IF NOT EXISTS sensa.sync_mutable_changes (
  mutable_change_sequence BIGINT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  entity_type sensa.sync_mutable_entity_type NOT NULL,
  entity_id UUID NOT NULL,
  entity_revision BIGINT NOT NULL,
  action sensa.sync_change_action NOT NULL,
  tombstone_reason TEXT,
  source_operation_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_mutable_changes_pkey PRIMARY KEY (mutable_change_sequence),
  CONSTRAINT sync_mutable_changes_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT sync_mutable_changes_sequence_positive CHECK (mutable_change_sequence > 0),
  CONSTRAINT sync_mutable_changes_revision_positive CHECK (entity_revision > 0),
  CONSTRAINT sync_mutable_changes_source_operation_nonempty CHECK (btrim(source_operation_id) <> ''),
  CONSTRAINT sync_mutable_changes_tombstone_shape CHECK (
    (action = 'upsert' AND tombstone_reason IS NULL)
    OR (
      action = 'tombstone'
      AND tombstone_reason IS NOT NULL
      AND tombstone_reason = btrim(tombstone_reason)
      AND char_length(tombstone_reason) BETWEEN 1 AND 128
    )
  ),
  CONSTRAINT sync_mutable_changes_source_operation_fk
    FOREIGN KEY (workspace_id, learner_user_id, source_operation_id)
    REFERENCES sensa.sync_operations(workspace_id, learner_user_id, operation_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sync_mutable_changes_entity_revision_unique UNIQUE (
    workspace_id, learner_user_id, entity_type, entity_id, entity_revision, action
  )
);

CREATE TABLE IF NOT EXISTS sensa.sync_append_facts (
  fact_sequence BIGINT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  fact_type sensa.sync_append_fact_type NOT NULL,
  fact_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source_operation_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_append_facts_pkey PRIMARY KEY (fact_sequence),
  CONSTRAINT sync_append_facts_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT sync_append_facts_sequence_positive CHECK (fact_sequence > 0),
  CONSTRAINT sync_append_facts_source_operation_nonempty CHECK (btrim(source_operation_id) <> ''),
  CONSTRAINT sync_append_facts_source_operation_fk
    FOREIGN KEY (workspace_id, learner_user_id, source_operation_id)
    REFERENCES sensa.sync_operations(workspace_id, learner_user_id, operation_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sync_append_facts_identity_unique UNIQUE (
    workspace_id, learner_user_id, fact_type, fact_id
  )
);

CREATE TABLE IF NOT EXISTS sensa.sync_replica_states (
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  replica_id UUID NOT NULL
    REFERENCES sync.workspace_replicas(replica_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  wire_version TEXT NOT NULL,
  bootstrap_epoch BIGINT NOT NULL DEFAULT 1,
  bootstrap_required BOOLEAN NOT NULL DEFAULT true,
  bootstrap_mutable_cursor BIGINT NOT NULL DEFAULT 0,
  bootstrap_fact_cursor BIGINT NOT NULL DEFAULT 0,
  acknowledged_mutable_cursor BIGINT NOT NULL DEFAULT 0,
  acknowledged_fact_cursor BIGINT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bootstrapped_at TIMESTAMPTZ,
  last_pulled_at TIMESTAMPTZ,
  last_pushed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_replica_states_pkey PRIMARY KEY (workspace_id, learner_user_id, replica_id),
  CONSTRAINT sync_replica_states_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT sync_replica_states_wire_version CHECK (wire_version = 'sensa-sync-v1'),
  CONSTRAINT sync_replica_states_epoch_positive CHECK (bootstrap_epoch > 0),
  CONSTRAINT sync_replica_states_cursors_nonnegative CHECK (
    bootstrap_mutable_cursor >= 0
    AND bootstrap_fact_cursor >= 0
    AND acknowledged_mutable_cursor >= 0
    AND acknowledged_fact_cursor >= 0
  ),
  CONSTRAINT sync_replica_states_revision_positive CHECK (revision > 0),
  CONSTRAINT sync_replica_states_timestamp_order CHECK (created_at <= updated_at)
);

CREATE INDEX IF NOT EXISTS sensa_sync_operations_learner_sequence_idx
  ON sensa.sync_operations(workspace_id, learner_user_id, server_acceptance_sequence);
CREATE INDEX IF NOT EXISTS sensa_sync_operations_learner_status_idx
  ON sensa.sync_operations(workspace_id, learner_user_id, stored_status, accepted_at DESC);
CREATE INDEX IF NOT EXISTS sensa_sync_mutable_changes_learner_cursor_idx
  ON sensa.sync_mutable_changes(workspace_id, learner_user_id, mutable_change_sequence);
CREATE INDEX IF NOT EXISTS sensa_sync_mutable_changes_entity_idx
  ON sensa.sync_mutable_changes(
    workspace_id, learner_user_id, entity_type, entity_id, mutable_change_sequence DESC
  );
CREATE INDEX IF NOT EXISTS sensa_sync_append_facts_learner_cursor_idx
  ON sensa.sync_append_facts(workspace_id, learner_user_id, fact_sequence);
CREATE INDEX IF NOT EXISTS sensa_sync_append_facts_type_time_idx
  ON sensa.sync_append_facts(workspace_id, learner_user_id, fact_type, occurred_at, fact_id);
CREATE INDEX IF NOT EXISTS sensa_sync_replica_states_learner_idx
  ON sensa.sync_replica_states(workspace_id, learner_user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION sensa.assert_sync_replica_scope(
  p_replica_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_user_id TEXT;
BEGIN
  SELECT replicas.workspace_id, replicas.user_id
    INTO v_workspace_id, v_user_id
  FROM sync.workspace_replicas AS replicas
  WHERE replicas.replica_id = p_replica_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sensa Sync replica % does not exist', p_replica_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_user_id IS DISTINCT FROM p_learner_user_id THEN
    RAISE EXCEPTION 'Sensa Sync replica scope does not match learner and Workspace'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sync_cursor_high_water(
  p_mutable_cursor BIGINT,
  p_fact_cursor BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_mutable_high_water BIGINT;
  v_fact_high_water BIGINT;
BEGIN
  SELECT COALESCE(MAX(changes.mutable_change_sequence), 0)
    INTO v_mutable_high_water
  FROM sensa.sync_mutable_changes AS changes;
  SELECT COALESCE(MAX(facts.fact_sequence), 0)
    INTO v_fact_high_water
  FROM sensa.sync_append_facts AS facts;

  IF p_mutable_cursor < 0 OR p_fact_cursor < 0
    OR p_mutable_cursor > v_mutable_high_water
    OR p_fact_cursor > v_fact_high_water THEN
    RAISE EXCEPTION 'Sensa Sync cursor is outside the current feed high-water mark'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sync_mutable_canonical(
  p_entity_type sensa.sync_mutable_entity_type,
  p_entity_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT,
  p_entity_revision BIGINT,
  p_action sensa.sync_change_action
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_revision BIGINT;
BEGIN
  CASE p_entity_type
    WHEN 'study_plan' THEN
      SELECT plans.workspace_id, plans.learner_user_id, plans.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.study_plans AS plans
      WHERE plans.study_plan_id = p_entity_id;
    WHEN 'learning_session' THEN
      SELECT sessions.workspace_id, sessions.learner_user_id, sessions.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.learning_sessions AS sessions
      WHERE sessions.learning_session_id = p_entity_id;
    WHEN 'sense_encounter' THEN
      SELECT encounters.workspace_id, encounters.learner_user_id, encounters.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.sense_encounters AS encounters
      WHERE encounters.sense_encounter_id = p_entity_id;
    WHEN 'learner_semantic_state' THEN
      SELECT states.workspace_id, states.learner_user_id, states.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.learner_semantic_states AS states
      WHERE states.learner_semantic_state_id = p_entity_id;
    WHEN 'sense_memory_state' THEN
      SELECT states.workspace_id, states.learner_user_id, states.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.sense_memory_states AS states
      WHERE states.sense_memory_state_id = p_entity_id;
  END CASE;

  IF NOT FOUND THEN
    IF p_action = 'tombstone' THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Sensa Sync upsert references a missing % %', p_entity_type, p_entity_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_learner_user_id IS DISTINCT FROM p_learner_user_id THEN
    RAISE EXCEPTION 'Sensa Sync mutable change crosses learner or Workspace scope'
      USING ERRCODE = '23514';
  END IF;
  IF v_revision IS DISTINCT FROM p_entity_revision THEN
    RAISE EXCEPTION 'Sensa Sync mutable change revision does not match canonical row'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sync_fact_canonical(
  p_fact_type sensa.sync_append_fact_type,
  p_fact_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT,
  p_occurred_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_occurred_at TIMESTAMPTZ;
BEGIN
  CASE p_fact_type
    WHEN 'learning_action' THEN
      SELECT actions.workspace_id, actions.learner_user_id, actions.created_at
        INTO v_workspace_id, v_learner_user_id, v_occurred_at
      FROM sensa.learning_actions AS actions
      WHERE actions.learning_action_id = p_fact_id;
    WHEN 'learning_attempt' THEN
      SELECT attempts.workspace_id, attempts.learner_user_id, attempts.occurred_at
        INTO v_workspace_id, v_learner_user_id, v_occurred_at
      FROM sensa.learning_attempts AS attempts
      WHERE attempts.learning_attempt_id = p_fact_id;
    WHEN 'learning_evidence' THEN
      SELECT evidence.workspace_id, evidence.learner_user_id, evidence.occurred_at
        INTO v_workspace_id, v_learner_user_id, v_occurred_at
      FROM sensa.learning_evidence AS evidence
      WHERE evidence.learning_evidence_id = p_fact_id;
    WHEN 'memory_outcome' THEN
      SELECT outcomes.workspace_id, outcomes.learner_user_id, outcomes.observed_completed_at
        INTO v_workspace_id, v_learner_user_id, v_occurred_at
      FROM sensa.memory_outcomes AS outcomes
      WHERE outcomes.memory_outcome_id = p_fact_id;
  END CASE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sensa Sync fact % % does not exist', p_fact_type, p_fact_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_learner_user_id IS DISTINCT FROM p_learner_user_id THEN
    RAISE EXCEPTION 'Sensa Sync fact crosses learner or Workspace scope'
      USING ERRCODE = '23514';
  END IF;
  IF v_occurred_at IS DISTINCT FROM p_occurred_at THEN
    RAISE EXCEPTION 'Sensa Sync fact occurred_at does not match canonical fact'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.assert_sync_operation_feed_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_stored_status sensa.sync_operation_result_status;
  v_first_mutable BIGINT;
  v_last_mutable BIGINT;
  v_first_fact BIGINT;
  v_last_fact BIGINT;
  v_actual_first_mutable BIGINT;
  v_actual_last_mutable BIGINT;
  v_actual_first_fact BIGINT;
  v_actual_last_fact BIGINT;
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_operation_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'sync_operations' THEN
    v_workspace_id := NEW.workspace_id;
    v_learner_user_id := NEW.learner_user_id;
    v_operation_id := NEW.operation_id;
  ELSE
    v_workspace_id := NEW.workspace_id;
    v_learner_user_id := NEW.learner_user_id;
    v_operation_id := NEW.source_operation_id;
  END IF;

  SELECT operations.stored_status,
         operations.first_mutable_sequence,
         operations.last_mutable_sequence,
         operations.first_fact_sequence,
         operations.last_fact_sequence
    INTO v_stored_status,
         v_first_mutable,
         v_last_mutable,
         v_first_fact,
         v_last_fact
  FROM sensa.sync_operations AS operations
  WHERE operations.workspace_id = v_workspace_id
    AND operations.learner_user_id = v_learner_user_id
    AND operations.operation_id = v_operation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sensa Sync feed row has no operation ledger row at COMMIT'
      USING ERRCODE = '23503';
  END IF;

  SELECT MIN(changes.mutable_change_sequence), MAX(changes.mutable_change_sequence)
    INTO v_actual_first_mutable, v_actual_last_mutable
  FROM sensa.sync_mutable_changes AS changes
  WHERE changes.workspace_id = v_workspace_id
    AND changes.learner_user_id = v_learner_user_id
    AND changes.source_operation_id = v_operation_id;
  SELECT MIN(facts.fact_sequence), MAX(facts.fact_sequence)
    INTO v_actual_first_fact, v_actual_last_fact
  FROM sensa.sync_append_facts AS facts
  WHERE facts.workspace_id = v_workspace_id
    AND facts.learner_user_id = v_learner_user_id
    AND facts.source_operation_id = v_operation_id;

  IF v_stored_status = 'conflict' THEN
    IF v_actual_first_mutable IS NOT NULL OR v_actual_first_fact IS NOT NULL
      OR v_first_mutable IS NOT NULL OR v_last_mutable IS NOT NULL
      OR v_first_fact IS NOT NULL OR v_last_fact IS NOT NULL THEN
      RAISE EXCEPTION 'Conflict Sensa Sync operations cannot carry feed bounds or feed rows'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_first_mutable IS DISTINCT FROM v_actual_first_mutable
    OR v_last_mutable IS DISTINCT FROM v_actual_last_mutable
    OR v_first_fact IS DISTINCT FROM v_actual_first_fact
    OR v_last_fact IS DISTINCT FROM v_actual_last_fact THEN
    RAISE EXCEPTION 'Sensa Sync operation feed bounds do not match their source rows'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sync_operation_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_sync_replica_scope(
      NEW.replica_id, NEW.workspace_id, NEW.learner_user_id
    );
    NEW.server_acceptance_sequence := nextval('sensa.sync_operation_acceptance_seq'::regclass);
    NEW.created_at := statement_timestamp();
    NEW.accepted_at := statement_timestamp();
    IF NEW.stored_status IN ('applied', 'rebased') THEN
      NEW.acknowledged_at := statement_timestamp();
    ELSE
      NEW.acknowledged_at := NULL;
    END IF;

    SELECT MIN(changes.mutable_change_sequence), MAX(changes.mutable_change_sequence)
      INTO NEW.first_mutable_sequence, NEW.last_mutable_sequence
    FROM sensa.sync_mutable_changes AS changes
    WHERE changes.workspace_id = NEW.workspace_id
      AND changes.learner_user_id = NEW.learner_user_id
      AND changes.source_operation_id = NEW.operation_id;
    SELECT MIN(facts.fact_sequence), MAX(facts.fact_sequence)
      INTO NEW.first_fact_sequence, NEW.last_fact_sequence
    FROM sensa.sync_append_facts AS facts
    WHERE facts.workspace_id = NEW.workspace_id
      AND facts.learner_user_id = NEW.learner_user_id
      AND facts.source_operation_id = NEW.operation_id;
    IF NEW.stored_status = 'conflict'
      AND (NEW.first_mutable_sequence IS NOT NULL OR NEW.first_fact_sequence IS NOT NULL) THEN
      RAISE EXCEPTION 'Conflict Sensa Sync operations cannot carry feed rows'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Backend has no DELETE grant.  Owner Workspace cleanup cascades through
    -- the ledger and must be allowed to remove its dependent feed rows.
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Sensa Sync operation ledger rows are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sync_mutable_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_sync_mutable_canonical(
      NEW.entity_type,
      NEW.entity_id,
      NEW.workspace_id,
      NEW.learner_user_id,
      NEW.entity_revision,
      NEW.action
    );
    NEW.mutable_change_sequence := nextval('sensa.sync_mutable_change_seq'::regclass);
    NEW.recorded_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Sensa Sync mutable change rows are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sync_append_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_sync_fact_canonical(
      NEW.fact_type,
      NEW.fact_id,
      NEW.workspace_id,
      NEW.learner_user_id,
      NEW.occurred_at
    );
    NEW.fact_sequence := nextval('sensa.sync_append_fact_seq'::regclass);
    NEW.recorded_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Sensa Sync append fact rows are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sync_replica_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_sync_replica_scope(
      NEW.replica_id, NEW.workspace_id, NEW.learner_user_id
    );
    IF NEW.bootstrap_epoch <> 1
      OR NOT NEW.bootstrap_required
      OR NEW.bootstrap_mutable_cursor <> 0
      OR NEW.bootstrap_fact_cursor <> 0
      OR NEW.acknowledged_mutable_cursor <> 0
      OR NEW.acknowledged_fact_cursor <> 0
      OR NEW.bootstrapped_at IS NOT NULL
      OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Sensa Sync replica state must start in bootstrap-required epoch 1'
        USING ERRCODE = '23514';
    END IF;
    PERFORM sensa.assert_sync_cursor_high_water(0, 0);
    NEW.created_at := statement_timestamp();
    NEW.bootstrapped_at := NULL;
    NEW.last_pulled_at := NULL;
    NEW.last_pushed_at := NULL;
    NEW.revision := 1;
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Backend has no DELETE grant.  Owner Workspace/replica cleanup is
    -- intentionally allowed to cascade through this state row.
    RETURN OLD;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.replica_id IS DISTINCT FROM OLD.replica_id
    OR NEW.wire_version IS DISTINCT FROM OLD.wire_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sensa Sync replica state identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (OLD.last_pulled_at IS NOT NULL AND NEW.last_pulled_at IS NULL)
    OR (OLD.last_pulled_at IS NOT NULL AND NEW.last_pulled_at < OLD.last_pulled_at)
    OR (OLD.last_pushed_at IS NOT NULL AND NEW.last_pushed_at IS NULL)
    OR (OLD.last_pushed_at IS NOT NULL AND NEW.last_pushed_at < OLD.last_pushed_at) THEN
    RAISE EXCEPTION 'Sensa Sync replica timestamps cannot move backward'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.last_pulled_at IS DISTINCT FROM OLD.last_pulled_at THEN
    NEW.last_pulled_at := statement_timestamp();
  END IF;
  IF NEW.last_pushed_at IS DISTINCT FROM OLD.last_pushed_at THEN
    NEW.last_pushed_at := statement_timestamp();
  END IF;

  IF NEW.bootstrap_epoch < OLD.bootstrap_epoch
    OR (
      NEW.bootstrap_epoch = OLD.bootstrap_epoch
      AND (
        NEW.bootstrap_mutable_cursor < OLD.bootstrap_mutable_cursor
        OR NEW.bootstrap_fact_cursor < OLD.bootstrap_fact_cursor
        OR NEW.acknowledged_mutable_cursor < OLD.acknowledged_mutable_cursor
        OR NEW.acknowledged_fact_cursor < OLD.acknowledged_fact_cursor
      )
    ) THEN
    RAISE EXCEPTION 'Sensa Sync cursor regression is not allowed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.bootstrap_epoch > OLD.bootstrap_epoch + 1 THEN
    RAISE EXCEPTION 'Sensa Sync bootstrap epochs must advance by one'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.bootstrap_mutable_cursor > NEW.acknowledged_mutable_cursor
    OR NEW.bootstrap_fact_cursor > NEW.acknowledged_fact_cursor THEN
    RAISE EXCEPTION 'Sensa Sync acknowledged cursors cannot precede bootstrap cursors'
      USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_sync_cursor_high_water(
    NEW.acknowledged_mutable_cursor,
    NEW.acknowledged_fact_cursor
  );
  PERFORM sensa.assert_sync_cursor_high_water(
    NEW.bootstrap_mutable_cursor,
    NEW.bootstrap_fact_cursor
  );

  IF NEW.bootstrap_epoch = OLD.bootstrap_epoch THEN
    IF OLD.bootstrap_required AND NOT NEW.bootstrap_required THEN
      RAISE EXCEPTION 'Sensa Sync bootstrap completion must rotate the epoch'
        USING ERRCODE = '23514';
    END IF;

    IF NOT OLD.bootstrap_required AND NEW.bootstrap_required THEN
      IF NEW.bootstrap_mutable_cursor IS DISTINCT FROM OLD.bootstrap_mutable_cursor
        OR NEW.bootstrap_fact_cursor IS DISTINCT FROM OLD.bootstrap_fact_cursor
        OR NEW.acknowledged_mutable_cursor IS DISTINCT FROM OLD.acknowledged_mutable_cursor
        OR NEW.acknowledged_fact_cursor IS DISTINCT FROM OLD.acknowledged_fact_cursor
        OR NEW.bootstrapped_at IS DISTINCT FROM OLD.bootstrapped_at THEN
        RAISE EXCEPTION 'Marking Sensa Sync bootstrap-required cannot alter cursors in the same epoch'
          USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.bootstrap_required THEN
      IF NEW.bootstrap_mutable_cursor IS DISTINCT FROM OLD.bootstrap_mutable_cursor
        OR NEW.bootstrap_fact_cursor IS DISTINCT FROM OLD.bootstrap_fact_cursor
        OR NEW.acknowledged_mutable_cursor IS DISTINCT FROM OLD.acknowledged_mutable_cursor
        OR NEW.acknowledged_fact_cursor IS DISTINCT FROM OLD.acknowledged_fact_cursor
        OR NEW.bootstrapped_at IS DISTINCT FROM OLD.bootstrapped_at THEN
        RAISE EXCEPTION 'A Sensa Sync bootstrap-required state must be rebootstrap-completed in a new epoch'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NEW.bootstrap_mutable_cursor IS DISTINCT FROM OLD.bootstrap_mutable_cursor
        OR NEW.bootstrap_fact_cursor IS DISTINCT FROM OLD.bootstrap_fact_cursor
        OR NEW.bootstrapped_at IS DISTINCT FROM OLD.bootstrapped_at THEN
        RAISE EXCEPTION 'Sensa Sync bootstrap cursors are immutable after successful bootstrap'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    IF NEW.bootstrap_epoch <> OLD.bootstrap_epoch + 1
      OR NOT OLD.bootstrap_required
      OR NEW.bootstrap_required
      OR NEW.bootstrapped_at IS NULL
      OR NEW.bootstrap_mutable_cursor < OLD.acknowledged_mutable_cursor
      OR NEW.bootstrap_fact_cursor < OLD.acknowledged_fact_cursor
      OR NEW.acknowledged_mutable_cursor <> NEW.bootstrap_mutable_cursor
      OR NEW.acknowledged_fact_cursor <> NEW.bootstrap_fact_cursor THEN
      RAISE EXCEPTION 'Sensa Sync rebootstrap must rotate from required state and acknowledge its snapshot'
        USING ERRCODE = '23514';
    END IF;
    NEW.bootstrapped_at := statement_timestamp();
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sensa_sync_operations_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sync_operations
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sync_operation_ledger();

CREATE TRIGGER sensa_sync_mutable_changes_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sync_mutable_changes
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sync_mutable_change();

CREATE CONSTRAINT TRIGGER sensa_sync_mutable_changes_bounds_consistency
AFTER INSERT ON sensa.sync_mutable_changes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sync_operation_feed_bounds();

CREATE TRIGGER sensa_sync_append_facts_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sync_append_facts
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sync_append_fact();

CREATE CONSTRAINT TRIGGER sensa_sync_append_facts_bounds_consistency
AFTER INSERT ON sensa.sync_append_facts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sync_operation_feed_bounds();

CREATE CONSTRAINT TRIGGER sensa_sync_operations_bounds_consistency
AFTER INSERT ON sensa.sync_operations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sensa.assert_sync_operation_feed_bounds();

CREATE TRIGGER sensa_sync_replica_states_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sync_replica_states
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sync_replica_state();

COMMENT ON TABLE sensa.sync_operations IS
  'Immutable sensa-sync-v1 learner-scoped idempotency ledger and versioned operation result metadata. Feed rows are staged before this row so server-assigned bounds are immutable.';
COMMENT ON TABLE sensa.sync_mutable_changes IS
  'Immutable sensa-sync-v1 cursor feed for canonical mutable runtime rows; it stores no entity snapshot.';
COMMENT ON TABLE sensa.sync_append_facts IS
  'Immutable sensa-sync-v1 cursor feed referencing canonical Action, Attempt, Evidence, and Outcome facts.';
COMMENT ON TABLE sensa.sync_replica_states IS
  'Verified learner replica bootstrap epoch and monotonic Sensa sync cursor state. A new row starts bootstrap-required at epoch 1; completion must rotate +1, set required=false, and acknowledge exactly the snapshot cursors.';
COMMENT ON COLUMN sensa.sync_operations.result_payload IS
  'Versioned operation result object only; canonical learner entities are read from their owning tables.';
COMMENT ON COLUMN sensa.sync_mutable_changes.entity_revision IS
  'Revision copied from the canonical 0115/0116 row and verified by trigger; no mutable snapshot is stored.';
COMMENT ON COLUMN sensa.sync_append_facts.occurred_at IS
  'Original canonical fact time, verified against the owning 0116 fact row.';
COMMENT ON COLUMN sensa.sync_replica_states.bootstrap_epoch IS
  'Monotonic bootstrap generation.  Initial state is required; successful bootstrap rotates +1, sets required=false, and acknowledges its snapshot cursors.';
COMMENT ON COLUMN sensa.sync_operations.first_mutable_sequence IS
  'Server-maintained min mutable cursor for this operation; feed rows are staged before ledger insert and checked again at COMMIT.';
COMMENT ON COLUMN sensa.sync_operations.last_mutable_sequence IS
  'Server-maintained max mutable cursor for this operation; feed rows are staged before ledger insert and checked again at COMMIT.';
COMMENT ON COLUMN sensa.sync_operations.first_fact_sequence IS
  'Server-maintained min fact cursor for this operation; feed rows are staged before ledger insert and checked again at COMMIT.';
COMMENT ON COLUMN sensa.sync_operations.last_fact_sequence IS
  'Server-maintained max fact cursor for this operation; feed rows are staged before ledger insert and checked again at COMMIT.';

ALTER TABLE sensa.sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sync_mutable_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sync_append_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sync_replica_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  sensa.sync_operations,
  sensa.sync_mutable_changes,
  sensa.sync_append_facts,
  sensa.sync_replica_states
FROM PUBLIC, backend_app;

GRANT SELECT, INSERT ON TABLE
  sensa.sync_operations,
  sensa.sync_mutable_changes,
  sensa.sync_append_facts
TO backend_app;

GRANT SELECT, INSERT, UPDATE ON TABLE sensa.sync_replica_states TO backend_app;

DROP POLICY IF EXISTS sensa_sync_operations_select_runtime ON sensa.sync_operations;
DROP POLICY IF EXISTS sensa_sync_operations_insert_runtime ON sensa.sync_operations;
CREATE POLICY sensa_sync_operations_select_runtime
  ON sensa.sync_operations FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_sync_operations_insert_runtime
  ON sensa.sync_operations FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

DROP POLICY IF EXISTS sensa_sync_mutable_changes_select_runtime ON sensa.sync_mutable_changes;
DROP POLICY IF EXISTS sensa_sync_mutable_changes_insert_runtime ON sensa.sync_mutable_changes;
CREATE POLICY sensa_sync_mutable_changes_select_runtime
  ON sensa.sync_mutable_changes FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_sync_mutable_changes_insert_runtime
  ON sensa.sync_mutable_changes FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

DROP POLICY IF EXISTS sensa_sync_append_facts_select_runtime ON sensa.sync_append_facts;
DROP POLICY IF EXISTS sensa_sync_append_facts_insert_runtime ON sensa.sync_append_facts;
CREATE POLICY sensa_sync_append_facts_select_runtime
  ON sensa.sync_append_facts FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_sync_append_facts_insert_runtime
  ON sensa.sync_append_facts FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

DROP POLICY IF EXISTS sensa_sync_replica_states_select_runtime ON sensa.sync_replica_states;
DROP POLICY IF EXISTS sensa_sync_replica_states_insert_runtime ON sensa.sync_replica_states;
DROP POLICY IF EXISTS sensa_sync_replica_states_update_runtime ON sensa.sync_replica_states;
CREATE POLICY sensa_sync_replica_states_select_runtime
  ON sensa.sync_replica_states FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_sync_replica_states_insert_runtime
  ON sensa.sync_replica_states FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_sync_replica_states_update_runtime
  ON sensa.sync_replica_states FOR UPDATE TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

REVOKE ALL ON SEQUENCE
  sensa.sync_operation_acceptance_seq,
  sensa.sync_mutable_change_seq,
  sensa.sync_append_fact_seq
FROM PUBLIC, backend_app;
-- Sequence values are assigned by SECURITY DEFINER triggers.  backend_app
-- deliberately has no direct nextval/currval privilege on these identities.

REVOKE ALL ON FUNCTION sensa.assert_sync_replica_scope(UUID, UUID, TEXT) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_sync_cursor_high_water(BIGINT, BIGINT) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_sync_mutable_canonical(
  sensa.sync_mutable_entity_type, UUID, UUID, TEXT, BIGINT, sensa.sync_change_action
) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_sync_fact_canonical(
  sensa.sync_append_fact_type, UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_sync_operation_feed_bounds() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_sync_operation_ledger() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_sync_mutable_change() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_sync_append_fact() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_sync_replica_state() FROM PUBLIC, backend_app;
-- Schemas touched/read explicitly: sensa, org, sync, pg_catalog, public.
-- Migration status: Current / additive.
-- Introduces: immutable learner-local planning day snapshots and the database
-- gate that keeps new Study Plans on public-launch-eligible Books.

-- The planning snapshot is deliberately stored on the Encounter rather than
-- recomputed from the learner's current settings.  Existing rows are frozen
-- to UTC because no historical planning timezone was recorded before 0118.
ALTER TABLE sensa.sense_encounters
  ADD COLUMN IF NOT EXISTS planned_local_date DATE,
  ADD COLUMN IF NOT EXISTS planning_time_zone TEXT,
  ADD COLUMN IF NOT EXISTS planning_time_zone_source TEXT;

-- This migration only derives metadata from the immutable planned_at fact.
-- Hold the table lock while temporarily disabling the one 0116 lifecycle
-- trigger that would otherwise interpret this metadata-only UPDATE as a
-- learner lifecycle mutation.  The named trigger is restored in the same
-- transaction; any failure rolls back both the data and trigger state.
LOCK TABLE sensa.sense_encounters IN ACCESS EXCLUSIVE MODE;
ALTER TABLE sensa.sense_encounters DISABLE TRIGGER sensa_sense_encounters_lifecycle_guard;
UPDATE sensa.sense_encounters
SET planned_local_date = (planned_at AT TIME ZONE 'UTC')::DATE,
    planning_time_zone = 'UTC',
    planning_time_zone_source = 'utc_fallback'
WHERE planned_local_date IS NULL
   OR planning_time_zone IS NULL
   OR planning_time_zone_source IS NULL;
-- The metadata-only UPDATE still queues the 0116 deferred completion
-- consistency trigger.  Drain only that named constraint trigger before DDL
-- can inspect the table again; completion consistency remains enabled and its
-- validation is not bypassed.
-- SET CONSTRAINTS resolves constraint names through search_path (it does not
-- accept a schema-qualified constraint name), so scope that lookup narrowly.
SET LOCAL search_path = sensa, pg_catalog;
SET CONSTRAINTS sensa_sense_encounters_completion_consistency IMMEDIATE;
SET LOCAL search_path = pg_catalog, public;
ALTER TABLE sensa.sense_encounters ENABLE TRIGGER sensa_sense_encounters_lifecycle_guard;

ALTER TABLE sensa.sense_encounters
  ALTER COLUMN planned_local_date SET NOT NULL,
  ALTER COLUMN planning_time_zone SET NOT NULL,
  ALTER COLUMN planning_time_zone_source SET NOT NULL;

CREATE OR REPLACE FUNCTION sensa.is_valid_planning_time_zone(
  p_time_zone TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
  SELECT p_time_zone IS NOT NULL
    AND p_time_zone = btrim(p_time_zone)
    AND p_time_zone <> ''
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names AS zones
      WHERE zones.name = p_time_zone
    );
$$;

CREATE OR REPLACE FUNCTION sensa.derive_planning_local_date(
  p_planned_at TIMESTAMPTZ,
  p_time_zone TEXT
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF p_planned_at IS NULL OR NOT sensa.is_valid_planning_time_zone(p_time_zone) THEN
    RETURN NULL;
  END IF;
  RETURN (p_planned_at AT TIME ZONE p_time_zone)::DATE;
EXCEPTION
  WHEN OTHERS THEN
    -- CHECK constraints must fail closed for an invalid timezone instead of
    -- allowing a database error path to be interpreted as a valid snapshot.
    RETURN NULL;
END;
$$;

ALTER TABLE sensa.sense_encounters
  ADD CONSTRAINT sense_encounters_planning_source_valid
  CHECK (planning_time_zone_source IN ('client', 'user_settings', 'utc_fallback')),
  ADD CONSTRAINT sense_encounters_planning_time_zone_valid
  CHECK (sensa.is_valid_planning_time_zone(planning_time_zone)),
  ADD CONSTRAINT sense_encounters_planning_local_date_consistent
  CHECK (
    planned_local_date = sensa.derive_planning_local_date(
      planned_at,
      planning_time_zone
    )
  );

CREATE OR REPLACE FUNCTION sensa.guard_encounter_planning_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_derived_local_date DATE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Rows written by pre-0118 internal fixtures omitted the new columns.
    -- Preserve them safely as an explicit UTC fallback derived from planned_at.
    IF NEW.planning_time_zone IS NULL
      AND NEW.planning_time_zone_source IS NULL
      AND NEW.planned_local_date IS NULL THEN
      NEW.planning_time_zone := 'UTC';
      NEW.planning_time_zone_source := 'utc_fallback';
      NEW.planned_local_date := sensa.derive_planning_local_date(
        NEW.planned_at,
        NEW.planning_time_zone
      );
    ELSIF NEW.planning_time_zone IS NULL
      OR NEW.planning_time_zone_source IS NULL
      OR NEW.planned_local_date IS NULL THEN
      RAISE EXCEPTION 'Encounter planning timezone snapshot is incomplete'
        USING ERRCODE = '23514';
    END IF;

    v_derived_local_date := sensa.derive_planning_local_date(
      NEW.planned_at,
      NEW.planning_time_zone
    );
    IF v_derived_local_date IS NULL
      OR NEW.planned_local_date IS DISTINCT FROM v_derived_local_date THEN
      RAISE EXCEPTION 'Encounter planning local date does not match planned_at and timezone'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.planned_local_date IS DISTINCT FROM OLD.planned_local_date
    OR NEW.planning_time_zone IS DISTINCT FROM OLD.planning_time_zone
    OR NEW.planning_time_zone_source IS DISTINCT FROM OLD.planning_time_zone_source THEN
    RAISE EXCEPTION 'Encounter planning timezone snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sensa_sense_encounters_planning_snapshot_guard
  ON sensa.sense_encounters;
CREATE TRIGGER sensa_sense_encounters_planning_snapshot_guard
BEFORE INSERT OR UPDATE ON sensa.sense_encounters
FOR EACH ROW EXECUTE FUNCTION sensa.guard_encounter_planning_snapshot();

-- The planner counts today's introductions and reservations across the
-- learner's current planning scope.  Cancelled-before-open rows are absent
-- from this partial index predicate; interrupted rows retain opened_at and
-- therefore continue to count.
CREATE INDEX IF NOT EXISTS sensa_sense_encounters_new_quota_idx
  ON sensa.sense_encounters(
    workspace_id,
    learner_user_id,
    planned_local_date,
    sense_id,
    learning_session_id
  )
  WHERE kind = 'introduction'
    AND (status = 'planned' OR opened_at IS NOT NULL);

-- A Session has at most one resumable current Encounter.  Never reinterpret
-- historical lifecycle rows during migration: fail closed and report the
-- exact scope that must be reconciled before retrying 0118.
DO $$
DECLARE
  duplicate_scope TEXT;
BEGIN
  SELECT format(
    'learning_session_id=%s count=%s',
    learning_session_id,
    COUNT(*)
  )
    INTO duplicate_scope
  FROM sensa.sense_encounters
  WHERE status IN ('planned', 'active')
  GROUP BY learning_session_id
  HAVING COUNT(*) > 1
  ORDER BY learning_session_id
  LIMIT 1;
  IF duplicate_scope IS NOT NULL THEN
    RAISE EXCEPTION '0118 cannot create one-current-Encounter invariant; reconcile duplicate %', duplicate_scope
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sensa_sense_encounters_one_current_per_session
  ON sensa.sense_encounters(learning_session_id)
  WHERE status IN ('planned', 'active');

-- The Plan-row lock in the application service serializes normal starts.  Keep
-- the invariant at the storage boundary as well, but do not manufacture a
-- terminal interpretation for historical duplicate active Sessions.
DO $$
DECLARE
  duplicate_scope TEXT;
BEGIN
  SELECT format(
    'workspace_id=%s learner_user_id=%s study_plan_id=%s count=%s',
    workspace_id,
    learner_user_id,
    study_plan_id,
    COUNT(*)
  )
    INTO duplicate_scope
  FROM sensa.learning_sessions
  WHERE status = 'active'
  GROUP BY workspace_id, learner_user_id, study_plan_id
  HAVING COUNT(*) > 1
  ORDER BY workspace_id, learner_user_id, study_plan_id
  LIMIT 1;
  IF duplicate_scope IS NOT NULL THEN
    RAISE EXCEPTION '0118 cannot create one-active-Session invariant; reconcile duplicate %', duplicate_scope
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sensa_learning_sessions_one_active_per_plan
  ON sensa.learning_sessions(workspace_id, learner_user_id, study_plan_id)
  WHERE status = 'active';

-- Keep the complete public-catalog predicate behind one internal, read-only
-- SECURITY DEFINER helper.  The application module calls this after its
-- actionable status/count checks, while the helper can safely reuse the
-- validator-backed manifest function whose direct EXECUTE privilege remains
-- private to the database boundary.
CREATE OR REPLACE FUNCTION sensa.is_public_book_version_eligible(
  p_book_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM sensa.book_versions AS versions
    JOIN sensa.content_releases AS releases
      ON releases.content_release_id = versions.content_release_id
    WHERE versions.book_version_id = p_book_version_id
      AND versions.status = 'published'
      AND releases.status = 'published'
      AND EXISTS (
        SELECT 1
        FROM sensa.book_version_senses AS members
        WHERE members.book_version_id = versions.book_version_id
      )
      AND (
        SELECT COUNT(*)::INTEGER
        FROM sensa.book_version_senses AS members
        WHERE members.book_version_id = versions.book_version_id
      ) = (
        SELECT COUNT(approved_senses.sense_version_id)::INTEGER
        FROM sensa.book_version_senses AS members
        LEFT JOIN sensa.sense_versions AS approved_senses
          ON approved_senses.sense_version_id = members.sense_version_id
         AND approved_senses.content_release_id = versions.content_release_id
         AND approved_senses.review_status = 'approved'
        WHERE members.book_version_id = versions.book_version_id
      )
      AND (
        SELECT COUNT(DISTINCT stable_senses.lexeme_id)::INTEGER
        FROM sensa.book_version_senses AS members
        JOIN sensa.sense_versions AS member_versions
          ON member_versions.sense_version_id = members.sense_version_id
         AND member_versions.content_release_id = versions.content_release_id
         AND member_versions.review_status = 'approved'
        JOIN sensa.senses AS stable_senses
          ON stable_senses.sense_id = member_versions.sense_id
        WHERE members.book_version_id = versions.book_version_id
      ) >= 1000
      AND NOT EXISTS (
        SELECT 1
        FROM sensa.book_version_senses AS members
        WHERE members.book_version_id = versions.book_version_id
          AND NOT sensa.book_member_manifest_satisfied(
            versions.book_version_id,
            members.sense_version_id,
            versions.content_release_id
          )
      )
  );
$$;

COMMENT ON COLUMN sensa.sense_encounters.planned_local_date IS
  'Immutable learner-local calendar date captured when the Encounter was planned.';
COMMENT ON COLUMN sensa.sense_encounters.planning_time_zone IS
  'Immutable IANA timezone used to derive planned_local_date.';
COMMENT ON COLUMN sensa.sense_encounters.planning_time_zone_source IS
  'Immutable source of planning_time_zone: client, user_settings, or utc_fallback.';

-- CHECK constraints invoke these SECURITY DEFINER helpers while a backend_app
-- row is being written.  EXECUTE is therefore required for constraint
-- evaluation; the helpers themselves remain read-only and fail closed.
REVOKE EXECUTE ON FUNCTION sensa.is_valid_planning_time_zone(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sensa.derive_planning_local_date(TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sensa.is_valid_planning_time_zone(TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION sensa.derive_planning_local_date(TIMESTAMPTZ, TEXT) TO backend_app;
REVOKE EXECUTE ON FUNCTION sensa.is_public_book_version_eligible(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sensa.is_public_book_version_eligible(UUID) TO backend_app;
-- Schemas touched/read explicitly: sensa, org, sync, security, pg_catalog.
-- Migration status: Current / additive.
-- Introduces: the learner-scoped, reversible Learner-Declared Mastery entity
-- and the additive sensa-sync-v2 operation/feed vocabulary.  The frozen
-- sensa-sync-v1 tables and wire shapes remain valid; v1 replicas skip the
-- v2-only mutable entity while advancing their cursor.

CREATE TABLE IF NOT EXISTS sensa.learner_declared_masteries (
  learner_declared_mastery_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  learner_user_id TEXT NOT NULL,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  is_mastered BOOLEAN NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_by_replica_id UUID NOT NULL
    REFERENCES sync.workspace_replicas(replica_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  declared_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learner_declared_masteries_learner_nonempty CHECK (btrim(learner_user_id) <> ''),
  CONSTRAINT learner_declared_masteries_revision_positive CHECK (revision > 0),
  CONSTRAINT learner_declared_masteries_timestamp_order CHECK (
    created_at <= updated_at
    AND declared_at <= updated_at
    AND (revoked_at IS NULL OR declared_at <= revoked_at)
  ),
  CONSTRAINT learner_declared_masteries_state_timestamp_shape CHECK (
    (is_mastered AND revoked_at IS NULL)
    OR (NOT is_mastered AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT learner_declared_masteries_scope_unique
    UNIQUE (workspace_id, learner_user_id, sense_id)
);

CREATE INDEX IF NOT EXISTS learner_declared_masteries_scope_state_idx
  ON sensa.learner_declared_masteries(workspace_id, learner_user_id, sense_id)
  WHERE is_mastered;

CREATE OR REPLACE FUNCTION sensa.guard_learner_declared_mastery()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_sync_replica_scope(
      NEW.created_by_replica_id, NEW.workspace_id, NEW.learner_user_id
    );
    IF NOT EXISTS (
      SELECT 1 FROM sensa.senses WHERE sense_id = NEW.sense_id
    ) THEN
      RAISE EXCEPTION 'Learner-Declared Mastery references an unknown Sense'
        USING ERRCODE = '23503';
    END IF;
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Learner-Declared Mastery must start at revision 1'
        USING ERRCODE = '23514';
    END IF;
    NEW.created_at := COALESCE(NEW.created_at, statement_timestamp());
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at);
    NEW.declared_at := COALESCE(NEW.declared_at, NEW.created_at);
    IF NEW.is_mastered THEN
      NEW.revoked_at := NULL;
    ELSE
      NEW.revoked_at := COALESCE(NEW.revoked_at, NEW.updated_at);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Ordinary undo is an UPDATE.  Account/Workspace cleanup may still
    -- cascade through this row at the owner boundary.
    RETURN OLD;
  END IF;

  IF NEW.learner_declared_mastery_id IS DISTINCT FROM OLD.learner_declared_mastery_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.sense_id IS DISTINCT FROM OLD.sense_id
    OR NEW.created_by_replica_id IS DISTINCT FROM OLD.created_by_replica_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Learner-Declared Mastery identity and scope are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.revision <= 0 THEN
    RAISE EXCEPTION 'Learner-Declared Mastery has an invalid current revision'
      USING ERRCODE = '23514';
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := statement_timestamp();
  IF NEW.is_mastered THEN
    NEW.declared_at := COALESCE(NEW.declared_at, NEW.updated_at);
    NEW.revoked_at := NULL;
  ELSE
    NEW.declared_at := OLD.declared_at;
    NEW.revoked_at := COALESCE(NEW.revoked_at, NEW.updated_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sensa_learner_declared_mastery_guard
  ON sensa.learner_declared_masteries;
CREATE TRIGGER sensa_learner_declared_mastery_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.learner_declared_masteries
FOR EACH ROW EXECUTE FUNCTION sensa.guard_learner_declared_mastery();

ALTER TABLE sensa.learner_declared_masteries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sensa.learner_declared_masteries FROM PUBLIC, backend_app;
GRANT SELECT, INSERT, UPDATE ON TABLE sensa.learner_declared_masteries TO backend_app;

DROP POLICY IF EXISTS sensa_learner_declared_masteries_select_runtime
  ON sensa.learner_declared_masteries;
DROP POLICY IF EXISTS sensa_learner_declared_masteries_insert_runtime
  ON sensa.learner_declared_masteries;
DROP POLICY IF EXISTS sensa_learner_declared_masteries_update_runtime
  ON sensa.learner_declared_masteries;
CREATE POLICY sensa_learner_declared_masteries_select_runtime
  ON sensa.learner_declared_masteries FOR SELECT TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learner_declared_masteries_insert_runtime
  ON sensa.learner_declared_masteries FOR INSERT TO backend_app
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );
CREATE POLICY sensa_learner_declared_masteries_update_runtime
  ON sensa.learner_declared_masteries FOR UPDATE TO backend_app
  USING (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    learner_user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

COMMENT ON TABLE sensa.learner_declared_masteries IS
  'Learner x Sense explicit, reversible declaration that the learner already masters the Sense. It is not a 5D projection or FSRS state.';
COMMENT ON COLUMN sensa.learner_declared_masteries.declared_at IS
  'Timestamp of the current or most recent learner declaration; restored mastery receives a new declaration timestamp.';
COMMENT ON COLUMN sensa.learner_declared_masteries.revoked_at IS
  'Timestamp of the current revocation; NULL while the declaration is active. Undo updates the same entity and clears this value.';

-- Additive v2 vocabulary.  Existing v1 enum values and table rows are not
-- rewritten, and no generic sync enum/table is touched.
ALTER TYPE sensa.sync_operation_kind
  ADD VALUE IF NOT EXISTS 'learner_declared_mastery.set';
ALTER TYPE sensa.sync_mutable_entity_type
  ADD VALUE IF NOT EXISTS 'learner_declared_mastery';

ALTER TABLE sensa.sync_operations
  DROP CONSTRAINT IF EXISTS sync_operations_wire_version,
  DROP CONSTRAINT IF EXISTS sync_operations_canonicalizer_version,
  DROP CONSTRAINT IF EXISTS sync_operations_result_schema_version;
ALTER TABLE sensa.sync_operations
  ADD CONSTRAINT sync_operations_wire_version CHECK (
    wire_version IN ('sensa-sync-v1', 'sensa-sync-v2')
  ),
  ADD CONSTRAINT sync_operations_canonicalizer_version CHECK (
    canonicalizer_version IN ('sensa-sync-v1', 'sensa-sync-v2')
  ),
  ADD CONSTRAINT sync_operations_result_schema_version CHECK (
    result_schema_version IN ('sensa-sync-result-v1', 'sensa-sync-result-v2')
  );

ALTER TABLE sensa.sync_replica_states
  DROP CONSTRAINT IF EXISTS sync_replica_states_wire_version;
ALTER TABLE sensa.sync_replica_states
  ADD CONSTRAINT sync_replica_states_wire_version CHECK (
    wire_version IN ('sensa-sync-v1', 'sensa-sync-v2')
  );

CREATE OR REPLACE FUNCTION sensa.assert_sync_mutable_canonical(
  p_entity_type sensa.sync_mutable_entity_type,
  p_entity_id UUID,
  p_workspace_id UUID,
  p_learner_user_id TEXT,
  p_entity_revision BIGINT,
  p_action sensa.sync_change_action
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  v_workspace_id UUID;
  v_learner_user_id TEXT;
  v_revision BIGINT;
BEGIN
  CASE p_entity_type
    WHEN 'study_plan' THEN
      SELECT plans.workspace_id, plans.learner_user_id, plans.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.study_plans AS plans
      WHERE plans.study_plan_id = p_entity_id;
    WHEN 'learning_session' THEN
      SELECT sessions.workspace_id, sessions.learner_user_id, sessions.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.learning_sessions AS sessions
      WHERE sessions.learning_session_id = p_entity_id;
    WHEN 'sense_encounter' THEN
      SELECT encounters.workspace_id, encounters.learner_user_id, encounters.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.sense_encounters AS encounters
      WHERE encounters.sense_encounter_id = p_entity_id;
    WHEN 'learner_semantic_state' THEN
      SELECT states.workspace_id, states.learner_user_id, states.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.learner_semantic_states AS states
      WHERE states.learner_semantic_state_id = p_entity_id;
    WHEN 'sense_memory_state' THEN
      SELECT states.workspace_id, states.learner_user_id, states.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.sense_memory_states AS states
      WHERE states.sense_memory_state_id = p_entity_id;
    WHEN 'learner_declared_mastery' THEN
      SELECT masteries.workspace_id, masteries.learner_user_id, masteries.revision
        INTO v_workspace_id, v_learner_user_id, v_revision
      FROM sensa.learner_declared_masteries AS masteries
      WHERE masteries.learner_declared_mastery_id = p_entity_id;
  END CASE;

  IF NOT FOUND THEN
    IF p_action = 'tombstone' THEN RETURN; END IF;
    RAISE EXCEPTION 'Sensa Sync upsert references a missing % %', p_entity_type, p_entity_id
      USING ERRCODE = '23503';
  END IF;
  IF v_workspace_id IS DISTINCT FROM p_workspace_id
    OR v_learner_user_id IS DISTINCT FROM p_learner_user_id THEN
    RAISE EXCEPTION 'Sensa Sync mutable change crosses learner or Workspace scope'
      USING ERRCODE = '23514';
  END IF;
  IF v_revision IS DISTINCT FROM p_entity_revision THEN
    RAISE EXCEPTION 'Sensa Sync mutable change revision does not match canonical row'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

-- Permit only the safe one-way v1 -> v2 transition when the replica is put
-- back into bootstrap-required state.  The v2 bootstrap then rotates the
-- epoch and acknowledges one complete authoritative snapshot.  Downgrade and
-- in-place cursor changes remain forbidden.
CREATE OR REPLACE FUNCTION sensa.guard_sync_replica_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sensa.assert_sync_replica_scope(
      NEW.replica_id, NEW.workspace_id, NEW.learner_user_id
    );
    IF NEW.bootstrap_epoch <> 1
      OR NOT NEW.bootstrap_required
      OR NEW.bootstrap_mutable_cursor <> 0
      OR NEW.bootstrap_fact_cursor <> 0
      OR NEW.acknowledged_mutable_cursor <> 0
      OR NEW.acknowledged_fact_cursor <> 0
      OR NEW.bootstrapped_at IS NOT NULL
      OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Sensa Sync replica state must start in bootstrap-required epoch 1'
        USING ERRCODE = '23514';
    END IF;
    PERFORM sensa.assert_sync_cursor_high_water(0, 0);
    NEW.created_at := statement_timestamp();
    NEW.bootstrapped_at := NULL;
    NEW.last_pulled_at := NULL;
    NEW.last_pushed_at := NULL;
    NEW.revision := 1;
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.replica_id IS DISTINCT FROM OLD.replica_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sensa Sync replica state identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.wire_version IS DISTINCT FROM OLD.wire_version THEN
    IF OLD.wire_version <> 'sensa-sync-v1'
      OR NEW.wire_version <> 'sensa-sync-v2'
      OR NOT NEW.bootstrap_required
      OR NEW.bootstrap_epoch <> OLD.bootstrap_epoch
      OR NEW.bootstrap_mutable_cursor IS DISTINCT FROM OLD.bootstrap_mutable_cursor
      OR NEW.bootstrap_fact_cursor IS DISTINCT FROM OLD.bootstrap_fact_cursor
      OR NEW.acknowledged_mutable_cursor IS DISTINCT FROM OLD.acknowledged_mutable_cursor
      OR NEW.acknowledged_fact_cursor IS DISTINCT FROM OLD.acknowledged_fact_cursor THEN
      RAISE EXCEPTION 'Sensa Sync replicas support only a one-way v1 to v2 upgrade at bootstrap'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (OLD.last_pulled_at IS NOT NULL AND NEW.last_pulled_at IS NULL)
    OR (OLD.last_pulled_at IS NOT NULL AND NEW.last_pulled_at < OLD.last_pulled_at)
    OR (OLD.last_pushed_at IS NOT NULL AND NEW.last_pushed_at IS NULL)
    OR (OLD.last_pushed_at IS NOT NULL AND NEW.last_pushed_at < OLD.last_pushed_at) THEN
    RAISE EXCEPTION 'Sensa Sync replica timestamps cannot move backward'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.last_pulled_at IS DISTINCT FROM OLD.last_pulled_at THEN
    NEW.last_pulled_at := statement_timestamp();
  END IF;
  IF NEW.last_pushed_at IS DISTINCT FROM OLD.last_pushed_at THEN
    NEW.last_pushed_at := statement_timestamp();
  END IF;

  IF NEW.bootstrap_epoch < OLD.bootstrap_epoch
    OR (
      NEW.bootstrap_epoch = OLD.bootstrap_epoch
      AND (
        NEW.bootstrap_mutable_cursor < OLD.bootstrap_mutable_cursor
        OR NEW.bootstrap_fact_cursor < OLD.bootstrap_fact_cursor
        OR NEW.acknowledged_mutable_cursor < OLD.acknowledged_mutable_cursor
        OR NEW.acknowledged_fact_cursor < OLD.acknowledged_fact_cursor
      )
    ) THEN
    RAISE EXCEPTION 'Sensa Sync cursor regression is not allowed'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.bootstrap_epoch > OLD.bootstrap_epoch + 1 THEN
    RAISE EXCEPTION 'Sensa Sync bootstrap epochs must advance by one'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.bootstrap_mutable_cursor > NEW.acknowledged_mutable_cursor
    OR NEW.bootstrap_fact_cursor > NEW.acknowledged_fact_cursor THEN
    RAISE EXCEPTION 'Sensa Sync acknowledged cursors cannot precede bootstrap cursors'
      USING ERRCODE = '23514';
  END IF;
  PERFORM sensa.assert_sync_cursor_high_water(
    NEW.acknowledged_mutable_cursor, NEW.acknowledged_fact_cursor
  );
  PERFORM sensa.assert_sync_cursor_high_water(
    NEW.bootstrap_mutable_cursor, NEW.bootstrap_fact_cursor
  );

  IF NEW.bootstrap_epoch = OLD.bootstrap_epoch THEN
    IF OLD.bootstrap_required AND NOT NEW.bootstrap_required
      AND NEW.wire_version IS NOT DISTINCT FROM OLD.wire_version THEN
      RAISE EXCEPTION 'Sensa Sync bootstrap completion must rotate the epoch'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.bootstrap_required THEN
      IF NEW.bootstrap_mutable_cursor IS DISTINCT FROM OLD.bootstrap_mutable_cursor
        OR NEW.bootstrap_fact_cursor IS DISTINCT FROM OLD.bootstrap_fact_cursor
        OR NEW.acknowledged_mutable_cursor IS DISTINCT FROM OLD.acknowledged_mutable_cursor
        OR NEW.acknowledged_fact_cursor IS DISTINCT FROM OLD.acknowledged_fact_cursor
        OR NEW.bootstrapped_at IS DISTINCT FROM OLD.bootstrapped_at THEN
        RAISE EXCEPTION 'A Sensa Sync bootstrap-required state cannot alter cursors in the same epoch'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.bootstrap_mutable_cursor IS DISTINCT FROM OLD.bootstrap_mutable_cursor
      OR NEW.bootstrap_fact_cursor IS DISTINCT FROM OLD.bootstrap_fact_cursor
      OR NEW.bootstrapped_at IS DISTINCT FROM OLD.bootstrapped_at THEN
      RAISE EXCEPTION 'Sensa Sync bootstrap cursors are immutable after successful bootstrap'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.bootstrap_epoch <> OLD.bootstrap_epoch + 1
      OR NOT OLD.bootstrap_required
      OR NEW.bootstrap_required
      OR NEW.bootstrapped_at IS NULL
      OR NEW.bootstrap_mutable_cursor < OLD.acknowledged_mutable_cursor
      OR NEW.bootstrap_fact_cursor < OLD.acknowledged_fact_cursor
      OR NEW.acknowledged_mutable_cursor <> NEW.bootstrap_mutable_cursor
      OR NEW.acknowledged_fact_cursor <> NEW.bootstrap_fact_cursor THEN
      RAISE EXCEPTION 'Sensa Sync rebootstrap must rotate from required state and acknowledge its snapshot'
        USING ERRCODE = '23514';
    END IF;
    NEW.bootstrapped_at := statement_timestamp();
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

COMMENT ON TABLE sensa.sync_operations IS
  'Versioned Sensa Sync operation ledger. sensa-sync-v1 rows retain their frozen result shape; sensa-sync-v2 adds Learner-Declared Mastery.';
COMMENT ON TABLE sensa.sync_mutable_changes IS
  'Versioned Sensa Sync mutable feed. v1 replicas skip v2-only entity types while advancing the shared cursor.';

REVOKE ALL ON FUNCTION sensa.guard_learner_declared_mastery() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_sync_mutable_canonical(
  sensa.sync_mutable_entity_type, UUID, UUID, TEXT, BIGINT, sensa.sync_change_action
) FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_sync_replica_state() FROM PUBLIC, backend_app;
