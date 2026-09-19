-- Revocable, intake-only credentials for external Agent surfaces. The raw
-- bearer token is returned once and never stored.
CREATE TABLE sensa_consumer.agent_connections (
  connection_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sensa_consumer.sessions(id) ON DELETE CASCADE,
  scope_epoch bigint NOT NULL,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX agent_connections_account_created
  ON sensa_consumer.agent_connections(account_id, created_at DESC);

ALTER TABLE sensa_consumer.agent_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_connections_backend ON sensa_consumer.agent_connections
  TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON sensa_consumer.agent_connections TO backend_app;
REVOKE ALL ON sensa_consumer.agent_connections FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON sensa_consumer.agent_connections FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON sensa_consumer.agent_connections FROM authenticated;
  END IF;
END $$;
