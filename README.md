# Sensa

Sensa is a sense-first language-learning product. This repository contains the production Web application, browser extension, API, shared domain/runtime packages, content tooling and deployment configuration.

Native clients and `apps/web-next` are paused. They are not part of current feature planning or release work.

## Development

Node.js 24 or newer is required.

```sh
npm install
npm run api:dev
npm run web:dev
```

Public browser configuration belongs in `apps/web/.env.local`; start from `apps/web/.env.example`. API configuration belongs in `apps/api/.env`; start from `apps/api/.env.example`. Do not commit populated environment files.

Common checks:

```sh
npm run typecheck
npm run build
npm run lint
npm run sensa:web-bootstrap-budget
```

Database-backed checks use a disposable PostgreSQL database and the migration command documented in [engineering.md](docs/sensa/engineering.md).

## Documentation

- [Domain document map](docs/sensa/README.md)
- [Web product](docs/sensa/product-requirements-v1.md)
- [Engineering and release](docs/sensa/engineering.md)
- [Content tooling](content/README.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Project progress and deployment history belong in Git, GitHub Actions and issue tracking, not in long-lived Markdown files.

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
