# Sensa native — local learning acceptance slices

Flutter/Dart calls a Rust application module through generated flutter_rust_bridge
bindings. SQLite transactions own the operation ledger, attempts, completion,
scheduling handoff, review outcomes, relearning needs and memory state. No Hono/API/account is used at runtime.

This is a **bounded acceptance application**, not the complete product UI:
- Reuses the confirmed Web colors and lightweight Recall → Reveal → rating behavior.
- Requires explicit daily quantity, material loading and enrollment.
- Contains one clearly labeled synthetic material, enabled by the Rust bridge's
  `acceptance-fixture` feature. General package import/publication is not implemented.
- Initial hard/good settle once; again returns to recall. Pause/reopen preserves the Run.
- Due time is real local time plus the existing initial scheduling policy's interval.
  Lightweight review/relearning and multiple text targets are supported. Personal capture,
  Agent intake, E2EE sync, backup/export and old-data migration remain pending.
- The library is in application support under `local-acceptance/acceptance-v1.sqlite`,
  separate from any existing Web/API account or user library.

## Structure

- `../../crates/sensa-core`: pure Rust purpose-specific protocols/settlements and configurable FSRS, no IO.
- `../../crates/sensa-library`: SQLite schema and atomic commands. Only its Rust API writes facts.
- `rust/src/api/library.rs`: asynchronous bridge to the library; generated glue in
  `rust/src/frb_generated.rs` and `lib/src/rust/`.
- `lib/data/`: read projections/repository; `lib/ui/`: ViewModel and Flutter view.
- `rust_builder/`: generated platform packaging, including Cargokit with its original licenses.
  Its Gradle task has a small local compatibility patch: injected `ExecOperations`
  replaces the `Project.exec` API removed in Gradle 9. Preserve this patch when
  regenerating/updating the packaging template until upstream supplies it.
  The Android bridge also uses compile SDK 36 to match the application and its
  current AndroidX dependencies.

## Build and checks

Install Flutter and Rust, plus each target platform's SDK/toolchain. Generator,
Rust crate and Dart bridge are pinned together at **flutter_rust_bridge 2.12.0**.
Commit both Cargo locks and pubspec.lock; generated bindings are checked in.

```sh
# Repository root: compare the current TS decisions against Rust's fixed vectors,
# then exercise SQLite rollback, idempotence, concurrency and recovery.
npm run sensa:native-core-smoke
cargo clippy --workspace --all-targets --features sensa-library/acceptance-fixture -- -D warnings

# This directory:
flutter pub get
flutter analyze
flutter run -d macos
# For an Android emulator, replace macos with its device ID.
```

After bridge API changes:

```sh
cargo install flutter_rust_bridge_codegen --version 2.12.0 --locked
flutter_rust_bridge_codegen generate
```

UI integration uses real Rust/SQLite. Pick a **new run name** for each write test,
then reuse exactly that name for the recovery process. Never point it at user data.

```sh
flutter test integration_test/local_learning_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=my-new-run
flutter test integration_test/local_learning_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=my-new-run --dart-define=SENSA_NATIVE_RECOVERY=true
```

The second command launches a fresh app process and compares the entire persisted
projection with the first process's receipt. It does not reset/reseed the library.
The receipt lives alongside that isolated test library; it is not domain authority.
For Android, use `--no-uninstall` in **both** commands: Flutter otherwise removes
the application and its data after an integration run, invalidating recovery checks.

```sh
flutter test -v --no-uninstall integration_test/local_learning_test.dart -d emulator-5554 --dart-define=SENSA_NATIVE_RUN=my-new-android-run
flutter test -v --no-uninstall integration_test/local_learning_test.dart -d emulator-5554 --dart-define=SENSA_NATIVE_RUN=my-new-android-run --dart-define=SENSA_NATIVE_RECOVERY=true
```

The generated platform scaffolds do not imply iOS/Windows/Linux/Web acceptance.
Rust's native SQLite module is not WebAssembly compatible as-is; Web needs a storage
adapter and a separate integration, not a claim that native builds work in browsers.

## Local text-pack import

After quantity setup, choose **导入学习包**, select a `sensa-local-text-pack-v1`
JSON file, then explicitly choose **加入学习** for each target. Use **选择其他内容**
to switch; the previous run is paused and its material and progress stay pinned.
The OS picker grants read access only to the selected file. Nothing is uploaded.

A synthetic example is at
`../../crates/sensa-library/tests/fixtures/local-text-pack-v1.json`.
This bounded text transport is not yet a general Published Package importer:
media, other protocols/languages and material replacement are rejected rather
than discarded. See `../../docs/sensa/native-pack-import-contract.md`.

The pack integration test injects the selected file contents while using real
Flutter/Rust/SQLite. It does not automate the OS picker itself. Use a fresh run
name for the first command; reuse it for recovery. Android requires
`--no-uninstall` in both commands.

```sh
flutter test integration_test/pack_import_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=my-pack-run
flutter test integration_test/pack_import_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=my-pack-run --dart-define=SENSA_NATIVE_RECOVERY=true
```

## Local retention

**只复习** selects due reviews and pending relearning without resuming unfinished
initial learning. **再回想** in a review saves the original rating once and schedules
relearning in ten minutes; **提前回想** is an explicit early return. Completing
relearning preserves the review rating and FSRS schedule. Waiting survives restart.
The shell reports lifetime counts, not a full Activity summary.

The integration fixture is a synthetic already-due library created through the
public Rust commands by `crates/sensa-library/examples/retention_fixture.rs`.
It is embedded only in test source. Never seed a real library or change device time.

```sh
flutter test integration_test/retention_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=my-retention-run
flutter test integration_test/retention_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=my-retention-run --dart-define=SENSA_NATIVE_RECOVERY=true
```

For Android replace `-d macos` with `-d emulator-5554 --no-uninstall` in both runs.
See `../../docs/sensa/native-retention-handoff.md` for scope and evidence.
