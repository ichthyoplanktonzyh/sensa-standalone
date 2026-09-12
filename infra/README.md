# Infrastructure boundary

The owner-approved initial deployment is Supabase Postgres/Auth/Storage, Cloudflare
static Web hosting, and Resend SMTP. The API candidate is Supabase Edge Functions;
its local Node/Deno compatibility checks do not establish hosted acceptance.
The former Neon/R2/Cognito plan is superseded by
[`production-migration-plan.md`](../docs/sensa/production-migration-plan.md).

`.github/workflows/sensa-consumer-check.yml` runs static checks, fast no-browser checks
and PostgreSQL/API integration for pull requests and `main`. User journeys are not a
release gate while their product flow is still being decided; the former browser smoke
workflow and its mixed-purpose scripts were removed instead of preserving stale behavior.

`.github/workflows/sensa-web-candidate.yml` builds the deployable Web, extension and
compiled API artifacts once and records their digests. `.github/workflows/sensa-web-deploy.yml`
verifies and promotes those exact artifacts, applies forward migrations, deploys the API,
uploads a previewable Cloudflare Worker version, verifies it, and then promotes that version.
Promotion requires the successful candidate run for the same full commit SHA and explicit
owner authorization. Confirmed user journeys will receive new E2E coverage later.
No cloud resources are created by local content tools or test suites. All provider deployment
must run through CI/CD after a concrete release is authorized.

See [`release-authorization.md`](../docs/sensa/release-authorization.md) for release
scope, account access, artifacts and the separate cloud/store authorization points.
