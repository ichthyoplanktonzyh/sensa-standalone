-- One C-collation primary key serves both exact identity and keyset paging.
-- The key columns/uniqueness and retirement index remain unchanged. Changing
-- collation rebuilds the primary key; only then retire the duplicate page index.
ALTER TABLE sensa_consumer.library_cloud_snapshots
 ALTER COLUMN table_name TYPE text COLLATE "C",
 ALTER COLUMN record_key TYPE text COLLATE "C";
DROP INDEX sensa_consumer.library_cloud_snapshot_generation_page;
