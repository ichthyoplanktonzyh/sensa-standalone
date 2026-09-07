CREATE TABLE sensa_consumer.activities (
 id UUID PRIMARY KEY, learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 mode TEXT NOT NULL CHECK(mode IN ('mixed','review_only')),status TEXT NOT NULL CHECK(status IN ('active','paused','ended')),
 revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0), current_run_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX consumer_one_active_activity ON sensa_consumer.activities(learner_user_id) WHERE status='active';
CREATE TABLE sensa_consumer.policy_commitments (
 retention_target_id UUID PRIMARY KEY REFERENCES sensa.retention_targets,
 policy_id TEXT NOT NULL CHECK(policy_id='lightweight'),policy_version TEXT NOT NULL CHECK(policy_version='v1'),
 committed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE sensa_consumer.runs (
 id UUID PRIMARY KEY,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 learning_target_id UUID NOT NULL REFERENCES sensa.learning_targets,retention_target_id UUID NOT NULL REFERENCES sensa.retention_targets,
 activity_id UUID NOT NULL REFERENCES sensa_consumer.activities,
 purpose TEXT NOT NULL CHECK(purpose='initial_learning'),status TEXT NOT NULL CHECK(status IN ('active','completed')),
 phase TEXT NOT NULL CHECK(phase IN ('recall','reveal','completed')),revision BIGINT NOT NULL DEFAULT 1,
 ordinal INTEGER NOT NULL DEFAULT 1,attempt_count INTEGER NOT NULL DEFAULT 0,cycle_index INTEGER NOT NULL DEFAULT 0,
 materialization_id UUID NOT NULL REFERENCES sensa.learning_materializations,material_digest TEXT NOT NULL,
 protocol_version TEXT NOT NULL CHECK(protocol_version='consumer-initial-v1'),started_at TIMESTAMPTZ NOT NULL,
 last_action_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,UNIQUE(retention_target_id,purpose),CHECK((status='completed')=(phase='completed'))
);
CREATE UNIQUE INDEX consumer_one_active_run ON sensa_consumer.runs(retention_target_id) WHERE status='active';
ALTER TABLE sensa_consumer.activities ADD FOREIGN KEY(current_run_id) REFERENCES sensa_consumer.runs;
CREATE TABLE sensa_consumer.activity_runs(activity_id UUID REFERENCES sensa_consumer.activities,run_id UUID REFERENCES sensa_consumer.runs,PRIMARY KEY(activity_id,run_id));
CREATE TABLE sensa_consumer.daily_starts (
 learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),account_date DATE NOT NULL,
 retention_target_id UUID NOT NULL REFERENCES sensa.retention_targets,run_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.runs,
 time_zone TEXT NOT NULL,PRIMARY KEY(learner_user_id,account_date,retention_target_id)
);
CREATE TABLE sensa_consumer.run_steps (
 id UUID PRIMARY KEY,run_id UUID NOT NULL REFERENCES sensa_consumer.runs,ordinal INTEGER NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('recall','reveal')),UNIQUE(run_id,ordinal)
);
CREATE TABLE sensa_consumer.offline_grants (
 id UUID PRIMARY KEY,run_id UUID NOT NULL REFERENCES sensa_consumer.runs,installation_id UUID NOT NULL REFERENCES sensa_consumer.installations,
 replica_id UUID NOT NULL,scope_epoch BIGINT NOT NULL,base_revision BIGINT NOT NULL,
 material_digest TEXT NOT NULL,protocol_version TEXT NOT NULL,clock_session_id UUID NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,last_elapsed_ms BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE sensa_consumer.run_attempts (
 id UUID PRIMARY KEY,run_id UUID NOT NULL REFERENCES sensa_consumer.runs,step_id UUID NOT NULL REFERENCES sensa_consumer.run_steps,
 operation_id UUID NOT NULL UNIQUE,grant_id UUID NOT NULL REFERENCES sensa_consumer.offline_grants,
 raw_action JSONB NOT NULL,occurred_at TIMESTAMPTZ NOT NULL,received_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE sensa_consumer.run_transitions (
 id UUID PRIMARY KEY,attempt_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.run_attempts,
 run_id UUID NOT NULL REFERENCES sensa_consumer.runs,next_phase TEXT NOT NULL,protocol_version TEXT NOT NULL
);
CREATE TABLE sensa_consumer.completions (
 id UUID PRIMARY KEY,run_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.runs,retention_target_id UUID NOT NULL UNIQUE REFERENCES sensa.retention_targets,
 activity_id UUID NOT NULL REFERENCES sensa_consumer.activities,operation_id UUID NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind='study_completion'),evidence_level TEXT NOT NULL CHECK(evidence_level='non_evidentiary'),completed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE sensa_consumer.scheduling_handoffs (
 id UUID PRIMARY KEY,retention_target_id UUID NOT NULL UNIQUE REFERENCES sensa.retention_targets,
 completion_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.completions,basis TEXT NOT NULL CHECK(basis='protocol_completion')
);
CREATE TABLE sensa_consumer.scheduling_decisions (
 id UUID PRIMARY KEY,handoff_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.scheduling_handoffs,
 policy_version TEXT NOT NULL CHECK(policy_version='sensa-lightweight-scheduling-v1'),schedule JSONB NOT NULL,decided_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE sensa_consumer.retention_memory (
 retention_target_id UUID PRIMARY KEY REFERENCES sensa.retention_targets,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 revision BIGINT NOT NULL DEFAULT 1,due_at TIMESTAMPTZ NOT NULL,schedule JSONB NOT NULL,
 scheduling_decision_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.scheduling_decisions
);
ALTER TABLE sensa_consumer.changes DROP CONSTRAINT changes_entity_type_check;
ALTER TABLE sensa_consumer.changes ADD CHECK(entity_type IN ('plan','target','run','activity'));
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.activities,sensa_consumer.policy_commitments,sensa_consumer.runs,
 sensa_consumer.activity_runs,sensa_consumer.daily_starts,sensa_consumer.run_steps,sensa_consumer.offline_grants,
 sensa_consumer.run_attempts,sensa_consumer.run_transitions,sensa_consumer.completions,
 sensa_consumer.scheduling_handoffs,sensa_consumer.scheduling_decisions,sensa_consumer.retention_memory TO backend_app;
REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM authenticated; END IF;
END $$;
