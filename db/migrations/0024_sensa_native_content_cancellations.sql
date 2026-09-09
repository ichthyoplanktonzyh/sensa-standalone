-- Opaque cancellation tombstones; no anchor text, grant content or provider keys.
CREATE TABLE sensa_consumer.native_content_cancellations (
 account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
 request_id uuid NOT NULL,input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 cancelled_at timestamptz NOT NULL,PRIMARY KEY(account_id,request_id)
);
ALTER TABLE sensa_consumer.native_content_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sensa_consumer.native_content_cancellations FROM PUBLIC;
GRANT SELECT,INSERT ON sensa_consumer.native_content_cancellations TO backend_app;
CREATE POLICY native_content_cancellations_backend ON sensa_consumer.native_content_cancellations TO backend_app USING(true) WITH CHECK(true);
