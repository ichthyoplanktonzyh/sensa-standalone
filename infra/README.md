# Infrastructure boundary

The owner-approved initial deployment is Supabase Postgres/Auth/Storage, Cloudflare
static Web hosting, and Resend SMTP. The API candidate is Supabase Edge Functions;
its local Node/Deno compatibility checks do not establish hosted acceptance.
The former Neon/R2/Cognito plan is superseded by
[`production-migration-plan.md`](../docs/sensa/production-migration-plan.md).

`.github/workflows/sensa-consumer-check.yml` currently builds and validates against
synthetic local services. It does not deploy. No cloud resources are created by the
local content tools, smoke suites or extension builds. All provider deployment must
run through CI/CD after a concrete release is authorized.

See [`release-authorization.md`](../docs/sensa/release-authorization.md) for release
scope, account access, artifacts and the separate cloud/store authorization points.
