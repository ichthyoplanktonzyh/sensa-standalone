-- Shared material and learner-target ownership remains in the existing library.
CREATE TABLE runtime_releases (
 id TEXT NOT NULL, version INTEGER NOT NULL, digest TEXT NOT NULL,
 content TEXT NOT NULL, PRIMARY KEY(id,version)
);
CREATE TABLE assurance_materials (
 material_id TEXT PRIMARY KEY REFERENCES materials(id),
 release_id TEXT NOT NULL, release_version INTEGER NOT NULL,
 package_key TEXT NOT NULL, package_version INTEGER NOT NULL,
 materialization_digest TEXT NOT NULL,
 FOREIGN KEY(release_id,release_version) REFERENCES runtime_releases(id,version)
);
CREATE TABLE runtime_media (digest TEXT PRIMARY KEY, mime_type TEXT NOT NULL, bytes BLOB NOT NULL);
PRAGMA user_version=6;
CREATE TABLE assurance_sessions (
 id TEXT PRIMARY KEY, purpose TEXT NOT NULL,
 state TEXT NOT NULL, ordinal INTEGER NOT NULL, paused INTEGER NOT NULL,
 completed INTEGER NOT NULL, started_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_active_assurance_session ON assurance_sessions((1)) WHERE completed=0;
CREATE TABLE assurance_session_targets (
 session_id TEXT NOT NULL REFERENCES assurance_sessions(id),
 target_id TEXT NOT NULL REFERENCES targets(id), run_id TEXT NOT NULL,
 material_id TEXT NOT NULL REFERENCES materials(id), material_digest TEXT NOT NULL,
 plan_id TEXT NOT NULL REFERENCES target_plans(id), PRIMARY KEY(session_id,target_id)
);
CREATE TABLE assurance_events (
 id TEXT PRIMARY KEY REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 session_id TEXT NOT NULL REFERENCES assurance_sessions(id), ordinal INTEGER NOT NULL,
 command TEXT NOT NULL, resulting_state TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL,
 UNIQUE(session_id,ordinal)
);
CREATE TABLE assurance_evidence (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED,
 session_id TEXT NOT NULL REFERENCES assurance_sessions(id), target_id TEXT NOT NULL REFERENCES targets(id),
 run_id TEXT NOT NULL, material_digest TEXT NOT NULL, action_key TEXT NOT NULL, task_key TEXT NOT NULL,
 capability TEXT NOT NULL, response TEXT NOT NULL, support TEXT NOT NULL,
 correct INTEGER NOT NULL, independent INTEGER NOT NULL, occurred_at_ms INTEGER NOT NULL
);

CREATE TABLE assurance_cycles (
 target_id TEXT PRIMARY KEY REFERENCES targets(id),
 cycle_id TEXT NOT NULL UNIQUE, content TEXT NOT NULL,
 need_id TEXT NOT NULL REFERENCES relearning_needs(id),
 run_id TEXT NOT NULL REFERENCES retention_runs(id), completed INTEGER NOT NULL
);
