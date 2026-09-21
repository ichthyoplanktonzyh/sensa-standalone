-- Short-lived idempotency receipts for managed model execution. Request bodies,
-- credentials and traces are never stored. Successful responses are bounded and
-- expire sooner than quota/idempotency metadata.
CREATE TABLE sensa_consumer.model_requests (
  account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK(purpose IN ('teacher','content','review','reading','reference','probe')),
  budget_kind text NOT NULL CHECK(budget_kind IN ('semantic','content','reference')),
  state text NOT NULL CHECK(state IN ('reserved','running','succeeded','failed_before_execution','failed_after_execution','execution_unknown')),
  response jsonb,
  error_code text,
  created_at timestamptz NOT NULL,
  reserved_at timestamptz NOT NULL,
  execution_started_at timestamptz,
  completed_at timestamptz,
  response_expires_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(account_id,request_id),
  CHECK(response IS NULL OR state='succeeded'),
  CHECK(response_expires_at IS NULL OR response IS NOT NULL)
);

CREATE INDEX model_requests_account_budget_time
  ON sensa_consumer.model_requests(account_id,budget_kind,execution_started_at);
CREATE INDEX model_requests_expiry
  ON sensa_consumer.model_requests(expires_at,account_id,request_id);
CREATE INDEX model_requests_response_expiry
  ON sensa_consumer.model_requests(response_expires_at,account_id,request_id)
  WHERE response IS NOT NULL;

ALTER TABLE sensa_consumer.model_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sensa_consumer.model_requests FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON sensa_consumer.model_requests TO backend_app;
CREATE POLICY model_requests_backend ON sensa_consumer.model_requests
  TO backend_app USING(true) WITH CHECK(true);
