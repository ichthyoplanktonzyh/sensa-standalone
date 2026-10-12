-- A single account/library cursor replaces full-manifest publication. Existing
-- checkpoints are retained, but are not silently admitted to the new protocol.
ALTER TABLE sensa_consumer.library_cloud
 ADD COLUMN library_id uuid,
 ADD COLUMN learner_id uuid,
 ADD COLUMN snapshot_revision integer NOT NULL DEFAULT 0,
 ADD COLUMN retention_floor integer NOT NULL DEFAULT 0,
 ADD COLUMN record_count integer NOT NULL DEFAULT 0,
 ADD COLUMN tail_bytes bigint NOT NULL DEFAULT 0,
 ADD COLUMN tail_commits integer NOT NULL DEFAULT 0,
 ADD CHECK(retention_floor>=0 AND retention_floor<=snapshot_revision AND snapshot_revision<=revision),
 ADD CHECK(record_count BETWEEN 0 AND 200000);
ALTER TABLE sensa_consumer.library_cloud_commits ADD COLUMN result jsonb;
CREATE TABLE sensa_consumer.library_cloud_rows (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 table_name text NOT NULL,record_key text NOT NULL,refs jsonb NOT NULL,
 PRIMARY KEY(account_id,table_name,record_key)
);
CREATE TABLE sensa_consumer.library_cloud_log (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 revision integer NOT NULL,ordinal integer NOT NULL,
 table_name text NOT NULL,record_key text NOT NULL,refs jsonb,
 PRIMARY KEY(account_id,revision,ordinal)
);
CREATE TABLE sensa_consumer.library_cloud_snapshots (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 revision integer NOT NULL,table_name text NOT NULL,record_key text NOT NULL,refs jsonb NOT NULL,
 PRIMARY KEY(account_id,revision,table_name,record_key)
);
CREATE TABLE sensa_consumer.library_cloud_membership (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,owner_kind text NOT NULL CHECK(owner_kind IN ('row','log','snapshot')),
 owner_id text NOT NULL,hash text NOT NULL,
 PRIMARY KEY(account_id,owner_kind,owner_id,hash),
 FOREIGN KEY(account_id,hash) REFERENCES sensa_consumer.library_cloud_blocks(account_id,hash)
);
CREATE INDEX library_cloud_membership_hash ON sensa_consumer.library_cloud_membership(account_id,hash);
CREATE TABLE sensa_consumer.library_cloud_reads (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 id uuid NOT NULL,from_revision integer NOT NULL,to_revision integer NOT NULL,snapshot_revision integer NOT NULL,
 expires_at timestamptz NOT NULL,PRIMARY KEY(account_id,id)
);
CREATE INDEX library_cloud_reads_expiry ON sensa_consumer.library_cloud_reads(expires_at,account_id);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['library_cloud_rows','library_cloud_log','library_cloud_snapshots','library_cloud_membership','library_cloud_reads'] LOOP
  EXECUTE format('ALTER TABLE sensa_consumer.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON sensa_consumer.%I TO backend_app USING(true) WITH CHECK(true)',table_name||'_backend',table_name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON sensa_consumer.%I TO backend_app',table_name);
  EXECUTE format('REVOKE ALL ON sensa_consumer.%I FROM PUBLIC',table_name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON sensa_consumer.%I FROM anon',table_name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON sensa_consumer.%I FROM authenticated',table_name); END IF;
 END LOOP;
END $$;
