-- Keep the existing owner lookup prefix and reverse (account_id,hash) FK/GC
-- index. Canonical hex hashes have an exact, lossless 32-byte index key; no
-- owner digest, refcount authority or protocol representation is introduced.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE UNIQUE INDEX library_cloud_membership_owner_hash ON sensa_consumer.library_cloud_membership
 (account_id,owner_kind,owner_id,(decode(hash,'hex')));
ALTER TABLE sensa_consumer.library_cloud_membership
 ADD CHECK(hash ~ '^[a-f0-9]{64}$'),
 DROP CONSTRAINT library_cloud_membership_pkey;
