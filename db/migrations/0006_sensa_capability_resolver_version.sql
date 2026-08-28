-- Freeze the executable Capability Resolver as a publication and replay fact.
-- There is deliberately no compatibility value: pre-launch Encounter progress
-- must be reset before this migration rather than silently reinterpreted.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sensa.sense_encounters) THEN
    RAISE EXCEPTION
      'Reset pre-launch learner progress before enabling Capability Resolver versioning';
  END IF;
END;
$$;

ALTER TABLE sensa.content_releases
  ADD COLUMN capability_resolver_version TEXT NOT NULL
    DEFAULT 'sensa-executable-learning-capability-resolver-v1',
  ADD CONSTRAINT content_releases_capability_resolver_version_current CHECK (
    capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1'
  );

ALTER TABLE sensa.required_asset_manifests
  ADD COLUMN capability_resolver_version TEXT NOT NULL
    DEFAULT 'sensa-executable-learning-capability-resolver-v1',
  DROP CONSTRAINT required_asset_manifests_unique,
  ADD CONSTRAINT required_asset_manifests_capability_resolver_version_current CHECK (
    capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1'
  ),
  ADD CONSTRAINT required_asset_manifests_unique UNIQUE (
    sense_version_id,
    acquisition_profile_id,
    validator_version,
    capability_resolver_version,
    package_digest
  );

ALTER TABLE sensa.sense_encounters
  ADD COLUMN capability_resolver_version TEXT NOT NULL
    DEFAULT 'sensa-executable-learning-capability-resolver-v1',
  DROP CONSTRAINT sense_encounters_versions_nonempty,
  ADD CONSTRAINT sense_encounters_versions_nonempty CHECK (
    capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1'
    AND semantic_policy_version = 'sensa-semantic-policy-v2'
    AND stop_policy_version = 'sensa-stop-policy-v1'
    AND evidence_rule_version = 'sensa-evidence-rule-v2'
    AND state_updater_version = 'sensa-state-updater-v2'
    AND outcome_mapping_version = 'sensa-memory-outcome-v2'
  );

CREATE OR REPLACE FUNCTION sensa.guard_capability_resolver_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status IN ('published', 'superseded')
    AND NEW.capability_resolver_version IS DISTINCT FROM OLD.capability_resolver_version THEN
    RAISE EXCEPTION 'Published Sensa Capability Resolver version is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'published'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF NEW.capability_resolver_version
      <> 'sensa-executable-learning-capability-resolver-v1' THEN
      RAISE EXCEPTION 'Sensa release uses an unsupported Capability Resolver version'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM sensa.required_asset_manifests AS manifests
      WHERE manifests.content_release_id = NEW.content_release_id
        AND manifests.capability_resolver_version
          IS DISTINCT FROM NEW.capability_resolver_version
    ) THEN
      RAISE EXCEPTION 'Sensa release contains a manifest from a stale Capability Resolver version'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM sensa.sense_versions AS senses
      WHERE senses.content_release_id = NEW.content_release_id
        AND NOT EXISTS (
          SELECT 1
          FROM sensa.required_asset_manifests AS manifests
          JOIN sensa.acquisition_profiles AS profiles
            ON profiles.acquisition_profile_id = manifests.acquisition_profile_id
          WHERE manifests.content_release_id = NEW.content_release_id
            AND manifests.sense_version_id = senses.sense_version_id
            AND profiles.sense_version_id = senses.sense_version_id
            AND profiles.review_status = 'approved'
            AND manifests.status = 'satisfied'
            AND manifests.validator_version = NEW.validator_version
            AND manifests.capability_resolver_version
              = NEW.capability_resolver_version
        )
    ) THEN
      RAISE EXCEPTION 'Sensa release lacks a satisfied manifest for its Capability Resolver version'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER content_releases_capability_resolver_guard
BEFORE INSERT OR UPDATE ON sensa.content_releases
FOR EACH ROW EXECUTE FUNCTION sensa.guard_capability_resolver_release();

CREATE OR REPLACE FUNCTION sensa.guard_encounter_capability_resolver_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, sensa
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.capability_resolver_version
      IS DISTINCT FROM OLD.capability_resolver_version THEN
    RAISE EXCEPTION 'Sense Encounter Capability Resolver version is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sensa_sense_encounters_capability_resolver_guard
BEFORE UPDATE ON sensa.sense_encounters
FOR EACH ROW EXECUTE FUNCTION sensa.guard_encounter_capability_resolver_version();

COMMENT ON COLUMN sensa.content_releases.capability_resolver_version IS
  'Resolver version required for every executable package manifest in this immutable Release.';
COMMENT ON COLUMN sensa.required_asset_manifests.capability_resolver_version IS
  'Frozen Resolver interpretation used to derive executable capabilities for this package.';
COMMENT ON COLUMN sensa.sense_encounters.capability_resolver_version IS
  'Frozen Resolver version used to reproduce the executable capability inventory for this Encounter.';
