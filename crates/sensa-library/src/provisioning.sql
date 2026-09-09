-- Logical learning targets may exist before an executable material projection.
CREATE TABLE personal_learning_tasks (
 id TEXT PRIMARY KEY, sense_version_id TEXT NOT NULL,binding_version_id TEXT NOT NULL,
 content TEXT NOT NULL, UNIQUE(sense_version_id,binding_version_id)
);
CREATE TABLE personal_task_entries (
 meaning_id TEXT PRIMARY KEY REFERENCES personal_meanings(id),
 task_id TEXT NOT NULL REFERENCES personal_learning_tasks(id),
 operation_id TEXT NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE personal_content_attempts (
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES personal_learning_tasks(id),
 request TEXT NOT NULL,result TEXT,started_at_ms INTEGER NOT NULL
);
PRAGMA user_version=10;
