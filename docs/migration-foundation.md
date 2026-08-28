# Standalone foundation

> Status: implementation snapshot; not a domain model  
> Domain source: [`sensa/README.md`](sensa/README.md)

## Boundary

`packages/learning-kernel` contains dependency-free, deterministic rules that
can run in a browser or server. `packages/contracts` contains the HTTP and
sync DTO boundary. `packages/content-validator` contains the frozen package
publication gate. These packages stay independent of storage and hosting.

`apps/api` contains the Sensa backend vertical slice. Catalog, pinned content,
Planning, Encounter, Media and Sync v1/v2 route handlers use the Postgres
adapters and the local principal seam. The server remains authoritative for
next Action, Evidence, semantic state, Memory Outcome and FSRS handoff.

The Web client uses `/me`, pinned plan content, Planning, Encounter open and
media metadata/local audio, plus Sensa Sync bootstrap/push/pull. Learning
responses are complete Sync v2 operations in IndexedDB before transport.

`GET /me` keeps the small account envelope expected by the existing Web
transport: `userId`, `selectedWorkspaceId`, `authTransport`, `csrfToken`,
`profile { email, locale, createdAt }`, and
`preferences { reviewReactionAnimationsEnabled }`. Standalone local auth uses
`authTransport: "bearer"` with a null CSRF token; the extra `learnerUserId`,
`subjectUserId`, and `transport` fields identify the Sensa learner scope.

## Database baseline

`db/migrations/0001_sensa_baseline.sql` is a clean schema-qualified baseline.
It contains learner scope, replica compatibility, media metadata and Sensa
Content, Curriculum, Runtime, Learner-Declared Mastery and Sync tables. The
runtime keeps immutable facts separate from mutable projections.

The baseline currently creates local `backend_app` and `auth_app` roles when
they do not exist so a fresh local database can be validated without importing
the old platform's role bootstrap. Provider-specific role ownership and
grants must be reviewed before production deployment.

The baseline also contains an explicit `org.workspace_memberships` view and
`org.user_settings` table as extraction seams for the current Sensa adapters.
They are not generic flashcard tables and can be removed once the LearnerScope
schema is made the only application-facing identity.
