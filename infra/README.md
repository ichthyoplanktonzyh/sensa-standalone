# Infrastructure boundary

The standalone deployment target is Cloudflare for the Web/API edge, Neon for
Postgres, R2 for private media bytes, and Cognito for authentication. This
packet creates no provider resources and runs no deployment locally. CI/CD and
the production migration runbook will be added after the API, Web, and sync
adapters are extracted.
