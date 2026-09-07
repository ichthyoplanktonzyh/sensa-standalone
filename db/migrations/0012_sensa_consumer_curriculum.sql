CREATE TABLE sensa_consumer.published_media (
  digest TEXT PRIMARY KEY CHECK(digest ~ '^[0-9a-f]{64}$'),
  source_text_digest TEXT NOT NULL CHECK(source_text_digest ~ '^[0-9a-f]{64}$'),
  mime_type TEXT NOT NULL CHECK(mime_type='audio/mpeg'),
  byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=2097152),
  producer TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON sensa_consumer.published_media TO backend_app;
-- Published inputs are provisioned by a controlled content publisher, never a client.
CREATE TABLE sensa_consumer.catalog_candidates (
  id UUID PRIMARY KEY, sense_id UUID NOT NULL REFERENCES sensa.senses,
  sense_version_id UUID NOT NULL REFERENCES sensa.sense_versions,
  binding_id UUID NOT NULL REFERENCES sensa.sense_expression_bindings,
  binding_version_id UUID NOT NULL REFERENCES sensa.sense_expression_binding_versions,
  expression TEXT NOT NULL, meaning TEXT NOT NULL, target_language TEXT NOT NULL,
  familiar_language TEXT NOT NULL, learner_locale TEXT NOT NULL,
  source JSONB NOT NULL, admission TEXT NOT NULL CHECK(admission IN ('available','reference_only','unsupported')),
  content JSONB NOT NULL, content_digest TEXT NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  review_reference TEXT NOT NULL CHECK(length(review_reference)>0),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER consumer_catalog_immutable BEFORE UPDATE ON sensa_consumer.catalog_candidates
  FOR EACH ROW EXECUTE FUNCTION sensa.guard_immutable_semantic_row();
CREATE TABLE sensa_consumer.learner_scopes (
  learner_user_id TEXT PRIMARY KEY REFERENCES sensa_consumer.accounts(learner_user_id),
  workspace_id UUID UNIQUE NOT NULL REFERENCES org.workspaces
);
CREATE TABLE sensa_consumer.target_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
  retention_target_id UUID NOT NULL UNIQUE REFERENCES sensa.retention_targets,
  learning_target_id UUID NOT NULL UNIQUE REFERENCES sensa.learning_targets,
  candidate_id UUID NOT NULL REFERENCES sensa_consumer.catalog_candidates,
  revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0), status TEXT NOT NULL DEFAULT 'active' CHECK(status='active'),
  UNIQUE(id,learner_user_id)
);
CREATE TABLE sensa_consumer.target_sources (
  membership_id UUID NOT NULL REFERENCES sensa_consumer.target_memberships,
  candidate_id UUID NOT NULL REFERENCES sensa_consumer.catalog_candidates,
  PRIMARY KEY(membership_id,candidate_id)
);
CREATE TABLE sensa_consumer.target_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), membership_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.target_memberships,
  revision BIGINT NOT NULL DEFAULT 1, readiness TEXT NOT NULL CHECK(readiness IN ('preparing','ready','blocked')),
  reason TEXT, retry_allowed BOOLEAN NOT NULL DEFAULT false,
  materialization_id UUID REFERENCES sensa.learning_materializations,
  CHECK((readiness='ready')=(materialization_id IS NOT NULL))
);
CREATE TABLE sensa_consumer.declared_masteries (
  retention_target_id UUID PRIMARY KEY REFERENCES sensa.retention_targets,
  active BOOLEAN NOT NULL, revision BIGINT NOT NULL CHECK(revision>0)
);
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.declared_masteries TO backend_app;
-- One canonical pointer per Retention Target; a composite FK checks the original identity tuple.
ALTER TABLE sensa.learning_targets ADD CONSTRAINT consumer_learning_identity_unique
  UNIQUE(learning_target_id,retention_target_id,learner_user_id,sense_id,sense_expression_binding_id);
CREATE TABLE sensa_consumer.canonical_targets (
  retention_target_id UUID PRIMARY KEY REFERENCES sensa.retention_targets,
  learning_target_id UUID NOT NULL UNIQUE, learner_user_id TEXT NOT NULL,
  sense_id UUID NOT NULL, binding_id UUID NOT NULL,
  FOREIGN KEY(learning_target_id,retention_target_id,learner_user_id,sense_id,binding_id)
    REFERENCES sensa.learning_targets(learning_target_id,retention_target_id,learner_user_id,sense_id,sense_expression_binding_id)
);
ALTER TABLE sensa_consumer.changes ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'plan' CHECK(entity_type IN ('plan','target'));
REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM PUBLIC;
GRANT SELECT ON sensa_consumer.catalog_candidates TO backend_app;
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.learner_scopes,sensa_consumer.target_memberships,
  sensa_consumer.target_sources,sensa_consumer.target_plans,sensa_consumer.canonical_targets TO backend_app;
DO $$
BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM anon; END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM authenticated; END IF;
END $$;
