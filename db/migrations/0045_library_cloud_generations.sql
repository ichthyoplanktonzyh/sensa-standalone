-- Initial publication builds its immutable rows before the final account CAS.
-- Existing published rows keep their original identity and retention owners.
ALTER TABLE sensa_consumer.library_cloud
 ADD COLUMN rows_generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 ADD COLUMN snapshot_generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE sensa_consumer.library_cloud_rows
 ADD COLUMN generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 DROP CONSTRAINT library_cloud_rows_pkey,
 ADD PRIMARY KEY(account_id,generation,table_name,record_key);
ALTER TABLE sensa_consumer.library_cloud_snapshots
 ADD COLUMN generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 DROP CONSTRAINT library_cloud_snapshots_pkey,
 ADD PRIMARY KEY(account_id,generation,revision,table_name,record_key);
ALTER TABLE sensa_consumer.library_cloud_reads
 ADD COLUMN snapshot_generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
CREATE INDEX library_cloud_snapshot_generation_page ON sensa_consumer.library_cloud_snapshots
 (account_id,generation,revision,table_name COLLATE "C",record_key COLLATE "C");

-- Old unfinished workspaces remain retained, but cannot publish partial preparation.
ALTER TABLE sensa_consumer.library_cloud_staging
 ADD COLUMN prepared_version smallint NOT NULL DEFAULT 0 CHECK(prepared_version IN(0,1)),
 ADD COLUMN prepared_pages integer NOT NULL DEFAULT 0 CHECK(prepared_pages BETWEEN 0 AND 200000),
 ADD COLUMN prepared_records integer NOT NULL DEFAULT 0 CHECK(prepared_records BETWEEN 0 AND 600000),
 ADD COLUMN retiring boolean NOT NULL DEFAULT false;

-- An overlapping old handler must not select an incomplete private generation.
-- This constant-size guard verifies the same atomic page witnesses as the API.
CREATE FUNCTION sensa_consumer.library_cloud_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stage sensa_consumer.library_cloud_staging%ROWTYPE;
BEGIN
 SELECT * INTO stage FROM sensa_consumer.library_cloud_staging
  WHERE account_id=NEW.account_id AND operation_id=NEW.rows_generation FOR UPDATE;
 IF NOT FOUND OR stage.prepared_version<>1 OR stage.retiring OR stage.prepared_pages<>stage.pages
  OR stage.prepared_records<>stage.records OR NEW.record_count<>stage.records
  OR NEW.snapshot_generation<>NEW.rows_generation OR NEW.snapshot_revision<>NEW.revision
  OR NEW.retention_floor<>NEW.revision THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='library_sync_staging_unprepared';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sensa_consumer.library_cloud_generation_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sensa_consumer.library_cloud_generation_guard() TO backend_app;
CREATE TRIGGER library_cloud_generation_guard BEFORE UPDATE OF rows_generation ON sensa_consumer.library_cloud
 FOR EACH ROW WHEN(OLD.rows_generation IS DISTINCT FROM NEW.rows_generation)
 EXECUTE FUNCTION sensa_consumer.library_cloud_generation_guard();
