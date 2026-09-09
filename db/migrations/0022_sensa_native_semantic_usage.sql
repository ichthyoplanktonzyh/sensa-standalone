-- Service usage only: no capture, Focus, proposal or Personal Meaning payloads.
CREATE TABLE sensa_consumer.native_semantic_usage (
 account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
CREATE INDEX native_semantic_usage_account_time ON sensa_consumer.native_semantic_usage(account_id,created_at);
ALTER TABLE sensa_consumer.native_semantic_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sensa_consumer.native_semantic_usage FROM PUBLIC;
GRANT SELECT,INSERT ON sensa_consumer.native_semantic_usage TO backend_app;
CREATE POLICY native_semantic_usage_backend ON sensa_consumer.native_semantic_usage TO backend_app USING(true) WITH CHECK(true);
