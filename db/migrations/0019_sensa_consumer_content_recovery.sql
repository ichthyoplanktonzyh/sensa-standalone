-- Explicit learner clarification belongs to private resolution history, never public semantics.
ALTER TABLE sensa_consumer.semantic_lookups ADD COLUMN meaning_focus JSONB;
ALTER TABLE sensa_consumer.personal_meanings ADD COLUMN meaning_focus JSONB;
ALTER TABLE sensa_consumer.personal_meanings ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE sensa_consumer.personal_meanings ADD COLUMN removed_at TIMESTAMPTZ;
ALTER TABLE sensa_consumer.intakes ADD COLUMN removed_at TIMESTAMPTZ;
GRANT UPDATE(revision,removed_at) ON sensa_consumer.personal_meanings TO backend_app;
GRANT UPDATE(removed_at) ON sensa_consumer.intakes TO backend_app;
