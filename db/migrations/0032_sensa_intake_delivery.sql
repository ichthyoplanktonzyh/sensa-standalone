-- An account has one current local delivery destination. Switching libraries
-- must be an explicit future operation, never a registration race.
ALTER TABLE sensa_consumer.intake_envelopes
  ALTER COLUMN envelope SET NOT NULL;

CREATE UNIQUE INDEX intake_channels_one_enabled_per_account
  ON sensa_consumer.intake_channels(account_id)
  WHERE enabled = true;

COMMENT ON TABLE sensa_consumer.intake_envelopes IS
  'Account-scoped remote Intake mailbox. Payload JSON is server-readable; semantic admission remains local.';
