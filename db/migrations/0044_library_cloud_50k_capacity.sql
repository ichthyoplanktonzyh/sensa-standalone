-- Finite staged cloud tier. Legacy full manifests and external imports are
-- independently bounded; account block quota and per-page limits do not change.
ALTER TABLE sensa_consumer.library_cloud
 DROP CONSTRAINT library_cloud_record_count_check,
 ADD CONSTRAINT library_cloud_record_count_check CHECK(record_count BETWEEN 0 AND 600000);
ALTER TABLE sensa_consumer.library_cloud_staging
 DROP CONSTRAINT library_cloud_staging_check,
 DROP CONSTRAINT library_cloud_staging_metadata_bytes_check,
 ADD CONSTRAINT library_cloud_staging_check CHECK(pages BETWEEN 0 AND 200000 AND records BETWEEN 0 AND 600000),
 ADD CONSTRAINT library_cloud_staging_metadata_bytes_check CHECK(metadata_bytes BETWEEN 0 AND 134217728);

-- Derived byte witnesses are filled by the authenticated service from actual
-- decoded immutable blocks. Existing heads are measured in bounded windows on
-- their next write; NULL preserves the distinction from an empty Library.
ALTER TABLE sensa_consumer.library_cloud_blocks ADD COLUMN logical_bytes bigint CHECK(logical_bytes BETWEEN 0 AND 786432);
ALTER TABLE sensa_consumer.library_cloud_rows ADD COLUMN logical_bytes bigint CHECK(logical_bytes BETWEEN 0 AND 94371840);
ALTER TABLE sensa_consumer.library_cloud ADD COLUMN logical_bytes bigint CHECK(logical_bytes BETWEEN 0 AND 1073741824);
ALTER TABLE sensa_consumer.library_cloud_staging ADD COLUMN logical_bytes bigint CHECK(logical_bytes BETWEEN 0 AND 1073741824);
ALTER TABLE sensa_consumer.library_cloud_staging_rows ADD COLUMN logical_bytes bigint CHECK(logical_bytes BETWEEN 0 AND 94371840);
