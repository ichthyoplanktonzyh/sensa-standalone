-- Additive migration: initial-learning identities and receipts remain untouched.
CREATE TABLE retention_runs (
 id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES targets(id),
 material_id TEXT NOT NULL REFERENCES materials(id), material_digest TEXT NOT NULL,
 content TEXT NOT NULL, protocol_version TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('recall','reveal','waiting','completed')),
 ordinal INTEGER NOT NULL, attempt_count INTEGER NOT NULL, paused INTEGER NOT NULL,
 started_at_ms INTEGER NOT NULL, trigger_revision INTEGER, trigger_due_at_ms INTEGER,
 UNIQUE(target_id,trigger_revision,trigger_due_at_ms)
);
CREATE UNIQUE INDEX one_active_retention_run ON retention_runs(target_id) WHERE phase<>'completed';
CREATE TABLE retention_attempts (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 run_id TEXT NOT NULL REFERENCES retention_runs(id), ordinal INTEGER NOT NULL,
 action TEXT NOT NULL, next_phase TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL,
 UNIQUE(run_id,ordinal)
);
CREATE TABLE retention_completions (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES retention_runs(id),
 kind TEXT NOT NULL, evidence_level TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL
);
CREATE TABLE memory_outcomes (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES retention_runs(id),
 target_id TEXT NOT NULL REFERENCES targets(id), completion_id TEXT NOT NULL UNIQUE REFERENCES retention_completions(id),
 memory_revision INTEGER NOT NULL, due_at_ms INTEGER NOT NULL,
 grade TEXT NOT NULL, basis TEXT NOT NULL, evidence_level TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL,
 UNIQUE(target_id,memory_revision,due_at_ms)
);
CREATE TABLE scheduling_decisions (
 id TEXT PRIMARY KEY, outcome_id TEXT NOT NULL UNIQUE REFERENCES memory_outcomes(id),
 policy_version TEXT NOT NULL, schedule TEXT NOT NULL, decided_at_ms INTEGER NOT NULL
);
CREATE TABLE relearning_needs (
 id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES targets(id),
 outcome_id TEXT NOT NULL UNIQUE REFERENCES memory_outcomes(id),
 run_id TEXT UNIQUE REFERENCES retention_runs(id), next_eligible_at_ms INTEGER NOT NULL,
 resolved_at_ms INTEGER
);
CREATE UNIQUE INDEX one_pending_need ON relearning_needs(target_id) WHERE resolved_at_ms IS NULL;
PRAGMA user_version=3;
