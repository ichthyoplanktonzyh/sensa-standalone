CREATE TABLE personal_anchor_grants (
 id TEXT PRIMARY KEY, meaning_id TEXT NOT NULL REFERENCES personal_meanings(id),
 content TEXT NOT NULL, operation_id TEXT NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE personal_anchor_revocations (
 grant_id TEXT PRIMARY KEY REFERENCES personal_anchor_grants(id),
 operation_id TEXT NOT NULL REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED, occurred_at_ms INTEGER NOT NULL
);
CREATE TABLE personal_preparation_versions (
 id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES personal_learning_tasks(id), content TEXT NOT NULL
);
INSERT INTO personal_preparation_versions
SELECT json_extract(content,'$.planRevision'),id,
 json_object('id',json_extract(content,'$.planRevision'),'targetId',id,
             'target',json_extract(content,'$.target'),'policy',json_extract(content,'$.policy'),
             'anchor',json_extract(content,'$.anchor'))
FROM personal_learning_tasks;
PRAGMA user_version=11;
