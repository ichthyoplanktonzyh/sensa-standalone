# Sensa

Sensa is a sense-first language-learning service. A Lexeme groups related
forms, while each Sense is its own learning and scheduling identity. The
learning loop selects an intervention from the Sense's Acquisition Profile,
available assets, learner evidence, and five-dimensional semantic state. FSRS
handles when a Sense returns; the Semantic Learning Loop handles what happens
inside an encounter.

This repository is the independent Sensa monorepo, extracted from the
MIT-licensed `kirill-markin/flashcards-open-source-app` production base while
retaining only the foundation that Sensa needs: authentication and
learner scope, Postgres persistence, offline sync, FSRS, and client contracts.
Cards, Decks, generic flashcard routes, AI/MCP, community/catalog surfaces, and
historical experiments are not part of this repository.

## Documentation

Start with [`CONTEXT.md`](CONTEXT.md) for the ubiquitous language and
[`docs/sensa/README.md`](docs/sensa/README.md) for the authoritative document
map. Domain models, product requirements, versioned implementation contracts
and operational runbooks have separate responsibilities; an implementation
contract does not redefine the domain merely because it encodes a current V1/V2
delivery constraint.

## Current migration status

The standalone backend establishes the Sensa-only Catalog (including pinned
content), Planning, Encounter, Media, and Sync v1/v2 routes on a real Postgres
adapter, plus the local auth principal seam and operator import/repair tools.
The web packet adds the independent Sensa-only React surface, scope-bound
IndexedDB, and the prototype-aligned learning shell.
The production content packet is also complete: focused prompts, schemas and the
state-driven Profile/resource/review/TTS/package pipeline live under `content/`.
Local authoring state is unified in `content/data/senses.db`; generated release JSON is an
explicit, disposable export rather than a second source of truth.
The baseline keeps
`workspace_id` and `learner_user_id` behind the internal `LearnerScope`
compatibility seam so existing Sensa runtime semantics can be extracted without
making Workspace a public product concept.

## Local development

Requires Node 24 and PostgreSQL 18 or newer.

```sh
npm install
npm run typecheck
npm run build
npm run api:dev
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/v1/
```

For local first-user work, copy `.env.example`, create the persistent
`sensa_standalone_dev` database, and apply the baseline with an owner URL:

```sh
MIGRATION_DATABASE_URL=postgresql://<owner>:<password>@127.0.0.1:5432/sensa_standalone_dev npm run db:migrate
npm run sensa:first-user-import -- \\
  --source-root /absolute/path/to/validated-release \\
  --run-key standalone-v2 \\
  --database-url postgresql://<owner>:<password>@127.0.0.1:5432/sensa_standalone_dev \\
  --workspace-id <workspace-uuid> --learner-user-id <learner-id> \\
  --allow-insecure-local-db --replace-active-plan
```

If the local Book is already imported and only disposable learning records
were removed during testing, restore the first-user Study Plan without
re-importing or changing immutable content:

```sh
npm run sensa:restore-first-user-plan -- \\
  --database-url postgresql://<owner>:<password>@127.0.0.1:5432/sensa_standalone_dev \\
  --workspace-id <workspace-uuid> --learner-user-id <learner-id> \\
  --replica-id <web-replica-uuid> --allow-insecure-local-db
```

First export package-valid Builds with `content/tools/pipeline.py release`; the importer
reads that validator-qualified release root. At runtime set `SENSA_MEDIA_ROOT` to the
export's `media/audio` directory (or to an explicit external media handoff).
`SENSA_LOCAL_CONTENT_MEDIA_ROOT` remains a backward-compatible local alias.
Production media is intended for R2, and Cognito replaces local auth through
the adapter seam. AWS/Cloudflare/Neon/R2 deployment is not run by local scripts.

Start the API with `npm run api:dev` or `npm run api:start`. In local mode,
`/me` resolves the learner from `SENSA_LOCAL_LEARNER_ID`; no credential is
accepted and no non-loopback request can use this mode.

## Sensa Web

The standalone web client is the only product surface in `apps/web`. It uses
the same local learner scope as the API and stores only Sensa projections and
pending learning operations in the IndexedDB database `sensa-standalone-v1`.
It never reads the flashcard application's IndexedDB or local storage.

Set `VITE_SENSA_API_URL` (default `http://127.0.0.1:8080`) and, when needed,
`VITE_WEB_PORT` (default `3000`) before starting it:

```sh
npm install
VITE_SENSA_API_URL=http://127.0.0.1:8080 npm run api:dev
VITE_SENSA_API_URL=http://127.0.0.1:8080 VITE_WEB_PORT=3000 npm run web:dev
open http://localhost:3000/sensa
```

The browser bootstraps Sync v2 from `/me` and the active learner scope, then
loads the pinned Sense Learning Packages used by the active Study Plan. A
learning response is written to the Sensa outbox before it is sent to the
API; a failed response stays visible as a failed outbox record instead of
being silently discarded. Media buttons request an authorized URL from the
API and do not use absolute local file paths.

## Repository layout

```text
apps/api                 Sensa-only Hono API, domain modules, routes, and DB adapters
packages/contracts       Learner scope and public Sensa DTO contracts
packages/learning-kernel Pure Semantic Policy/runtime and FSRS handoff rules
packages/content-validator  Sense Learning Package publication gate
db/migrations             Schema-qualified Sensa Postgres baseline
content                   Production prompts, tools, schemas and local SQLite authoring state
infra                     Cloudflare/Neon/R2 deployment boundary (later)
docs                      Sensa architecture and migration notes
```
