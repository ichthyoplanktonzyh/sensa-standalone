-- Canonical semantic registry v1.
--
-- The pre-redesign schema attached every Sense to one Lexeme and every Sense
-- Version to one published Content Release.  The canonical model reverses
-- those dependencies: Sense is a stable semantic identity, expressions are
-- typed language forms, and their many-to-many relation is versioned.  The
-- legacy columns remain readable while production runtime migrates.

DO $$
BEGIN
  CREATE TYPE sensa.sense_version_origin AS ENUM (
    'learner_confirmed',
    'published_release',
    'editorial',
    'imported'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.semantic_review_status AS ENUM (
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
  CREATE TYPE sensa.expression_type AS ENUM (
    'word',
    'phrase',
    'construction',
    'sentence',
    'utterance_strategy'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.expression_binding_relation AS ENUM (
    'realizes',
    'approximates',
    'evokes'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE sensa.semantic_coverage AS ENUM (
    'exact',
    'broader',
    'narrower',
    'overlapping'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE sensa.senses
  ALTER COLUMN lexeme_id DROP NOT NULL;

COMMENT ON COLUMN sensa.senses.lexeme_id IS
  'Legacy published-content compatibility only. Canonical Sense identity is independent of any Lexeme.';

ALTER TABLE sensa.sense_versions
  ALTER COLUMN content_release_id DROP NOT NULL,
  ALTER COLUMN sense_rank DROP NOT NULL,
  ALTER COLUMN part_of_speech DROP NOT NULL,
  ALTER COLUMN guide_label_l1 DROP NOT NULL,
  ALTER COLUMN definition_l2 DROP NOT NULL,
  ALTER COLUMN teaching_priority DROP NOT NULL,
  ALTER COLUMN teaching_priority DROP DEFAULT,
  ALTER COLUMN inventory_version DROP NOT NULL,
  ALTER COLUMN evidence_digest DROP NOT NULL,
  ALTER COLUMN identity_digest DROP NOT NULL,
  ADD COLUMN version_number INTEGER,
  ADD COLUMN version_origin sensa.sense_version_origin,
  ADD COLUMN semantic_policy_version TEXT,
  ADD COLUMN semantic_spec JSONB,
  ADD COLUMN semantic_provenance JSONB,
  ADD COLUMN semantic_review_status sensa.semantic_review_status;

WITH ranked AS (
  SELECT sense_version_id,
         row_number() OVER (
           PARTITION BY sense_id
           ORDER BY created_at, sense_version_id
         )::INTEGER AS version_number
  FROM sensa.sense_versions
)
UPDATE sensa.sense_versions AS versions
SET version_number = ranked.version_number,
    version_origin = 'published_release',
    semantic_policy_version = 'legacy-published-semantic-policy-v1',
    semantic_spec = jsonb_build_object(
      'schemaVersion', 'sensa-sense-semantic-spec-v1',
      'coreMeaningFocus', versions.guide_label_l1,
      'prototypeScenes', jsonb_build_array(jsonb_build_object(
        'summary', versions.definition_l2,
        'participantRoles', '[]'::jsonb,
        'states', '[]'::jsonb,
        'directionOrCausality', NULL
      )),
      'includedCases', '[]'::jsonb,
      'excludedCases', '[]'::jsonb,
      'neighborContrasts', '[]'::jsonb,
      'openQuestions', '[]'::jsonb
    ),
    semantic_provenance = jsonb_build_object(
      'sourceKind', 'published_release',
      'sourceReferenceIds', jsonb_build_array(versions.content_release_id::TEXT),
      'generator', NULL
    ),
    semantic_review_status = CASE versions.review_status
      WHEN 'rejected' THEN 'rejected'::sensa.semantic_review_status
      ELSE 'reviewed'::sensa.semantic_review_status
    END
FROM ranked
WHERE versions.sense_version_id = ranked.sense_version_id;

ALTER TABLE sensa.sense_versions
  ALTER COLUMN version_number SET NOT NULL,
  ALTER COLUMN version_origin SET NOT NULL,
  ALTER COLUMN semantic_policy_version SET NOT NULL,
  ALTER COLUMN semantic_spec SET NOT NULL,
  ALTER COLUMN semantic_provenance SET NOT NULL,
  ALTER COLUMN semantic_review_status SET NOT NULL,
  ADD CONSTRAINT sense_versions_number_positive CHECK (version_number > 0),
  ADD CONSTRAINT sense_versions_identity_version_unique UNIQUE (sense_id, version_number),
  ADD CONSTRAINT sense_versions_semantic_policy_nonempty CHECK (
    btrim(semantic_policy_version) <> ''
  ),
  ADD CONSTRAINT sense_versions_semantic_spec_object CHECK (
    jsonb_typeof(semantic_spec) = 'object'
  ),
  ADD CONSTRAINT sense_versions_semantic_provenance_object CHECK (
    jsonb_typeof(semantic_provenance) = 'object'
  ),
  ADD CONSTRAINT sense_versions_origin_shape CHECK (
    (version_origin = 'published_release' AND content_release_id IS NOT NULL)
    OR (version_origin <> 'published_release' AND content_release_id IS NULL)
  ),
  ADD CONSTRAINT sense_versions_published_compatibility_shape CHECK (
    version_origin <> 'published_release'
    OR (
      sense_rank IS NOT NULL
      AND part_of_speech IS NOT NULL
      AND guide_label_l1 IS NOT NULL
      AND definition_l2 IS NOT NULL
      AND teaching_priority IS NOT NULL
      AND inventory_version IS NOT NULL
      AND evidence_digest IS NOT NULL
      AND identity_digest IS NOT NULL
    )
  );

COMMENT ON COLUMN sensa.sense_versions.content_release_id IS
  'Published-content compatibility. Learner-confirmed/editorial versions are reproducible semantic facts without a Content Release.';
COMMENT ON COLUMN sensa.sense_versions.semantic_spec IS
  'Immutable, privacy-safe semantic boundary. Raw Personal Meaning, conversation, names and personal media are forbidden.';

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
  ) THEN
    RAISE EXCEPTION 'Versioned Sense identities are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
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
  IF NOT EXISTS (
    SELECT 1 FROM sensa.senses WHERE sense_id = NEW.sense_id
  ) THEN
    RAISE EXCEPTION 'Sensa Sense Version % has no stable Sense identity', NEW.sense_version_id
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.version_origin <> 'published_release' THEN
    RAISE EXCEPTION 'Non-release Sense Versions are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version_origin <> 'published_release' THEN
    IF NEW.content_release_id IS NOT NULL THEN
      RAISE EXCEPTION 'Non-release Sense Versions cannot claim a Content Release'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM sensa.assert_release_mutable(NEW.content_release_id);

  SELECT senses.lexeme_id, lexemes.language_tag
    INTO sense_lexeme, lexeme_language
  FROM sensa.senses AS senses
  JOIN sensa.lexemes AS lexemes ON lexemes.lexeme_id = senses.lexeme_id
  WHERE senses.sense_id = NEW.sense_id;
  IF sense_lexeme IS NULL THEN
    RAISE EXCEPTION 'Published Sensa Sense % has no legacy Lexeme identity', NEW.sense_id
      USING ERRCODE = '23503';
  END IF;

  SELECT target_language INTO release_target_language
  FROM sensa.content_releases
  WHERE content_release_id = NEW.content_release_id;
  IF lexeme_language IS DISTINCT FROM release_target_language THEN
    RAISE EXCEPTION 'Sensa Lexeme language % does not match release target language %',
      lexeme_language, release_target_language
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sensa.lexeme_versions
    WHERE content_release_id = NEW.content_release_id
      AND lexeme_id = sense_lexeme
  ) THEN
    RAISE EXCEPTION 'Sensa Sense % has no Lexeme Version in release %',
      NEW.sense_id, NEW.content_release_id
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
    RAISE EXCEPTION 'Sensa Sense rank % is duplicated for Lexeme % in release %',
      NEW.sense_rank, sense_lexeme, NEW.content_release_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sensa.guard_sense_version_release_or_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.version_origin <> 'published_release' THEN
      RAISE EXCEPTION 'Non-release Sense Versions are immutable'
        USING ERRCODE = '23514';
    END IF;
    PERFORM sensa.assert_release_mutable(OLD.content_release_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.version_origin <> 'published_release' THEN
      RAISE EXCEPTION 'Non-release Sense Versions are immutable'
        USING ERRCODE = '23514';
    END IF;
    PERFORM sensa.assert_release_mutable(OLD.content_release_id);
  END IF;

  IF NEW.version_origin = 'published_release' THEN
    PERFORM sensa.assert_release_mutable(NEW.content_release_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER sense_versions_release_immutable_guard ON sensa.sense_versions;
CREATE TRIGGER sense_versions_release_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON sensa.sense_versions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_sense_version_release_or_fact();

CREATE TABLE sensa.expressions (
  expression_id UUID PRIMARY KEY,
  expression_type sensa.expression_type NOT NULL,
  language_tag TEXT NOT NULL,
  lexeme_id UUID REFERENCES sensa.lexemes(lexeme_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expressions_language_nonempty CHECK (btrim(language_tag) <> ''),
  CONSTRAINT expressions_lexeme_shape CHECK (
    lexeme_id IS NULL OR expression_type = 'word'
  )
);

CREATE TABLE sensa.expression_versions (
  expression_version_id UUID PRIMARY KEY,
  expression_id UUID NOT NULL REFERENCES sensa.expressions(expression_id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  surface_form TEXT NOT NULL,
  normalized_form TEXT NOT NULL,
  structure JSONB NOT NULL DEFAULT '{}'::jsonb,
  semantic_provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expression_versions_number_positive CHECK (version_number > 0),
  CONSTRAINT expression_versions_surface_nonempty CHECK (btrim(surface_form) <> ''),
  CONSTRAINT expression_versions_normalized_nonempty CHECK (btrim(normalized_form) <> ''),
  CONSTRAINT expression_versions_structure_object CHECK (jsonb_typeof(structure) = 'object'),
  CONSTRAINT expression_versions_provenance_object CHECK (
    jsonb_typeof(semantic_provenance) = 'object'
  ),
  CONSTRAINT expression_versions_identity_version_unique UNIQUE (
    expression_id, version_number
  )
);

CREATE TABLE sensa.sense_expression_bindings (
  sense_expression_binding_id UUID PRIMARY KEY,
  sense_id UUID NOT NULL REFERENCES sensa.senses(sense_id) ON DELETE RESTRICT,
  expression_id UUID NOT NULL REFERENCES sensa.expressions(expression_id) ON DELETE RESTRICT,
  relation sensa.expression_binding_relation NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sense_expression_bindings_identity_unique UNIQUE (
    sense_id, expression_id, relation
  )
);

CREATE TABLE sensa.sense_expression_binding_versions (
  binding_version_id UUID PRIMARY KEY,
  sense_expression_binding_id UUID NOT NULL
    REFERENCES sensa.sense_expression_bindings(sense_expression_binding_id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions(sense_version_id) ON DELETE RESTRICT,
  expression_version_id UUID NOT NULL
    REFERENCES sensa.expression_versions(expression_version_id) ON DELETE RESTRICT,
  semantic_coverage sensa.semantic_coverage NOT NULL,
  register_label TEXT,
  usage_constraints TEXT[] NOT NULL DEFAULT '{}',
  semantic_provenance JSONB NOT NULL,
  semantic_review_status sensa.semantic_review_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT binding_versions_number_positive CHECK (version_number > 0),
  CONSTRAINT binding_versions_register_nonempty CHECK (
    register_label IS NULL OR btrim(register_label) <> ''
  ),
  CONSTRAINT binding_versions_usage_constraints_nonempty CHECK (
    cardinality(usage_constraints) = 0
    OR sensa.array_has_nonempty_text(usage_constraints)
  ),
  CONSTRAINT binding_versions_provenance_object CHECK (
    jsonb_typeof(semantic_provenance) = 'object'
  ),
  CONSTRAINT binding_versions_identity_version_unique UNIQUE (
    sense_expression_binding_id, version_number
  )
);

CREATE OR REPLACE FUNCTION sensa.guard_immutable_semantic_row()
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

CREATE OR REPLACE FUNCTION sensa.assert_binding_version_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
DECLARE
  expected_sense_id UUID;
  expected_expression_id UUID;
  actual_sense_id UUID;
  actual_expression_id UUID;
BEGIN
  SELECT bindings.sense_id, bindings.expression_id
    INTO expected_sense_id, expected_expression_id
  FROM sensa.sense_expression_bindings AS bindings
  WHERE bindings.sense_expression_binding_id = NEW.sense_expression_binding_id;

  SELECT versions.sense_id INTO actual_sense_id
  FROM sensa.sense_versions AS versions
  WHERE versions.sense_version_id = NEW.sense_version_id;

  SELECT versions.expression_id INTO actual_expression_id
  FROM sensa.expression_versions AS versions
  WHERE versions.expression_version_id = NEW.expression_version_id;

  IF expected_sense_id IS NULL OR expected_expression_id IS NULL
    OR actual_sense_id IS DISTINCT FROM expected_sense_id
    OR actual_expression_id IS DISTINCT FROM expected_expression_id THEN
    RAISE EXCEPTION 'Binding Version does not pin versions of its stable Sense and Expression'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expressions_immutable_identity_guard
BEFORE UPDATE ON sensa.expressions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_semantic_row();

CREATE TRIGGER expression_versions_immutable_guard
BEFORE UPDATE ON sensa.expression_versions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_semantic_row();

CREATE TRIGGER sense_expression_bindings_immutable_identity_guard
BEFORE UPDATE ON sensa.sense_expression_bindings
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_semantic_row();

CREATE TRIGGER binding_versions_identity_guard
BEFORE INSERT OR UPDATE ON sensa.sense_expression_binding_versions
FOR EACH ROW EXECUTE FUNCTION sensa.assert_binding_version_identity();

CREATE TRIGGER binding_versions_immutable_guard
BEFORE UPDATE ON sensa.sense_expression_binding_versions
FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_semantic_row();

ALTER TABLE sensa.expressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.expression_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_expression_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa.sense_expression_binding_versions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE
  sensa.expressions,
  sensa.expression_versions,
  sensa.sense_expression_bindings,
  sensa.sense_expression_binding_versions
TO backend_app;

CREATE POLICY senses_backend_nonrelease_select
  ON sensa.senses FOR SELECT TO backend_app
  USING (EXISTS (
    SELECT 1 FROM sensa.sense_versions AS versions
    WHERE versions.sense_id = senses.sense_id
      AND versions.content_release_id IS NULL
      AND versions.semantic_review_status <> 'rejected'
  ));

CREATE POLICY sense_versions_backend_nonrelease_select
  ON sensa.sense_versions FOR SELECT TO backend_app
  USING (
    content_release_id IS NULL
    AND semantic_review_status <> 'rejected'
  );

CREATE POLICY expressions_backend_select
  ON sensa.expressions FOR SELECT TO backend_app USING (true);
CREATE POLICY expression_versions_backend_select
  ON sensa.expression_versions FOR SELECT TO backend_app USING (true);
CREATE POLICY sense_expression_bindings_backend_select
  ON sensa.sense_expression_bindings FOR SELECT TO backend_app USING (true);
CREATE POLICY binding_versions_backend_select
  ON sensa.sense_expression_binding_versions FOR SELECT TO backend_app
  USING (semantic_review_status <> 'rejected');

COMMENT ON TABLE sensa.expressions IS
  'Stable typed language expressions. Familiar/target learner roles never belong to this public identity.';
COMMENT ON TABLE sensa.sense_expression_bindings IS
  'Stable directed Sense-to-Expression relations; never reversible translation equality.';
COMMENT ON TABLE sensa.sense_expression_binding_versions IS
  'Immutable relation versions pinning exact Sense and Expression Versions.';

REVOKE ALL ON FUNCTION sensa.guard_sense_version_release_or_fact() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.guard_immutable_semantic_row() FROM PUBLIC, backend_app;
REVOKE ALL ON FUNCTION sensa.assert_binding_version_identity() FROM PUBLIC, backend_app;
