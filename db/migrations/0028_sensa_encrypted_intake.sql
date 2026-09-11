-- Account-scoped opaque delivery storage. No personal plaintext or recovery keys.
CREATE TABLE sensa_consumer.intake_channels (
 account_id text NOT NULL REFERENCES sensa_consumer.accounts(account_id),
 library_id uuid NOT NULL, config jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,library_id)
);
CREATE TABLE sensa_consumer.intake_envelopes (
 account_id text NOT NULL, library_id uuid NOT NULL, operation_id uuid NOT NULL,
 client_id uuid NOT NULL, envelope jsonb, envelope_digest text NOT NULL, receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,library_id,operation_id),
 FOREIGN KEY(account_id,library_id) REFERENCES sensa_consumer.intake_channels ON DELETE CASCADE
);
CREATE TABLE sensa_consumer.intake_device_requests (
 account_id text NOT NULL, library_id uuid NOT NULL, device_id uuid NOT NULL,
 request jsonb NOT NULL, grant_envelope text, expires_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,library_id,device_id),
 FOREIGN KEY(account_id,library_id) REFERENCES sensa_consumer.intake_channels ON DELETE CASCADE
);
ALTER TABLE sensa_consumer.intake_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa_consumer.intake_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensa_consumer.intake_device_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY intake_channels_backend ON sensa_consumer.intake_channels TO backend_app USING(true) WITH CHECK(true);
CREATE POLICY intake_envelopes_backend ON sensa_consumer.intake_envelopes TO backend_app USING(true) WITH CHECK(true);
CREATE POLICY intake_device_requests_backend ON sensa_consumer.intake_device_requests TO backend_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON sensa_consumer.intake_channels,sensa_consumer.intake_envelopes,sensa_consumer.intake_device_requests TO backend_app;
REVOKE ALL ON sensa_consumer.intake_channels,sensa_consumer.intake_envelopes,sensa_consumer.intake_device_requests FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 REVOKE ALL ON sensa_consumer.intake_channels,sensa_consumer.intake_envelopes,sensa_consumer.intake_device_requests FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 REVOKE ALL ON sensa_consumer.intake_channels,sensa_consumer.intake_envelopes,sensa_consumer.intake_device_requests FROM authenticated;
 END IF;
END $$;
