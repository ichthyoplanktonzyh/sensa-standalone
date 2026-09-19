-- Agent installation uses a short-lived one-time setup code. The long-lived
-- intake credential is returned only to the local installer and is never
-- present in Web UI state, copied commands, process arguments or this table.
ALTER TABLE sensa_consumer.agent_connections
  ADD COLUMN client_kind text NOT NULL DEFAULT 'codex'
    CHECK (client_kind IN ('codex','cursor','claude_desktop','windsurf','cli')),
  ADD COLUMN last_used_at timestamptz;

CREATE TABLE sensa_consumer.agent_connection_setups (
  setup_id uuid PRIMARY KEY,
  connection_id uuid NOT NULL UNIQUE,
  account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sensa_consumer.sessions(id) ON DELETE CASCADE,
  scope_epoch bigint NOT NULL,
  client_kind text NOT NULL CHECK (client_kind IN ('codex','cursor','claude_desktop','windsurf','cli')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  code_hash text NOT NULL UNIQUE,
  replaces_connection_id uuid REFERENCES sensa_consumer.agent_connections(connection_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX agent_connection_setups_account_created
  ON sensa_consumer.agent_connection_setups(account_id, created_at DESC);

CREATE TABLE sensa_consumer.agent_connection_events (
  event_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  client_kind text NOT NULL CHECK (client_kind IN ('codex','cursor','claude_desktop','windsurf','cli')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  event_type text NOT NULL CHECK (event_type IN ('setup_created','activated','replaced','revoked')),
  created_at timestamptz NOT NULL
);

CREATE INDEX agent_connection_events_account_created
  ON sensa_consumer.agent_connection_events(account_id, created_at DESC);
CREATE INDEX intake_envelopes_agent_rate
  ON sensa_consumer.intake_envelopes(account_id, client_id, created_at DESC);

ALTER TABLE sensa_consumer.agent_connection_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa_consumer.agent_connection_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_connection_setups_backend ON sensa_consumer.agent_connection_setups
  TO backend_app USING (true) WITH CHECK (true);
CREATE POLICY agent_connection_events_backend ON sensa_consumer.agent_connection_events
  TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON sensa_consumer.agent_connection_setups TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sensa_consumer.agent_connection_events TO backend_app;
REVOKE ALL ON sensa_consumer.agent_connection_setups, sensa_consumer.agent_connection_events FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON sensa_consumer.agent_connection_setups, sensa_consumer.agent_connection_events FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON sensa_consumer.agent_connection_setups, sensa_consumer.agent_connection_events FROM authenticated;
  END IF;
END $$;
