-- Content-addressed sync blocks need explicit upload and snapshot lifetimes.
ALTER TABLE sensa_consumer.library_cloud_blocks
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN upload_lease_expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours');

CREATE INDEX library_cloud_blocks_upload_lease
  ON sensa_consumer.library_cloud_blocks(upload_lease_expires_at,account_id,hash);

CREATE TABLE sensa_consumer.library_cloud_snapshot_leases (
  account_id text NOT NULL REFERENCES sensa_consumer.library_cloud(account_id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK(revision>=0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(account_id,revision)
);

CREATE INDEX library_cloud_snapshot_leases_expiry
  ON sensa_consumer.library_cloud_snapshot_leases(expires_at,account_id,revision);

CREATE TABLE sensa_consumer.library_cloud_block_refs (
  account_id text NOT NULL,
  hash text NOT NULL,
  reference_kind text NOT NULL CHECK(reference_kind IN ('head','retired')),
  expires_at timestamptz,
  PRIMARY KEY(account_id,hash,reference_kind),
  FOREIGN KEY(account_id,hash)
    REFERENCES sensa_consumer.library_cloud_blocks(account_id,hash) ON DELETE CASCADE,
  CHECK((reference_kind='head' AND expires_at IS NULL) OR (reference_kind='retired' AND expires_at IS NOT NULL))
);

CREATE INDEX library_cloud_block_refs_expiry
  ON sensa_consumer.library_cloud_block_refs(expires_at,account_id,hash)
  WHERE reference_kind='retired';

ALTER TABLE sensa_consumer.library_cloud_snapshot_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa_consumer.library_cloud_block_refs ENABLE ROW LEVEL SECURITY;
CREATE POLICY library_cloud_snapshot_leases_backend ON sensa_consumer.library_cloud_snapshot_leases TO backend_app USING(true) WITH CHECK(true);
CREATE POLICY library_cloud_block_refs_backend ON sensa_consumer.library_cloud_block_refs TO backend_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON sensa_consumer.library_cloud_snapshot_leases,sensa_consumer.library_cloud_block_refs TO backend_app;
REVOKE ALL ON sensa_consumer.library_cloud_snapshot_leases,sensa_consumer.library_cloud_block_refs FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON sensa_consumer.library_cloud_snapshot_leases,sensa_consumer.library_cloud_block_refs FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON sensa_consumer.library_cloud_snapshot_leases,sensa_consumer.library_cloud_block_refs FROM authenticated;
 END IF;
END $$;
