-- Normalize repeated owner/hash strings into ordinary, account-scoped FK IDs.
-- This rewrites only derived reachability metadata; facts, refs and blocks stay.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE sensa_consumer.library_cloud_blocks
 ADD COLUMN block_id bigint GENERATED ALWAYS AS IDENTITY,
 ADD UNIQUE(account_id,block_id);

CREATE TABLE sensa_consumer.library_cloud_owners(
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 id bigint GENERATED ALWAYS AS IDENTITY,
 owner_kind text NOT NULL CHECK(owner_kind IN('row','log','snapshot','staging')),
 owner text COLLATE "C" NOT NULL,
 PRIMARY KEY(account_id,id),UNIQUE(account_id,owner_kind,owner)
);
CREATE INDEX library_cloud_owner_log_retirement ON sensa_consumer.library_cloud_owners(account_id,(owner::bigint)) WHERE owner_kind='log';
CREATE INDEX library_cloud_owner_snapshot_retirement ON sensa_consumer.library_cloud_owners
 (account_id,(CASE WHEN owner~'^[0-9]+$' THEN owner::bigint ELSE (owner::jsonb->>1)::bigint END)) WHERE owner_kind='snapshot';
ALTER TABLE sensa_consumer.library_cloud_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY library_cloud_owners_backend ON sensa_consumer.library_cloud_owners TO backend_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON sensa_consumer.library_cloud_owners TO backend_app;
REVOKE ALL ON sensa_consumer.library_cloud_owners FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sensa_consumer.library_cloud_owners FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sensa_consumer.library_cloud_owners FROM authenticated; END IF;
END $$;

INSERT INTO sensa_consumer.library_cloud_owners(account_id,owner_kind,owner)
 SELECT DISTINCT account_id,owner_kind,owner_id COLLATE "C" FROM sensa_consumer.library_cloud_membership
 ORDER BY account_id,owner_kind,owner_id COLLATE "C";
ALTER TABLE sensa_consumer.library_cloud_membership ADD COLUMN owner_key bigint,ADD COLUMN block_key bigint;
UPDATE sensa_consumer.library_cloud_membership m SET owner_key=o.id,block_key=b.block_id
 FROM sensa_consumer.library_cloud_owners o,sensa_consumer.library_cloud_blocks b
 WHERE o.account_id=m.account_id AND o.owner_kind=m.owner_kind AND o.owner=m.owner_id
 AND b.account_id=m.account_id AND b.hash=m.hash;

-- Preserve an already configured orphan sweeper's exact metadata authority.
-- Its policies depend on the old hash column and must move atomically with it.
-- No history/head/owner authority is granted and the history switch stays off.
DO $$ DECLARE had_delete boolean;had_update boolean;had_read boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership WHERE owner_key IS NULL OR block_key IS NULL) THEN
  RAISE EXCEPTION 'library_membership_reference_missing';
 END IF;
 SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='sensa_consumer' AND tablename='library_cloud_blocks' AND policyname='sensa_operational_retention_delete') INTO had_delete;
 SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='sensa_consumer' AND tablename='library_cloud_blocks' AND policyname='sensa_operational_retention_update') INTO had_update;
 had_read:=EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sensa_operational_retention');
 IF had_read THEN had_read:=has_column_privilege('sensa_operational_retention','sensa_consumer.library_cloud_membership','hash','SELECT'); END IF;
 DROP POLICY IF EXISTS sensa_operational_retention_delete ON sensa_consumer.library_cloud_blocks;
 DROP POLICY IF EXISTS sensa_operational_retention_update ON sensa_consumer.library_cloud_blocks;
 DROP INDEX sensa_consumer.library_cloud_membership_owner_hash;
 DROP INDEX sensa_consumer.library_cloud_membership_hash;
 DROP INDEX sensa_consumer.library_cloud_log_pin_retirement;
 DROP INDEX sensa_consumer.library_cloud_snapshot_pin_retirement;
 ALTER TABLE sensa_consumer.library_cloud_membership
  DROP CONSTRAINT library_cloud_membership_account_id_hash_fkey,
  DROP CONSTRAINT library_cloud_membership_hash_check,
  DROP COLUMN owner_kind,
  ALTER COLUMN owner_id TYPE bigint USING owner_key,
  ALTER COLUMN hash TYPE bigint USING block_key,
  DROP COLUMN owner_key,DROP COLUMN block_key;
 ALTER TABLE sensa_consumer.library_cloud_membership RENAME COLUMN hash TO block_id;
 ALTER TABLE sensa_consumer.library_cloud_membership
  ADD PRIMARY KEY(account_id,owner_id,block_id),
  ADD FOREIGN KEY(account_id,owner_id) REFERENCES sensa_consumer.library_cloud_owners(account_id,id),
  ADD FOREIGN KEY(account_id,block_id) REFERENCES sensa_consumer.library_cloud_blocks(account_id,block_id);
 CREATE INDEX library_cloud_membership_block ON sensa_consumer.library_cloud_membership(account_id,block_id);
 IF had_read THEN
  GRANT SELECT(account_id,block_id) ON sensa_consumer.library_cloud_membership TO sensa_operational_retention;
  GRANT SELECT(block_id) ON sensa_consumer.library_cloud_blocks TO sensa_operational_retention;
 END IF;
 IF had_delete THEN
  CREATE POLICY sensa_operational_retention_delete ON sensa_consumer.library_cloud_blocks FOR DELETE TO sensa_operational_retention USING(
   upload_lease_expires_at<=now()
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud legacy WHERE legacy.account_id=library_cloud_blocks.account_id AND legacy.library_id IS NULL AND legacy.revision>0)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m WHERE m.account_id=library_cloud_blocks.account_id AND m.block_id=library_cloud_blocks.block_id)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_block_refs r WHERE r.account_id=library_cloud_blocks.account_id AND r.hash=library_cloud_blocks.hash AND(r.reference_kind='head' OR r.expires_at>now())));
 END IF;
 IF had_update THEN
  CREATE POLICY sensa_operational_retention_update ON sensa_consumer.library_cloud_blocks FOR UPDATE TO sensa_operational_retention USING(
   upload_lease_expires_at<=now()
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud legacy WHERE legacy.account_id=library_cloud_blocks.account_id AND legacy.library_id IS NULL AND legacy.revision>0)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m WHERE m.account_id=library_cloud_blocks.account_id AND m.block_id=library_cloud_blocks.block_id)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_block_refs r WHERE r.account_id=library_cloud_blocks.account_id AND r.hash=library_cloud_blocks.hash AND(r.reference_kind='head' OR r.expires_at>now())))
  WITH CHECK(upload_lease_expires_at<=now()
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud legacy WHERE legacy.account_id=library_cloud_blocks.account_id AND legacy.library_id IS NULL AND legacy.revision>0)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m WHERE m.account_id=library_cloud_blocks.account_id AND m.block_id=library_cloud_blocks.block_id)
   AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_block_refs r WHERE r.account_id=library_cloud_blocks.account_id AND r.hash=library_cloud_blocks.hash AND(r.reference_kind='head' OR r.expires_at>now())));
 END IF;
END $$;
