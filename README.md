# Sensa

Sensa is a sense-first language-learning product. This repository contains the production Web application, browser extension, API, shared domain/runtime packages, content tooling and deployment configuration.

Native clients are paused. They are not part of current feature planning or release work.

## Development

Node.js 24 or newer is required.

```sh
npm ci
npm run dev:sensa
```

The managed entry opens `http://127.0.0.1:3000` with an isolated development Web/API/database boundary. Raw `api:dev`, `web:dev` and `web:preview` are single-module debugging commands, not a complete acceptance environment. Provider/model opt-ins and production-preview/offline checks are documented in [engineering.md](docs/sensa/engineering.md). Do not commit populated environment files.

Common checks:

```sh
npm run check
npm run test:edge
npm run test:browser
```

Database-backed checks use a disposable PostgreSQL database and the migration command documented in [engineering.md](docs/sensa/engineering.md).

## Documentation

- [Domain document map](docs/sensa/README.md)
- [Web product](docs/sensa/product-requirements-v1.md)
- [Long user journeys](docs/sensa/user-journeys.md)
- [Journey evidence selection](tests/web/journeyMapping.mts) and [test catalog](tests/web/catalog.mts)
- [Engineering and release](docs/sensa/engineering.md)
- [Support and recovery](docs/sensa/support-recovery.md)
- [Content tooling](content/README.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Project progress and deployment history belong in Git, GitHub Actions and issue tracking, not in long-lived Markdown files.

For a new task, read `AGENTS.md` and the document map, choose the affected journey and its current product scope, then list its existing checks before adding new ones:

```sh
node --import tsx tests/web/run.mts --journey=LJ-16 --list
```

The engineering guide also documents immutable local evidence archives and how to verify them. Historical reports preserve their original observations; they are not current passing verdicts.

## Repository layout

```text
apps/web                  production React Web application
apps/browser-extension    browser reading and capture extension
apps/api                  Hono API used locally and by the hosted service
packages                  contracts, domain/runtime modules and validators
supabase/functions        production Edge Function entrypoint
db/migrations             forward-only database migrations
content                   content schemas, prompts and authoring tools
scripts                   validation, maintenance and release automation
infra                     deployment support files
docs/sensa                domain, product and engineering documentation
```
