# Sensa working agreement

## Sources of truth

- `CONTEXT.md` and the seven documents listed in `docs/sensa/README.md` define the domain.
- `docs/sensa/product-requirements-v1.md` defines the current Web product experience.
- `docs/sensa/engineering.md` defines the current repository, validation and release workflow.
- Source code, schemas and CI configuration are authoritative for implementation details. Do not create progress documents that duplicate them.

## Active scope

Work on the production Web application, its browser extension, API, shared packages, content pipeline and deployment infrastructure. Native clients are paused; do not plan or modify them unless the owner explicitly resumes that work.

Preserve established Web behavior and data boundaries. Do not silently migrate, rewrite or discard owner data. UI code must not manufacture learning outcomes, evidence, schedules or successful sync states.

## Validation and delivery

Use focused checks for the changed behavior, then run `npm run check` before handoff when the change can affect the shipped application. Use `npm run test:edge`, `npm run test:browser` or `npm run test:db` only when their boundary is affected. Python content changes must compile and pass a no-cost validator smoke. Routine validation must not call paid model or TTS services.

Keep secrets, populated environment files, generated content and runtime media out of Git. Production changes run through the repository CI/CD workflows; push or deploy only when the owner explicitly requests it.
