CREATE TABLE library (
 id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, revision INTEGER NOT NULL,
 daily_new_limit INTEGER CHECK(daily_new_limit IN (5,10,15,20,30)), last_time_ms INTEGER NOT NULL
);
CREATE TABLE materials (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL, content TEXT NOT NULL
);
CREATE TABLE targets (
 id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
 sense_version_id TEXT NOT NULL, binding_version_id TEXT NOT NULL,
 policy_id TEXT NOT NULL, policy_version TEXT NOT NULL,
 UNIQUE(sense_version_id, binding_version_id)
);
CREATE TABLE runs (
 id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE REFERENCES targets(id),
 material_id TEXT NOT NULL REFERENCES materials(id), material_digest TEXT NOT NULL,
 protocol_version TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('recall','reveal','completed')),
 ordinal INTEGER NOT NULL, attempt_count INTEGER NOT NULL, paused INTEGER NOT NULL,
 started_at_ms INTEGER NOT NULL
);
CREATE TABLE operations (
 id TEXT PRIMARY KEY, command TEXT NOT NULL, result TEXT NOT NULL
);
CREATE TABLE attempts (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 run_id TEXT NOT NULL REFERENCES runs(id), ordinal INTEGER NOT NULL, action TEXT NOT NULL,
 next_phase TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL, UNIQUE(run_id, ordinal)
);
CREATE TABLE completions (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
 kind TEXT NOT NULL, evidence_level TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL
);
CREATE TABLE handoffs (
 id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE REFERENCES targets(id),
 completion_id TEXT NOT NULL UNIQUE REFERENCES completions(id), basis TEXT NOT NULL,
 policy_version TEXT NOT NULL, schedule TEXT NOT NULL
);
CREATE TABLE memory (
 target_id TEXT PRIMARY KEY REFERENCES targets(id), handoff_id TEXT NOT NULL UNIQUE REFERENCES handoffs(id),
 revision INTEGER NOT NULL, due_at_ms INTEGER NOT NULL, schedule TEXT NOT NULL
);
PRAGMA user_version = 1;
