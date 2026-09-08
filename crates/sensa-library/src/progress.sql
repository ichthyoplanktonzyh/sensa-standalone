-- Generic protocol-local journal. Adapter links preserve concrete Run ownership.
CREATE TABLE protocol_journals (
 run_id TEXT PRIMARY KEY, format_version INTEGER NOT NULL CHECK(format_version=1),
 pin TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0), state TEXT NOT NULL
);
CREATE TABLE protocol_transitions (
 observation_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES protocol_journals(run_id),
 ordinal INTEGER NOT NULL CHECK(ordinal>0), observation TEXT NOT NULL,
 decision TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL, provenance TEXT NOT NULL,
 UNIQUE(run_id,ordinal)
);
CREATE TABLE consumer_progress_links (
 run_id TEXT PRIMARY KEY REFERENCES protocol_journals(run_id),
 initial_run_id TEXT UNIQUE REFERENCES runs(id),
 retention_run_id TEXT UNIQUE REFERENCES retention_runs(id),
 CHECK((initial_run_id IS NULL) != (retention_run_id IS NULL)),
 CHECK(run_id=COALESCE(initial_run_id,retention_run_id))
);
PRAGMA user_version=5;
