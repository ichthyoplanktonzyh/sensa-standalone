-- Semantic lookups are short-lived private request snapshots. Account erasure
-- and scheduled retention both remove them; expiry must not depend on a user
-- returning to the product.
CREATE INDEX semantic_lookups_expiry
  ON sensa_consumer.semantic_lookups(expires_at);

GRANT DELETE ON sensa_consumer.semantic_lookups TO backend_app;
