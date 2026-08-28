-- New Encounters pin the single active Memory Outcome V2 contract.

ALTER TABLE sensa.sense_encounters
  ALTER COLUMN outcome_mapping_version SET DEFAULT 'sensa-memory-outcome-v2',
  DROP CONSTRAINT IF EXISTS sense_encounters_versions_nonempty;

ALTER TABLE sensa.sense_encounters
  ADD CONSTRAINT sense_encounters_versions_nonempty CHECK (
    btrim(semantic_policy_version) <> ''
    AND btrim(stop_policy_version) <> ''
    AND btrim(evidence_rule_version) <> ''
    AND btrim(state_updater_version) <> ''
    AND outcome_mapping_version = 'sensa-memory-outcome-v2'
  );
