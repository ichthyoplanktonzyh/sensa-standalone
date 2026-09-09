CREATE TABLE practice_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,selection TEXT NOT NULL);
INSERT INTO practice_state VALUES(1,0,'{"sourceId":"current_study"}');
CREATE TABLE practice_sessions(id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),content TEXT NOT NULL,state TEXT NOT NULL,created_at_ms INTEGER NOT NULL);
CREATE UNIQUE INDEX one_active_practice ON practice_sessions((1)) WHERE status='active';
CREATE TABLE practice_turns(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES practice_sessions(id),ordinal INTEGER NOT NULL,content TEXT NOT NULL,occurred_at_ms INTEGER NOT NULL,UNIQUE(session_id,ordinal));
CREATE TABLE practice_operations(id TEXT PRIMARY KEY,command TEXT NOT NULL,result TEXT NOT NULL);
PRAGMA user_version=13;
