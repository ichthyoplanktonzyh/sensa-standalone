use sensa_library::*;
#[test]
fn schema_ten_upgrade_preserves_snapshot_and_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("anchor-upgrade.sqlite");
    let s = open_library(&path).unwrap();
    let before = execute(
        &path,
        Command {
            operation_id: uuid::Uuid::new_v4().to_string(),
            library_id: s.library_id,
            expected_revision: s.revision,
            action: CommandAction::ConfirmQuantity { quantity: 5 },
        },
    )
    .unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    let receipt: String = db
        .query_row("SELECT result FROM operations", [], |r| r.get(0))
        .unwrap();
    db.execute_batch("DROP TABLE personal_anchor_revocations; DROP TABLE personal_anchor_grants; DROP TABLE personal_preparation_versions; PRAGMA user_version=10;").unwrap();
    drop(db);
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(open_library(&path).unwrap()).unwrap()
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT result FROM operations", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        receipt
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        11
    );
}
