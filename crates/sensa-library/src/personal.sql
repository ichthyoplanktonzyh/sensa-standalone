CREATE TABLE personal_intakes (
 id TEXT PRIMARY KEY, identity_digest TEXT NOT NULL UNIQUE,
 snapshot TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 removed INTEGER NOT NULL DEFAULT 0, meaning_id TEXT REFERENCES personal_meanings(id), saved_at_ms INTEGER NOT NULL
);
CREATE TABLE personal_meanings (
 id TEXT PRIMARY KEY, identity_digest TEXT NOT NULL UNIQUE,
 content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 removed INTEGER NOT NULL DEFAULT 0, accepted_at_ms INTEGER NOT NULL,
 operation_id TEXT NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE personal_learning_links (
 meaning_id TEXT NOT NULL REFERENCES personal_meanings(id), target_id TEXT NOT NULL REFERENCES targets(id),
 operation_id TEXT NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 created_at_ms INTEGER NOT NULL, PRIMARY KEY(meaning_id,target_id)
);
PRAGMA user_version=8;
