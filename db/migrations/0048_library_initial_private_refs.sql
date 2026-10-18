-- New initial uploads reuse their private application generation for refs.
-- Version 1 uploads retain their old storage contract and remain resumable.
ALTER TABLE sensa_consumer.library_cloud_staging
 DROP CONSTRAINT library_cloud_staging_prepared_version_check,
 ADD CHECK(prepared_version IN(0,1,2));

CREATE OR REPLACE FUNCTION sensa_consumer.library_cloud_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stage sensa_consumer.library_cloud_staging%ROWTYPE;
BEGIN
 SELECT * INTO stage FROM sensa_consumer.library_cloud_staging
  WHERE account_id=NEW.account_id AND operation_id=NEW.rows_generation FOR UPDATE;
 IF NOT FOUND OR stage.purpose IS DISTINCT FROM 'initial' OR stage.prepared_version NOT IN(1,2) OR stage.retiring OR stage.prepared_pages<>stage.pages
  OR stage.prepared_records<>stage.records OR NEW.record_count<>stage.records
  OR NEW.snapshot_generation<>NEW.rows_generation OR NEW.snapshot_revision<>NEW.revision
  OR NEW.retention_floor<>NEW.revision THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='library_sync_staging_unprepared';
 END IF;
 RETURN NEW;
END $$;
