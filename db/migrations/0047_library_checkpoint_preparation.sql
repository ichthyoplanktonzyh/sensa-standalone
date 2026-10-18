-- Checkpoints reuse the private publication workspace; current facts stay put.
ALTER TABLE sensa_consumer.library_cloud_staging
 ADD COLUMN purpose text NOT NULL DEFAULT 'initial' CHECK(purpose IN('initial','checkpoint')),
 ADD COLUMN checkpoint_state jsonb,
 ADD COLUMN published_revision integer CHECK(published_revision>0);
ALTER TABLE sensa_consumer.library_cloud_staging_pages ADD COLUMN result jsonb;
CREATE UNIQUE INDEX library_cloud_checkpoint_active ON sensa_consumer.library_cloud_staging(account_id)
 WHERE purpose='checkpoint' AND NOT retiring AND published_revision IS NULL;

-- Retirement must seek eligible roots instead of scanning every current pin.
CREATE INDEX library_cloud_snapshot_retirement ON sensa_consumer.library_cloud_snapshots(account_id,revision,generation);
CREATE INDEX library_cloud_log_pin_retirement ON sensa_consumer.library_cloud_membership(account_id,(owner_id::bigint))
 WHERE owner_kind='log';
CREATE INDEX library_cloud_snapshot_pin_retirement ON sensa_consumer.library_cloud_membership
 (account_id,(CASE WHEN owner_id~'^[0-9]+$' THEN owner_id::bigint ELSE (owner_id::jsonb->>1)::bigint END))
 WHERE owner_kind='snapshot';

-- Initial selection keeps its existing guard. Snapshot-only selection needs its
-- own constant-size proof, including the original checkpoint's counter fence.
CREATE OR REPLACE FUNCTION sensa_consumer.library_cloud_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stage sensa_consumer.library_cloud_staging%ROWTYPE;
BEGIN
 SELECT * INTO stage FROM sensa_consumer.library_cloud_staging
  WHERE account_id=NEW.account_id AND operation_id=NEW.rows_generation FOR UPDATE;
 IF NOT FOUND OR stage.purpose IS DISTINCT FROM 'initial' OR stage.prepared_version<>1 OR stage.retiring OR stage.prepared_pages<>stage.pages
  OR stage.prepared_records<>stage.records OR NEW.record_count<>stage.records
  OR NEW.snapshot_generation<>NEW.rows_generation OR NEW.snapshot_revision<>NEW.revision
  OR NEW.retention_floor<>NEW.revision THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='library_sync_staging_unprepared';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION sensa_consumer.library_cloud_checkpoint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stage sensa_consumer.library_cloud_staging%ROWTYPE; d jsonb; h integer;
BEGIN
 SELECT * INTO stage FROM sensa_consumer.library_cloud_staging
  WHERE account_id=NEW.account_id AND operation_id=NEW.snapshot_generation FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='library_sync_staging_unprepared';
 END IF;
 d=stage.descriptor; h=(d->>'baseRevision')::integer;
 IF h IS NULL OR stage.purpose IS DISTINCT FROM 'checkpoint' OR stage.retiring OR stage.prepared_version<>1
  OR stage.checkpoint_state->>'phase' IS DISTINCT FROM 'sealed' OR stage.published_revision IS DISTINCT FROM h
  OR stage.prepared_pages<>stage.pages OR stage.prepared_records<>stage.records
  OR stage.records IS DISTINCT FROM (d->>'records')::integer
  OR stage.records IS DISTINCT FROM (stage.checkpoint_state->>'records')::integer
  OR d->>'operationId' IS DISTINCT FROM stage.operation_id::text
  OR (stage.checkpoint_state->'position'->>'revision')::integer IS DISTINCT FROM h
  OR (stage.checkpoint_state->'position'->>'offset')::integer IS DISTINCT FROM 0
  OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.record_count IS DISTINCT FROM OLD.record_count OR NEW.logical_bytes IS DISTINCT FROM OLD.logical_bytes
  OR NEW.rows_generation IS DISTINCT FROM OLD.rows_generation OR NEW.library_id IS DISTINCT FROM OLD.library_id OR NEW.learner_id IS DISTINCT FROM OLD.learner_id
  OR d->>'libraryId' IS DISTINCT FROM OLD.library_id::text OR d->>'learnerId' IS DISTINCT FROM OLD.learner_id::text
  OR d->>'rowsGeneration' IS DISTINCT FROM OLD.rows_generation::text
  OR d->>'snapshotGeneration' IS DISTINCT FROM OLD.snapshot_generation::text
  OR (d->>'snapshotRevision')::integer IS DISTINCT FROM OLD.snapshot_revision OR (d->>'floor')::integer IS DISTINCT FROM OLD.retention_floor
  OR h<=OLD.snapshot_revision OR h>NEW.revision OR NEW.snapshot_revision<>h OR NEW.retention_floor<>h
  OR NEW.tail_bytes IS DISTINCT FROM OLD.tail_bytes-(d->>'tailBytes')::bigint
  OR NEW.tail_commits IS DISTINCT FROM OLD.tail_commits-(d->>'tailCommits')::integer
  OR NEW.tail_bytes<0 OR NEW.tail_commits<0
  OR (h=NEW.revision AND NEW.record_count<>stage.records)
  OR NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_commits c
   WHERE c.account_id=NEW.account_id AND c.operation_id=stage.operation_id
    AND c.request_digest=stage.request_digest AND c.revision=h
    AND (c.result->'manifest'->>'snapshotRevision')::integer=h
    AND (c.result->'manifest'->>'floor')::integer=h
    AND c.result->'manifest'->>'libraryId'=OLD.library_id::text
    AND c.result->'manifest'->>'learnerId'=OLD.learner_id::text
    AND c.result->'receipt'->>'operationId'=stage.operation_id::text
    AND c.result->'receipt'->>'requestDigest'=stage.request_digest) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='library_sync_staging_unprepared';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sensa_consumer.library_cloud_checkpoint_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sensa_consumer.library_cloud_checkpoint_guard() TO backend_app;
CREATE TRIGGER library_cloud_checkpoint_guard BEFORE UPDATE OF snapshot_generation,snapshot_revision,retention_floor ON sensa_consumer.library_cloud
 FOR EACH ROW WHEN(OLD.rows_generation IS NOT DISTINCT FROM NEW.rows_generation AND
  (OLD.snapshot_generation IS DISTINCT FROM NEW.snapshot_generation OR OLD.snapshot_revision IS DISTINCT FROM NEW.snapshot_revision OR OLD.retention_floor IS DISTINCT FROM NEW.retention_floor))
 EXECUTE FUNCTION sensa_consumer.library_cloud_checkpoint_guard();
