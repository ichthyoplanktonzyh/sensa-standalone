-- Web-local accounts keep only a permanent access barrier after erasure.
-- Legacy server-owned learning accounts require their own reviewed erasure adapter.
ALTER TABLE sensa_consumer.accounts ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'
 CHECK(lifecycle IN ('active','deletion_pending','deleted'));
CREATE TABLE sensa_consumer.account_deletions (
 account_id TEXT PRIMARY KEY REFERENCES sensa_consumer.accounts,
 operation_id UUID NOT NULL UNIQUE,
 requested_at TIMESTAMPTZ NOT NULL,
 completed_at TIMESTAMPTZ
);
REVOKE ALL ON sensa_consumer.account_deletions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.account_deletions TO backend_app;
GRANT DELETE ON sensa_consumer.sessions,sensa_consumer.extension_codes,sensa_consumer.extension_credentials,
 sensa_consumer.reading_settings,sensa_consumer.reading_requests,
 sensa_consumer.native_semantic_usage,sensa_consumer.native_content_usage,
 sensa_consumer.native_content_cancellations TO backend_app;
