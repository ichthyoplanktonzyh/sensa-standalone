ALTER TABLE sensa_consumer.runs DROP CONSTRAINT runs_purpose_check;
ALTER TABLE sensa_consumer.runs DROP CONSTRAINT runs_phase_check;
ALTER TABLE sensa_consumer.runs DROP CONSTRAINT runs_protocol_version_check;
ALTER TABLE sensa_consumer.runs DROP CONSTRAINT runs_retention_target_id_purpose_key;
ALTER TABLE sensa_consumer.runs ADD CHECK(purpose IN ('initial_learning','retention_review','relearning'));
ALTER TABLE sensa_consumer.runs ADD CHECK(phase IN ('recall','reveal','waiting','completed'));
ALTER TABLE sensa_consumer.runs ADD CHECK(protocol_version IN ('consumer-initial-v1','consumer-review-v1','consumer-relearning-v1'));
ALTER TABLE sensa_consumer.runs ADD COLUMN trigger_memory_revision BIGINT,
 ADD COLUMN trigger_due_at TIMESTAMPTZ,ADD COLUMN triggering_outcome_id UUID,ADD COLUMN next_eligible_at TIMESTAMPTZ;
CREATE UNIQUE INDEX consumer_one_initial_run ON sensa_consumer.runs(retention_target_id) WHERE purpose='initial_learning';
CREATE UNIQUE INDEX consumer_one_due_run ON sensa_consumer.runs(retention_target_id,trigger_memory_revision) WHERE purpose='retention_review';
ALTER TABLE sensa_consumer.completions DROP CONSTRAINT completions_retention_target_id_key;
ALTER TABLE sensa_consumer.completions DROP CONSTRAINT completions_kind_check;
ALTER TABLE sensa_consumer.completions DROP CONSTRAINT completions_evidence_level_check;
ALTER TABLE sensa_consumer.completions ADD CHECK(kind IN ('study_completion','review_completed','relearning_completion'));
ALTER TABLE sensa_consumer.completions ADD CHECK(evidence_level IN ('non_evidentiary','self_report'));
CREATE UNIQUE INDEX consumer_one_initial_completion ON sensa_consumer.completions(retention_target_id) WHERE kind='study_completion';
CREATE TABLE sensa_consumer.memory_outcomes (
 id UUID PRIMARY KEY,run_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.runs,
 retention_target_id UUID NOT NULL REFERENCES sensa.retention_targets,completion_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.completions,
 memory_revision BIGINT NOT NULL,due_at TIMESTAMPTZ NOT NULL,grade TEXT NOT NULL CHECK(grade IN ('again','hard','good')),
 basis TEXT NOT NULL CHECK(basis='learner_rated'),evidence_level TEXT NOT NULL CHECK(evidence_level='self_report'),occurred_at TIMESTAMPTZ NOT NULL,
 UNIQUE(retention_target_id,memory_revision)
);
ALTER TABLE sensa_consumer.scheduling_decisions ALTER COLUMN handoff_id DROP NOT NULL;
ALTER TABLE sensa_consumer.scheduling_decisions ADD COLUMN outcome_id UUID UNIQUE REFERENCES sensa_consumer.memory_outcomes;
ALTER TABLE sensa_consumer.scheduling_decisions ADD CHECK((handoff_id IS NULL)<>(outcome_id IS NULL));
CREATE TABLE sensa_consumer.relearning_needs (
 id UUID PRIMARY KEY,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 retention_target_id UUID NOT NULL REFERENCES sensa.retention_targets,
 triggering_outcome_id UUID NOT NULL UNIQUE REFERENCES sensa_consumer.memory_outcomes,
 run_id UUID UNIQUE REFERENCES sensa_consumer.runs,status TEXT NOT NULL CHECK(status IN ('pending','resolved')),
 next_eligible_at TIMESTAMPTZ NOT NULL,revision BIGINT NOT NULL DEFAULT 1,resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX consumer_one_pending_need ON sensa_consumer.relearning_needs(retention_target_id) WHERE status='pending';
ALTER TABLE sensa_consumer.runs ADD FOREIGN KEY(triggering_outcome_id) REFERENCES sensa_consumer.memory_outcomes;
CREATE INDEX consumer_due_memory ON sensa_consumer.retention_memory(learner_user_id,due_at);
CREATE INDEX consumer_waiting_needs ON sensa_consumer.relearning_needs(learner_user_id,status,next_eligible_at);
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.memory_outcomes,sensa_consumer.relearning_needs TO backend_app;
REVOKE ALL ON sensa_consumer.memory_outcomes,sensa_consumer.relearning_needs FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sensa_consumer.memory_outcomes,sensa_consumer.relearning_needs FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sensa_consumer.memory_outcomes,sensa_consumer.relearning_needs FROM authenticated; END IF;
END $$;
