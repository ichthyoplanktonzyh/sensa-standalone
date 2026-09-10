-- A receipt grants only recovery of its already-authorized deletion. Never expose
-- receipt rows to client database roles, even if future default grants change.
ALTER TABLE sensa_consumer.account_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_deletions_backend ON sensa_consumer.account_deletions
 TO backend_app USING(true) WITH CHECK(true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON sensa_consumer.account_deletions FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON sensa_consumer.account_deletions FROM authenticated;
 END IF;
END $$;
