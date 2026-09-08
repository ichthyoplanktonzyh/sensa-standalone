# Sensa standalone working agreement

## Product boundary

This is the Sensa repository. Read `CONTEXT.md` and the document map in
`docs/sensa/README.md` before changing domain code. The seven documents listed
there form the domain model. `current-stage.md` controls the milestone;
`product-requirements-v1.md` controls product IA;
`production-migration-plan.md` controls the production roadmap, milestone gates,
and launch work. Versioned implementation
contracts cannot override the domain model.

## Development workflow

Follow [`docs/sensa/development-workflow.md`](docs/sensa/development-workflow.md)
as the current, adjustable working agreement. The supervisor owns the global
module/directory blueprint, data ownership, dependencies, shared types and
contracts; workers own internal implementation details within those boundaries.
For each user-facing use case, the owner and a designated supervisor or worker
first confirm the frontend experience, functions and relevant states. Refine
consumer contracts and persistence from that confirmed experience, then implement
and verify an end-to-end vertical slice. Existing backend shapes do not dictate
the product workflow. Reuse confirmation already given for the same scope.
Default to one implementation writer; parallel work requires explicit independent
ownership. Adjust the process using actual delivery feedback instead of freezing
every file and helper function in advance.

Do not reintroduce Cards, Decks, generic flashcard sync, AI/MCP, community,
commerce, admin or unrelated old-client surfaces. Do not use
`docs/sensa/semantic-learning-loop.md`, `content/experiments/`, or other
deprecated prototype reports as implementation input.

## Architecture

- Target architecture follows ADR 0001/0002: Flutter/Dart owns PC/mobile UI and
  platform integration; Rust owns the local domain core and SQLite transactions;
  TypeScript owns the browser extension, React Web and Hono online services.
- Local learning does not require an online account or running Hono. UI never
  writes derived outcomes, evidence or schedules directly; the local core validates
  and commits them. Optional sync transfers end-to-end encrypted personal data.
- Existing API/Postgres/IndexedDB-outbox authority is migration-era implementation,
  not the target architecture. Preserve it as regression evidence until each Rust
  slice is validated; do not migrate owner data or silently dual-write histories.
- Keep LearnerScope as the existing application seam during migration. Do not expose
  Workspace as a product feature. Browser/Agent intake uses the same acceptance rules.
- Formal Flutter UI references the confirmed apps/web experience and adapts it to
  each platform. apps/web-next remains a behavior prototype, not a production UI source.
- Rust WASM reuse for Web remains a separate validation task; neither native platform
  scaffolding nor a build alone proves platform acceptance.

## Validation and delivery

Use targeted integration/browser smoke checks for primary flows; do not add
blanket unit-test suites. Run `npm run typecheck`, `npm run build` and
`npm run lint` before handoff. Python content tools must at least compile and
run a no-cost validator smoke. Never call paid LLM/TTS during validation.

All provider deployment is CI/CD work. Do not deploy from a local
shell. Keep `.env`, generated content data and runtime media out of Git. Public
production must replace local auth and local media with Supabase Auth/Storage and add
monitoring/telemetry before launch.

## Owner execution preference (2026-09-07)

The owner explicitly requires the primary agent to perform all subsequent work directly.
Do not use implementation workers, subagents, or OpenCode delegation. This overrides
older worker-mode instructions. Browser testing is authorized. Continue in the original
working tree and use CI/CD for cloud deployments.

After each completed and validated vertical use-case slice, create a Git checkpoint commit.
This is owner-authorized; do not push or deploy without the applicable delivery authorization.

Owner additionally authorized bounded DeepSeek API material-generation trials and edge-tts audio
generation (2026-09-07). Keep these opt-in and separate from routine no-cost/CI validation.

## Owner product preference (2026-09-08)

Sensa is intended to be a closed-source product. Read Frog may be used as a
product-behavior reference. The owner permits reading its source to understand
behavior and edge cases (2026-09-08); do not copy, vendor, or translate its source
code into Sensa. Implement the confirmed reading interactions in Sensa's own
code. Preserve existing third-party license notices; this preference does not
authorize removing them or changing the licenses of pre-existing dependencies.
