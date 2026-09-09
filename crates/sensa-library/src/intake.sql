CREATE TABLE native_intake_receipts(
 client_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 request_digest TEXT NOT NULL,
 receipt TEXT NOT NULL,
 PRIMARY KEY(client_id,operation_id)
);
PRAGMA user_version=16;
