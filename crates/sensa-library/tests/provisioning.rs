use sensa_library::*;
#[test]
fn schema_nine_upgrade_preserves_learning_and_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let s = open_library(&path).unwrap();
    let command = Command {
        operation_id: uuid::Uuid::new_v4().to_string(),
        library_id: s.library_id,
        expected_revision: s.revision,
        action: CommandAction::ConfirmQuantity { quantity: 5 },
    };
    let before = execute(&path, command).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    let receipts:String=db.query_row("SELECT json_group_array(json_object('id',id,'command',command,'result',result)) FROM operations",[],|r|r.get(0)).unwrap();
    db.execute_batch("DROP TABLE practice_operations; DROP TABLE practice_turns; DROP TABLE practice_sessions; DROP TABLE practice_state; DROP TABLE curriculum_introduction_sources; DROP TABLE activity_scope_sources; DROP TABLE curriculum_scopes; DROP TABLE curriculum_settings; DROP TABLE curriculum_supplemental; DROP TABLE curriculum_members; DROP TABLE curriculum_enrollments; DROP TABLE curriculum_books; ALTER TABLE activity_scope DROP COLUMN new_eligible; DROP TABLE personal_anchor_revocations; DROP TABLE personal_anchor_grants; DROP TABLE personal_preparation_versions; DROP TABLE personal_task_entries; DROP TABLE personal_content_attempts; DROP TABLE personal_learning_tasks; PRAGMA user_version=9;").unwrap();
    drop(db);
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(open_library(&path).unwrap()).unwrap()
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(db.query_row("SELECT json_group_array(json_object('id',id,'command',command,'result',result)) FROM operations",[],|r|r.get::<_,String>(0)).unwrap(),receipts);
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        13
    );
}
