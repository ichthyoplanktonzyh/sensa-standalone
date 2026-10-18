-- A separately negotiated artifact; legacy binary snapshots remain intact.
ALTER TABLE sensa_consumer.library_cloud ADD COLUMN native_snapshot jsonb;
