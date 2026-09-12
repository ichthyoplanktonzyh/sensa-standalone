-- Reference (word-sense) resolution usage only: no capture, sentence, context or proposal
-- payloads are ever stored. Kept separate from native_semantic_usage because the Web
-- resolves one word at a time, which needs its own rolling budget.
CREATE TABLE sensa_consumer.reference_usage (
 account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
CREATE INDEX reference_usage_account_time ON sensa_consumer.reference_usage(account_id,created_at);
ALTER TABLE sensa_consumer.reference_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sensa_consumer.reference_usage FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON sensa_consumer.reference_usage TO backend_app;
CREATE POLICY reference_usage_backend ON sensa_consumer.reference_usage TO backend_app USING(true) WITH CHECK(true);
