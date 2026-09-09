CREATE TABLE world_drafts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('editing','inbox','accepted','removed')),content TEXT NOT NULL,updated_at_ms INTEGER NOT NULL);
CREATE TABLE world_media(digest TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BLOB NOT NULL);
CREATE TABLE world_bindings(identity TEXT PRIMARY KEY,content TEXT NOT NULL);
PRAGMA user_version=14;
