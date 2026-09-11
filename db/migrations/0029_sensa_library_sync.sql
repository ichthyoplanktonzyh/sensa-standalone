-- Ordinary account sync: server-readable, local domain transactions remain authoritative locally.
CREATE TABLE sensa_consumer.library_cloud (
 account_id text PRIMARY KEY REFERENCES sensa_consumer.accounts(account_id),
 revision integer NOT NULL DEFAULT 0, manifest jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sensa_consumer.library_cloud_blocks (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), data text NOT NULL,
 PRIMARY KEY(account_id,hash)
);
CREATE TABLE sensa_consumer.library_cloud_commits (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 operation_id uuid NOT NULL, request_digest text NOT NULL, revision integer NOT NULL,
 PRIMARY KEY(account_id,operation_id)
);
ALTER TABLE sensa_consumer.library_cloud ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa_consumer.library_cloud_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa_consumer.library_cloud_commits ENABLE ROW LEVEL SECURITY;
CREATE POLICY library_cloud_backend ON sensa_consumer.library_cloud TO backend_app USING(true) WITH CHECK(true);
CREATE POLICY library_cloud_blocks_backend ON sensa_consumer.library_cloud_blocks TO backend_app USING(true) WITH CHECK(true);
CREATE POLICY library_cloud_commits_backend ON sensa_consumer.library_cloud_commits TO backend_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON sensa_consumer.library_cloud,sensa_consumer.library_cloud_blocks,sensa_consumer.library_cloud_commits TO backend_app;
REVOKE ALL ON sensa_consumer.library_cloud,sensa_consumer.library_cloud_blocks,sensa_consumer.library_cloud_commits FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 REVOKE ALL ON sensa_consumer.library_cloud,sensa_consumer.library_cloud_blocks,sensa_consumer.library_cloud_commits FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 REVOKE ALL ON sensa_consumer.library_cloud,sensa_consumer.library_cloud_blocks,sensa_consumer.library_cloud_commits FROM authenticated;
 END IF;
END $$;
