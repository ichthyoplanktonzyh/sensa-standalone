-- Incremental M1-A access/quantity storage. No legacy facts are rewritten.
CREATE SCHEMA IF NOT EXISTS sensa_consumer;
REVOKE ALL ON SCHEMA sensa_consumer FROM PUBLIC;
CREATE TABLE sensa_consumer.invitations (
  issuer TEXT NOT NULL, subject TEXT NOT NULL, revoked BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (issuer, subject)
);
CREATE TABLE sensa_consumer.accounts (
  account_id TEXT PRIMARY KEY REFERENCES core.accounts(account_id),
  learner_user_id TEXT NOT NULL UNIQUE REFERENCES core.learners(learner_user_id),
  issuer TEXT NOT NULL, subject TEXT NOT NULL, time_zone TEXT NOT NULL,
  epoch BIGINT NOT NULL DEFAULT 1 CHECK(epoch > 0), feed_head BIGINT NOT NULL DEFAULT 0,
  UNIQUE(issuer,subject), FOREIGN KEY(issuer,subject) REFERENCES sensa_consumer.invitations(issuer,subject)
);
CREATE TABLE sensa_consumer.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id TEXT NOT NULL REFERENCES sensa_consumer.accounts,
  provider_session_id UUID NOT NULL, revoked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(account_id,provider_session_id)
);
CREATE TABLE sensa_consumer.installations (
  id UUID PRIMARY KEY, account_id TEXT NOT NULL REFERENCES sensa_consumer.accounts,
  platform TEXT NOT NULL CHECK(platform IN ('web','extension','flutter')),
  replica_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
CREATE TABLE sensa_consumer.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), learner_user_id TEXT NOT NULL UNIQUE REFERENCES sensa_consumer.accounts(learner_user_id),
  revision BIGINT NOT NULL CHECK(revision > 0), scope_revision BIGINT NOT NULL DEFAULT 1,
  daily_new_limit SMALLINT NOT NULL CHECK(daily_new_limit IN (5,10,15,20,30)),
  quantity_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(), policy_key TEXT NOT NULL DEFAULT 'lightweight-v1'
);
CREATE TABLE sensa_consumer.operations (
  learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id), operation_id UUID NOT NULL,
  digest TEXT NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(learner_user_id,operation_id)
);
CREATE TABLE sensa_consumer.changes (
  learner_user_id TEXT NOT NULL REFERENCES sensa_consumer.accounts(learner_user_id), sequence BIGINT NOT NULL,
  snapshot JSONB NOT NULL, PRIMARY KEY(learner_user_id,sequence)
);
-- Server-only schema: never add it to PostgREST exposed schemas or grant client roles access.
REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM PUBLIC;
GRANT USAGE ON SCHEMA sensa_consumer TO backend_app;
GRANT SELECT ON sensa_consumer.invitations TO backend_app;
GRANT SELECT, INSERT, UPDATE ON sensa_consumer.accounts, sensa_consumer.sessions,
  sensa_consumer.installations, sensa_consumer.plans, sensa_consumer.operations,
  sensa_consumer.changes TO backend_app;

DO $$
BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON SCHEMA sensa_consumer FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM anon;
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON SCHEMA sensa_consumer FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA sensa_consumer FROM authenticated;
  END IF;
END $$;
