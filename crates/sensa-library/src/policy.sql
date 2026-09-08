CREATE TABLE policy_assignments (
 id TEXT PRIMARY KEY,scope_kind TEXT NOT NULL CHECK(scope_kind IN ('learner','curriculum','target')),
 scope_key TEXT NOT NULL,revision INTEGER NOT NULL,profile_id TEXT,profile_version TEXT,
 occurred_at_ms INTEGER NOT NULL,UNIQUE(scope_kind,scope_key,revision),
 CHECK((profile_id IS NULL)=(profile_version IS NULL))
);
CREATE TABLE material_policy_sources (
 material_id TEXT NOT NULL REFERENCES materials(id),source_key TEXT NOT NULL,
 PRIMARY KEY(material_id,source_key)
);
CREATE TABLE target_policy_sources (
 target_id TEXT PRIMARY KEY REFERENCES targets(id),source_key TEXT
);
CREATE TABLE target_plans (
 id TEXT PRIMARY KEY,target_id TEXT NOT NULL REFERENCES targets(id),revision INTEGER NOT NULL,
 content TEXT NOT NULL,UNIQUE(target_id,revision)
);
CREATE TABLE policy_commitments (
 target_id TEXT PRIMARY KEY REFERENCES targets(id),
 initial_run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED,
 plan_id TEXT NOT NULL REFERENCES target_plans(id),committed_at_ms INTEGER NOT NULL,
 provenance TEXT NOT NULL
);
CREATE TABLE initial_run_policies (
 run_id TEXT PRIMARY KEY REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED,
 plan_id TEXT NOT NULL REFERENCES target_plans(id)
);
CREATE TABLE retention_run_policies (
 run_id TEXT PRIMARY KEY REFERENCES retention_runs(id),plan_id TEXT NOT NULL REFERENCES target_plans(id)
);
PRAGMA user_version=4;
