-- Explicit, purpose-limited permission. The captured sentence is already immutable on Meaning.
CREATE TABLE sensa_consumer.anchor_use_grants (
 id UUID PRIMARY KEY, learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 meaning_id UUID NOT NULL REFERENCES sensa_consumer.personal_meanings,
 context_anchor_id UUID NOT NULL, context_version TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose='learning_content'),
 provider TEXT NOT NULL CHECK(provider='deepseek'),
 policy_version TEXT NOT NULL CHECK(policy_version='original-context-v1'),
 granted_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX anchor_use_grants_current ON sensa_consumer.anchor_use_grants(meaning_id) WHERE revoked_at IS NULL;
ALTER TABLE sensa_consumer.personal_meanings ADD COLUMN anchor_use_grant_id UUID REFERENCES sensa_consumer.anchor_use_grants;
GRANT SELECT,INSERT ON sensa_consumer.anchor_use_grants TO backend_app;
GRANT UPDATE(revoked_at) ON sensa_consumer.anchor_use_grants TO backend_app;
GRANT UPDATE(anchor_use_grant_id) ON sensa_consumer.personal_meanings TO backend_app;
REVOKE ALL ON sensa_consumer.anchor_use_grants FROM PUBLIC;
ALTER TABLE sensa_consumer.provisioning_tasks ADD COLUMN superseded_at TIMESTAMPTZ;
ALTER TABLE sensa_consumer.provisioning_tasks DROP CONSTRAINT provisioning_tasks_learning_target_id_key;
CREATE UNIQUE INDEX provisioning_tasks_current ON sensa_consumer.provisioning_tasks(learning_target_id) WHERE superseded_at IS NULL;
CREATE OR REPLACE FUNCTION sensa_consumer.guard_provisioning_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='provisioning_tasks' THEN
  IF (to_jsonb(OLD)-ARRAY['revision','status','active_attempt_id','submitted_attempt_id','attempt_count','reason','materialization_id','updated_at','superseded_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['revision','status','active_attempt_id','submitted_attempt_id','attempt_count','reason','materialization_id','updated_at','superseded_at']) THEN
   RAISE EXCEPTION 'provisioning task input is immutable';
  END IF;
 ELSE
  IF (to_jsonb(OLD)-ARRAY['status','bundle','validation','reason','ended_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','bundle','validation','reason','ended_at']) OR (OLD.bundle IS NOT NULL AND OLD.bundle IS DISTINCT FROM NEW.bundle) OR (OLD.validation IS NOT NULL AND OLD.validation IS DISTINCT FROM NEW.validation) OR (OLD.ended_at IS NOT NULL AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.ended_at IS DISTINCT FROM NEW.ended_at)) THEN
   RAISE EXCEPTION 'provisioning attempt snapshot is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION sensa_consumer.guard_anchor_use_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (to_jsonb(OLD)-'revoked_at') IS DISTINCT FROM (to_jsonb(NEW)-'revoked_at') OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS DISTINCT FROM NEW.revoked_at) THEN
  RAISE EXCEPTION 'anchor use grant is immutable and revocation is final';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER anchor_use_grant_snapshot BEFORE UPDATE ON sensa_consumer.anchor_use_grants FOR EACH ROW EXECUTE FUNCTION sensa_consumer.guard_anchor_use_grant();
REVOKE ALL ON FUNCTION sensa_consumer.guard_anchor_use_grant() FROM PUBLIC;
