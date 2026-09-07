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

- Postgres is the authoritative server store.
- Web uses its Sensa-only IndexedDB and outbox; writes are local first, then
  `push → pull` through `/sensa/sync/*`.
- API owns Semantic Policy, evidence, 5D projections, Memory Outcome and FSRS
  handoff. Clients never write derived state directly.
- Keep `LearnerScope` as the application seam while the compatibility schema is
  being reduced. Do not expose Workspace as a product feature.
- Web remains React. Mobile and desktop are one Flutter client for iOS,
  Android and desktop; it uses SQLite, local outbox and the same
  language-neutral API contracts. `apps/web-next` is a mobile-form behavior
  prototype: its UI is not promised to migrate to any production client;
  the cross-client assets are the domain docs, the seam shapes and the
  smoke suites.

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
