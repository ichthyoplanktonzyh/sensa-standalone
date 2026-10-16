-- A durable fair cursor for scheduled slices, independent of user activity.
-- This grants no operational role new authority or automatic deletion rights.
ALTER TABLE sensa_consumer.library_cloud
 ADD COLUMN maintenance_at timestamptz NOT NULL DEFAULT '-infinity';
CREATE INDEX library_cloud_maintenance ON sensa_consumer.library_cloud(maintenance_at,account_id)
 WHERE library_id IS NOT NULL OR revision=0;
