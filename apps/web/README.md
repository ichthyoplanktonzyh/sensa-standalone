# Sensa Web

This is the Sensa-only React/Vite client. `/sensa` is the product entrypoint;
the root path redirects there. The client uses `@sensa/contracts` for HTTP
and Sync DTOs and `@sensa/learning-kernel` for the browser-safe learning
vocabulary.

The browser database is `sensa-standalone-v1` (schema version 3) and contains
only Sensa scope metadata, pinned Sense Learning Packages, mutable learning
projections, append-only Sync facts, and the learning outbox. It does not read
any other product's browser database or local storage.

For local use, run the standalone API first and then:

```sh
VITE_SENSA_API_URL=http://127.0.0.1:8080 VITE_WEB_PORT=3000 npm run web:dev
```

The initial load calls `/me`, negotiates Sync v2, pushes pending operations
before pulling, repairs a required bootstrap without clearing the outbox, and
then loads the active plan's pinned content. A network failure leaves a visible
local-save notice. Media controls only use short-lived download URLs returned
by the authorized Sensa media endpoint.
