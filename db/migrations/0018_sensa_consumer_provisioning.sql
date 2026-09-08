-- Unified target admission inputs. The public catalog remains a filtered compatibility view.
ALTER TABLE sensa_consumer.catalog_candidates RENAME TO target_candidates;
ALTER TABLE sensa_consumer.target_candidates ADD COLUMN learner_user_id TEXT REFERENCES sensa_consumer.accounts(learner_user_id);
CREATE VIEW sensa_consumer.catalog_candidates AS SELECT id,sense_id,sense_version_id,binding_id,binding_version_id,expression,meaning,target_language,familiar_language,learner_locale,source,admission,content,content_digest,review_reference,published_at FROM sensa_consumer.target_candidates WHERE learner_user_id IS NULL WITH LOCAL CHECK OPTION;
GRANT SELECT ON sensa_consumer.catalog_candidates TO backend_app;
GRANT INSERT ON sensa_consumer.target_candidates TO backend_app;
CREATE TABLE sensa_consumer.provisioning_tasks (
 id UUID PRIMARY KEY,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 learning_target_id UUID NOT NULL UNIQUE REFERENCES sensa.learning_targets,meaning_id UUID NOT NULL REFERENCES sensa_consumer.personal_meanings,
 scope_epoch BIGINT NOT NULL,revision BIGINT NOT NULL DEFAULT 1,status TEXT NOT NULL CHECK(status IN ('pending','generating','validating','ready','blocked','cancelled')),
 fixed_input JSONB NOT NULL,active_attempt_id UUID,submitted_attempt_id UUID,attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 reason TEXT,materialization_id UUID REFERENCES sensa.learning_materializations,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE sensa_consumer.provisioning_attempts (
 id UUID PRIMARY KEY,task_id UUID NOT NULL REFERENCES sensa_consumer.provisioning_tasks,sequence INTEGER NOT NULL,
 request JSONB NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','submitted','failed','timed_out','cancelled')),
 bundle JSONB,validation JSONB,reason TEXT,lease_until TIMESTAMPTZ NOT NULL,started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,
 UNIQUE(task_id,sequence)
);
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.provisioning_tasks,sensa_consumer.provisioning_attempts TO backend_app;
REVOKE ALL ON sensa_consumer.provisioning_tasks,sensa_consumer.provisioning_attempts FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sensa_consumer.provisioning_tasks,sensa_consumer.provisioning_attempts FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sensa_consumer.provisioning_tasks,sensa_consumer.provisioning_attempts FROM authenticated; END IF;
END $$;

-- A task pins its input; an ended agent cannot replace its request or submitted bundle.
CREATE FUNCTION sensa_consumer.guard_provisioning_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='provisioning_tasks' THEN
  IF (to_jsonb(OLD)-ARRAY['revision','status','active_attempt_id','submitted_attempt_id','attempt_count','reason','materialization_id','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['revision','status','active_attempt_id','submitted_attempt_id','attempt_count','reason','materialization_id','updated_at']) THEN
   RAISE EXCEPTION 'provisioning task input is immutable';
  END IF;
 ELSE
  IF (to_jsonb(OLD)-ARRAY['status','bundle','validation','reason','ended_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','bundle','validation','reason','ended_at']) OR (OLD.bundle IS NOT NULL AND OLD.bundle IS DISTINCT FROM NEW.bundle) OR (OLD.validation IS NOT NULL AND OLD.validation IS DISTINCT FROM NEW.validation) OR (OLD.ended_at IS NOT NULL AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.ended_at IS DISTINCT FROM NEW.ended_at)) THEN
   RAISE EXCEPTION 'provisioning attempt snapshot is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provisioning_task_snapshot BEFORE UPDATE ON sensa_consumer.provisioning_tasks FOR EACH ROW EXECUTE FUNCTION sensa_consumer.guard_provisioning_snapshot();
CREATE TRIGGER provisioning_attempt_snapshot BEFORE UPDATE ON sensa_consumer.provisioning_attempts FOR EACH ROW EXECUTE FUNCTION sensa_consumer.guard_provisioning_snapshot();
REVOKE ALL ON FUNCTION sensa_consumer.guard_provisioning_snapshot() FROM PUBLIC;
