CREATE TABLE sensa_consumer.reading_settings (
  account_id text PRIMARY KEY REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  encrypted_settings text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sensa_consumer.reading_requests (
  account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  input_digest text NOT NULL,
  status text NOT NULL CHECK(status IN ('running','ready','failed')),
  result text,
  error text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(account_id,id)
);
CREATE INDEX reading_requests_account_time ON sensa_consumer.reading_requests(account_id,created_at);
ALTER TABLE sensa_consumer.reading_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa_consumer.reading_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sensa_consumer.reading_settings,sensa_consumer.reading_requests FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.reading_settings,sensa_consumer.reading_requests TO backend_app;
CREATE POLICY reading_settings_backend ON sensa_consumer.reading_settings TO backend_app USING(true) WITH CHECK(true);
CREATE POLICY reading_requests_backend ON sensa_consumer.reading_requests TO backend_app USING(true) WITH CHECK(true);
