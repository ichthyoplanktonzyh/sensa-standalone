ALTER TABLE sensa_consumer.offline_grants ADD COLUMN entry_operation_id UUID;
CREATE TABLE sensa_consumer.account_clock_grants (
 id UUID PRIMARY KEY,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 installation_id UUID NOT NULL REFERENCES sensa_consumer.installations,replica_id UUID NOT NULL,scope_epoch BIGINT NOT NULL,
 clock_session_id UUID NOT NULL,issued_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE sensa_consumer.checkins (
 id UUID PRIMARY KEY,learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 account_date DATE NOT NULL,revision BIGINT NOT NULL DEFAULT 1,time_zone TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('manual','formal_learning')),occurred_at TIMESTAMPTZ NOT NULL,
 run_id UUID REFERENCES sensa_consumer.runs,entry_operation_id UUID,operation_id UUID NOT NULL,
 UNIQUE(learner_user_id,account_date),CHECK((source='manual')=(run_id IS NULL AND entry_operation_id IS NULL)),
 CHECK(source<>'formal_learning' OR (run_id IS NOT NULL AND entry_operation_id IS NOT NULL))
);
ALTER TABLE sensa_consumer.changes DROP CONSTRAINT changes_entity_type_check;
ALTER TABLE sensa_consumer.changes ADD CHECK(entity_type IN ('plan','target','run','activity','check_in'));
GRANT SELECT,INSERT ON sensa_consumer.account_clock_grants,sensa_consumer.checkins TO backend_app;
REVOKE ALL ON sensa_consumer.account_clock_grants,sensa_consumer.checkins FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sensa_consumer.account_clock_grants,sensa_consumer.checkins FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sensa_consumer.account_clock_grants,sensa_consumer.checkins FROM authenticated; END IF;
END $$;
