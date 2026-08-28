# Third-party notices

The first migration packet contains substantial MIT-licensed Sensa domain code
extracted from
[`kirill-markin/flashcards-open-source-app`](https://github.com/kirill-markin/flashcards-open-source-app),
Copyright (c) 2026 Kirill Markin. The complete license text is preserved in
[LICENSE](LICENSE).

The extracted code is limited to these upstream source paths and their
standalone destinations:

- `apps/backend/src/sensa/runtime/browserSafe.ts`, `runtime/contracts.ts`,
  `runtime/memoryOutcome.ts`, `runtime/rulePacketV1.ts`, `runtime/versions.ts`,
  and the pure scheduler/configuration modules →
  `packages/learning-kernel/src/runtime/` (the browser-safe implementation is
  consolidated in `browserSafe.ts`; scheduler/configuration live in
  `scheduling.ts` and `workspaceConfig.ts`);
- `apps/backend/src/sensa/catalog/contracts.ts`,
  `catalog/pinnedContentContracts.ts`, `planning/contracts.ts`,
  `encounter/contracts.ts`, and `sync/contracts.ts` →
  `packages/contracts/src/sensa/` (HTTP and sync DTOs);
- `apps/backend/src/sensa/content/packageValidator.ts` →
  `packages/content-validator/src/packageValidator.ts` (publication gate).
- `apps/backend/src/sensa/catalog/{postgres,pinnedContent}.ts`,
  `planning/postgres.ts`, `encounter/postgres.ts`, `sync/postgres.ts`,
  `media/{contracts,postgres,local}.ts`, and the database-bound
  `runtime/fsrsAdapter.ts` → `apps/api/src/sensa/` (Sensa-only application
  modules and adapters; the FSRS adapter is now named
  `runtime/postgresMemoryOutcomeModule.ts`).
- `apps/backend/src/routes/sensa{Catalog,PinnedContent,Planning,Encounter,Sync}.ts`
  → `apps/api/src/routes/` (Sensa HTTP route contracts); the standalone Media
  route is a local/R2 seam and does not copy the old storage implementation.
- `apps/web/src/sensa/SensaApp.tsx`, `apps/web/src/sensa/production/**`, and
  the Sensa-only style/icon/route modules → `apps/web/src/` (adapted Sensa
  shell and production learning screens). Generic flashcard App/Data/Decks
  surfaces are intentionally excluded.

It does not carry the upstream Cards, Decks, generic sync, AI/MCP, community,
catalog implementation, or AWS CDK product surfaces. Future copied components
must add their source path and license here before they are included.

## Content production migration

The production authoring closure was adapted from these MIT-licensed upstream
paths under `content/`:

- `content/tools/{automated_review,tts,validate_release}.py` → `content/tools/`;
- shared authoring dependencies `content/tools/{batch_inventory,dictionary,docio,inventory,inventory_db,llm}.py`
  → `content/tools/` (with the standalone path/provider-namespace adaptations
  documented in `content/README.md`);
- `content/prompts/automated-review.md` → `content/prompts/`;
- the inventory prompt and inventory/dictionary-evidence schemas remain source
  contracts; the state-driven `content/pipeline/` implementation and its focused
  authoring prompts were written for this standalone repository;
- `content/tools/run_validator.ts` was adapted to call the standalone
  `packages/content-validator`; the old backend import was intentionally
  removed;
- the old `sync_from_scenelex.py` behavior is represented by the
  explicit-path-only `content/tools/sync_from_external.py` seam. It has no
  default legacy path or runtime import.

Local authoring state is consolidated in the ignored `content/data/senses.db`; generated
release exports are derived data rather than application source. Dictionary/Wiktionary
and media license attribution remain content-release provenance requirements; a package
cannot be published unless its source evidence, source license and attribution fields are
present where applicable.

## Sensa Web design reference

The Sensa-only Web shell and information architecture were adapted from the
upstream design reference at
the previous repository's `docs/sensa/reference/bbdc/sensa-prototype.html`.
A copy is retained in this repository at
[`docs/reference/bbdc/sensa-prototype.html`](docs/reference/bbdc/sensa-prototype.html)
for visual review. The standalone implementation keeps only Sensa product
surfaces and does not copy the upstream generic flashcard application shell.
