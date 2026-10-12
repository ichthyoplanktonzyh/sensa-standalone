-- Private bounded upload workspace. Only final CAS installs existing authority.
ALTER TABLE sensa_consumer.library_cloud_membership DROP CONSTRAINT library_cloud_membership_owner_kind_check;
ALTER TABLE sensa_consumer.library_cloud_membership ADD CHECK(owner_kind IN ('row','log','snapshot','staging'));
CREATE TABLE sensa_consumer.library_cloud_staging (
 account_id text NOT NULL REFERENCES sensa_consumer.library_cloud ON DELETE CASCADE,
 operation_id uuid NOT NULL, request_digest text NOT NULL, descriptor jsonb NOT NULL,
 pages integer NOT NULL DEFAULT 0, records integer NOT NULL DEFAULT 0,
 metadata_bytes bigint NOT NULL DEFAULT 0, digest text NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,operation_id),
 CHECK(pages BETWEEN 0 AND 200000 AND records BETWEEN 0 AND 200000),
 CHECK(metadata_bytes BETWEEN 0 AND 67108864)
);
CREATE TABLE sensa_consumer.library_cloud_staging_pages (
 account_id text NOT NULL, operation_id uuid NOT NULL, page integer NOT NULL,
 request_digest text NOT NULL, digest text NOT NULL,
 PRIMARY KEY(account_id,operation_id,page),
 FOREIGN KEY(account_id,operation_id) REFERENCES sensa_consumer.library_cloud_staging ON DELETE CASCADE
);
CREATE TABLE sensa_consumer.library_cloud_staging_rows (
 account_id text NOT NULL, operation_id uuid NOT NULL, table_name text NOT NULL, record_key text NOT NULL, refs jsonb NOT NULL,
 PRIMARY KEY(account_id,operation_id,table_name,record_key),
 FOREIGN KEY(account_id,operation_id) REFERENCES sensa_consumer.library_cloud_staging ON DELETE CASCADE
);
CREATE INDEX library_cloud_staging_expiry ON sensa_consumer.library_cloud_staging(expires_at,account_id);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['library_cloud_staging','library_cloud_staging_pages','library_cloud_staging_rows'] LOOP
  EXECUTE format('ALTER TABLE sensa_consumer.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON sensa_consumer.%I TO backend_app USING(true) WITH CHECK(true)',table_name||'_backend',table_name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON sensa_consumer.%I TO backend_app',table_name);
  EXECUTE format('REVOKE ALL ON sensa_consumer.%I FROM PUBLIC',table_name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON sensa_consumer.%I FROM anon',table_name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON sensa_consumer.%I FROM authenticated',table_name); END IF;
 END LOOP;
END $$;
