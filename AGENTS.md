# Sensa working agreement

## Sources of truth

- `CONTEXT.md` and the seven documents listed in `docs/sensa/README.md` define the domain.
- `docs/sensa/product-requirements-v1.md` defines the current Web product experience.
- `docs/sensa/engineering.md` defines the current repository, validation and release workflow.
- Source code, schemas and CI configuration are authoritative for implementation details. Do not create progress documents that duplicate them.

## Active scope

Work on the production Web application, its browser extension, API, shared packages, content pipeline and deployment infrastructure. Native clients are paused; do not plan or modify them unless the owner explicitly resumes that work.

Preserve established Web behavior and data boundaries. Do not silently migrate, rewrite or discard owner data. UI code must not manufacture learning outcomes, evidence, schedules or successful sync states.

Historical data-format compatibility is not required by default. This does not authorize clearing owner libraries, browser profiles, cloud data or retained recovery files.

## Journey checkpoints and collaboration

Use a bounded long user journey as the unit of product work: define its user goal, success/recovery exits and current scope, inspect the real page transitions, reuse focused regression checks, and verify actual use at the required boundary before closing the checkpoint. User intent and understanding take priority over exposing domain or diagnostic concepts in the UI. For generic storage, queues, scheduling, search, sync and media concerns, first compare mature patterns described in `docs/sensa/engineering.md`.

The main agent owns production and test edits. When the owner authorizes sub-agents, use them for independent read-only review or real-browser acceptance, with new reviewers for a new journey; the owner's default is `gpt-6-luna` with `max` reasoning. Do not let reviewers modify production code or treat a review as permission for a broader change.

Use `tests/web/journeyMapping.mts` and `tests/web/catalog.mts` for reusable evidence selection. A link to a test, a historical acceptance report or a green release does not establish every branch's coverage. Keep actual run evidence with its tested revision and conditions; follow the evidence archive procedure in the engineering guide. Deferred capabilities and known gaps belong in issue tracking, not a second progress document.

## Validation and delivery

Use focused checks for the changed behavior, then run `npm run check` before handoff when the change can affect the shipped application. Use `npm run test:edge`, `npm run test:browser` or `npm run test:db` only when their boundary is affected. Python content changes must compile and pass a no-cost validator smoke. Routine validation must not call paid model or TTS services.

Web tests use Vitest when no real browser is required and Playwright Test for real Chromium, OPFS, lifecycle, and browser-plus-database scenarios. Register every Web test in `tests/web/catalog.mts` with its risk and CI boundary. Do not add `node:test` or a third general-purpose runner; standalone performance/load generators remain specialized tools.

Keep secrets, populated environment files, generated content and runtime media out of Git. Production changes run through the repository CI/CD workflows; push or deploy only when the owner explicitly requests it.
