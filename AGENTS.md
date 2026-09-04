# Sensa standalone working agreement

## Product boundary

This is the Sensa repository. Read `CONTEXT.md` and the document map in
`docs/sensa/README.md` before changing domain code. The five documents listed
there form the domain model. `current-stage.md` controls the milestone;
`product-requirements-v1.md` controls product IA;
`production-migration-plan.md` controls launch work. Versioned implementation
contracts cannot override the domain model.

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

AWS/Neon/R2/Cloudflare deployment is CI/CD work. Do not deploy from a local
shell. Keep `.env`, generated content data and runtime media out of Git. Public
production must replace local auth and local media with Cognito/R2 and add
monitoring/telemetry before launch.
