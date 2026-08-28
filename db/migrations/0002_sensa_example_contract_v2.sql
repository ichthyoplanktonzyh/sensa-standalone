-- Sensa content contract v2: initial 3 Study + 3 Quiz, optional annotations,
-- and an expandable quiz pool.  Legacy 3+7 rows remain readable.

ALTER TABLE sensa.example_assets
  DROP CONSTRAINT IF EXISTS example_assets_ordinal_range;

ALTER TABLE sensa.example_assets
  ADD CONSTRAINT example_assets_ordinal_positive CHECK (ordinal > 0);

ALTER TABLE sensa.example_assets
  ALTER COLUMN disambiguating_cue DROP NOT NULL,
  ALTER COLUMN variation_note DROP NOT NULL;

ALTER TABLE sensa.example_assets
  ALTER COLUMN collocations SET DEFAULT '{}';

ALTER TABLE sensa.example_assets
  DROP CONSTRAINT IF EXISTS example_assets_cue_nonempty,
  DROP CONSTRAINT IF EXISTS example_assets_variation_nonempty,
  DROP CONSTRAINT IF EXISTS example_assets_collocations_nonempty;
