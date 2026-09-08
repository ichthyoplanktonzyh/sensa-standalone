CREATE TABLE sensa_consumer.intakes (
 id UUID PRIMARY KEY, learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id),
 revision BIGINT NOT NULL DEFAULT 1, identity_digest TEXT NOT NULL, snapshot JSONB NOT NULL,
 saved_at TIMESTAMPTZ NOT NULL, UNIQUE(learner_user_id,identity_digest)
);
ALTER TABLE sensa_consumer.changes DROP CONSTRAINT changes_entity_type_check;
ALTER TABLE sensa_consumer.changes ADD CHECK(entity_type IN ('plan','target','run','activity','check_in','intake'));
GRANT SELECT,INSERT ON sensa_consumer.intakes TO backend_app;
REVOKE ALL ON sensa_consumer.intakes FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sensa_consumer.intakes FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sensa_consumer.intakes FROM authenticated; END IF;
END $$;
CREATE TABLE sensa_consumer.extension_codes (
 code_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(account_id),
 session_id UUID NOT NULL REFERENCES sensa_consumer.sessions,scope_epoch BIGINT NOT NULL,
 installation_id UUID NOT NULL,state TEXT NOT NULL,challenge TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,consumed BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE sensa_consumer.extension_credentials (
 token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(account_id),
 session_id UUID NOT NULL REFERENCES sensa_consumer.sessions,scope_epoch BIGINT NOT NULL,
 installation_id UUID NOT NULL,expires_at TIMESTAMPTZ NOT NULL
);
GRANT SELECT,INSERT,UPDATE ON sensa_consumer.extension_codes TO backend_app;
GRANT SELECT,INSERT ON sensa_consumer.extension_credentials TO backend_app;
REVOKE ALL ON sensa_consumer.extension_codes,sensa_consumer.extension_credentials FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON sensa_consumer.extension_codes,sensa_consumer.extension_credentials FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON sensa_consumer.extension_codes,sensa_consumer.extension_credentials FROM authenticated; END IF;
END $$;
