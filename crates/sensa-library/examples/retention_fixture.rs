//! Synthetic integration-test database, created exclusively through public commands.
//! Usage: cargo run -p sensa-library --example retention_fixture -- /tmp/new.sqlite
use sensa_core::Action;
use sensa_library::{Command, CommandAction, execute_at, open_library};
use uuid::Uuid;
fn main() {
    let path = std::path::PathBuf::from(std::env::args().nth(1).expect("output path"));
    assert!(!path.exists(), "refusing to overwrite an existing library");
    let now = "2020-01-01T08:00:00Z".parse().unwrap();
    let apply = |action| {
        let s = open_library(&path).unwrap();
        execute_at(
            &path,
            Command {
                operation_id: Uuid::new_v4().to_string(),
                library_id: s.library_id,
                expected_revision: s.revision,
                action,
            },
            now,
        )
        .unwrap()
    };
    apply(CommandAction::ConfirmQuantity { quantity: 5 });
    apply(CommandAction::ImportPack {
        pack_json: include_str!("../tests/fixtures/local-text-pack-v1.json").into(),
    });
    apply(CommandAction::AddToLearning);
    let s = apply(CommandAction::StartOrResume);
    let r = s.run.unwrap();
    let s = apply(CommandAction::RecordAction {
        run_id: r.id,
        ordinal: r.ordinal,
        action: Action::Reveal,
    });
    let r = s.run.unwrap();
    apply(CommandAction::RecordAction {
        run_id: r.id,
        ordinal: r.ordinal,
        action: Action::Good,
    });
}
