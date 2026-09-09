CREATE TABLE semantic_lookups (
 id TEXT PRIMARY KEY,
 content TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL
);
CREATE TABLE semantic_identities (
 digest TEXT PRIMARY KEY,
 content TEXT NOT NULL
);
PRAGMA user_version=9;
