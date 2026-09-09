-- User activities organize existing protocol runs; they never own Memory outcomes.
CREATE TABLE learning_activities (
 id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('mixed','review_only')),
 status TEXT NOT NULL CHECK(status IN ('active','paused','ended')),
 scope_revision INTEGER NOT NULL, current_target TEXT REFERENCES targets(id),
 current_execution TEXT, execution_kind TEXT, started_at_ms INTEGER NOT NULL,
 ended_at_ms INTEGER
);
CREATE UNIQUE INDEX one_foreground_activity ON learning_activities((1)) WHERE status='active';
CREATE TABLE activity_scope (
 activity_id TEXT NOT NULL REFERENCES learning_activities(id), target_id TEXT NOT NULL REFERENCES targets(id),
 material_id TEXT NOT NULL REFERENCES materials(id), PRIMARY KEY(activity_id,target_id)
);
CREATE TABLE activity_executions (
 activity_id TEXT NOT NULL REFERENCES learning_activities(id), execution_id TEXT NOT NULL,
 execution_kind TEXT NOT NULL, entry_operation_id TEXT NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 entered_at_ms INTEGER NOT NULL, initial_baseline INTEGER NOT NULL, retention_baseline INTEGER NOT NULL, PRIMARY KEY(activity_id,execution_id)
);
CREATE TABLE activity_results (
 result_id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES learning_activities(id),
 target_id TEXT NOT NULL REFERENCES targets(id), kind TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL
);
CREATE TABLE local_checkins (
 local_date TEXT PRIMARY KEY, source TEXT NOT NULL CHECK(source IN ('manual','formal_learning')),
 occurred_at_ms INTEGER NOT NULL, offset_minutes INTEGER NOT NULL,
 activity_id TEXT REFERENCES learning_activities(id), execution_id TEXT,
 entry_operation_id TEXT REFERENCES operations(id),
 operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE activity_clock (singleton INTEGER PRIMARY KEY CHECK(singleton=1),offset_minutes INTEGER NOT NULL,current_activity TEXT REFERENCES learning_activities(id));
INSERT INTO activity_clock VALUES(1,0,NULL);
DROP INDEX one_active_assurance_session;
CREATE UNIQUE INDEX one_active_assurance_session ON assurance_sessions(purpose) WHERE completed=0;
-- Pre-v7 admission used run creation. Preserve its provenance, never fabricate a learner action.
CREATE TABLE initial_introductions (
 target_id TEXT PRIMARY KEY REFERENCES targets(id), run_id TEXT NOT NULL REFERENCES runs(id),
 occurred_at_ms INTEGER NOT NULL, provenance TEXT NOT NULL
);
INSERT INTO initial_introductions SELECT target_id,id,started_at_ms,'legacy_run_admission_v6' FROM runs;
PRAGMA user_version=7;
