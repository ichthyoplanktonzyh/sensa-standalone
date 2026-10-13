-- Transport bytes of an existing committed cursor H. Current refs/log/snapshot
-- and durable receipts remain authority; a newer floor makes this unavailable.
ALTER TABLE sensa_consumer.library_cloud ADD COLUMN binary_snapshot jsonb;
