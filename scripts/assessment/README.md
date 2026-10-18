# Single-user capacity assessment

These are specialized capacity tools, not another general test runner. Production
application and protocol files remain unchanged. All data must be synthetic.

The user goal is ordinary work in an old, large personal library: bounded list
and search, graph interaction, a small review batch, exact synchronization and
empty-client recovery. Count Sense×Expression learning connections separately
from Contexts, semantic nodes, Runs, review outcomes, action Events and DB rows.
Two Contexts sharing one Sense×Expression must not create duplicate Targets.

Use a fresh label for every invocation. Evidence is ignored under
`output/playwright/long-term-capacity-2250269b-20261012/`; never overwrite a failed
sample. `runBoundedCapacity.mts` saves source diffs and assessment sources before
launch, limits each invocation to ten minutes and 6 GiB summed descendant RSS,
and samples every 500 ms. Summed RSS can double-count shared pages and misses
between-sample peaks, reparented processes and the Docker VM. Track aggregate
machine pressure separately if running concurrent jobs. This assessment used
an additional manual 3 GiB new-artifact limit; larger targets are not permission
to fill the disk or increase existing product budgets.

Generate a lawful baseline with current commands and complete replay validation:

```sh
SENSA_TEST_MEMORY_LIBRARY=true node --import tsx scripts/assessment/runBoundedCapacity.mts \
  --label=generate-example -- node --import tsx scripts/generateRetentionCapacity.mts --targets=100
```

The generator returns an isolated `.tmp/retention-capacity-facts-*` directory.
It installs a validated synthetic public Book, enrolls actual Targets, completes
initial learning and actual due reviews under a controlled clock, then opens one
probe Review. It does not seed successful outcomes or FSRS fields. Defaults stay
unchanged. `--review-cycles=20` varies history at fixed Target count;
`--audio-bytes=524288` varies deterministic pseudorandom synthetic audio per
package member. These are not human activity, lexical quality, TTS or AI quality.
The generator currently accepts at most 10k Targets; this is a tool limit, not a
product capacity promise. Calibrate byte and command cost before designing a
larger equivalent generator. Never clone immutable causal IDs naively.

Verify old fixtures read-only before reuse; invalid fixtures must remain retained:

```sh
SENSA_TEST_MEMORY_LIBRARY=true node --import tsx scripts/verifyRetentionCapacity.mts \
  --fixture=.tmp/retention-capacity-facts-<actual-directory>
```

For this Mac, `runCapacityDatabase.mts` uses only the prior assessment container
`sensa-supplement-schema19-20261012`. It inherits its local fixture credential in
memory, creates a fresh `sensa_m1a_capacity_*` DB, applies ordinary migrations,
and restores the container's prior stopped/running condition. It retains the new
DB and all old data. It does not create credentials, use owner databases, public
tunnels or production Auth. For another environment, provision a designated
isolated DB separately and invoke `measureCapacity.mts` with the existing
`SENSA_ADMIN_TEST_DATABASE_URL` contract (loopback, `sensa_m1a_*` name).

```sh
node --import tsx scripts/assessment/runBoundedCapacity.mts --label=core-example -- \
  node --import tsx scripts/assessment/runCapacityDatabase.mts \
  scripts/assessment/measureCapacity.mts --label=core-example \
  --scenarios=world-100,mixed-100 --fixture=.tmp/retention-capacity-facts-<actual-directory> \
  --batch-reviews=100
```

Each scenario gets a new Chromium context, OPFS library and fixture account.
`world-N` uses one real accepted-command seed expanded by the existing
identity-consistent semantic fixture generator and validates the complete World.
Those complete semantic nodes are not enrolled ready Targets. `mixed-N` adds N
semantic nodes to the exact formal history fixture; `history-N` uses the formal
fixture only (N is a label, actual counts are read). `public-media-16/64` installs
100 public packages with that aggregate raw audio size, without enrollment.
Public cache bytes and private replica bytes are measured separately. Ordinary
quantity is explicitly confirmed through the formal command before reviews.
The fixed clock advances to legal due boundaries; it is not a same-day user trace.

The owner subsequently authorized an isolated prepare-budget experiment. Opt in
with both `SENSA_CAPACITY_EXPERIMENT=true` and `--decoded-prepare-cap-mib=128`.
`decodedFactBudgetExperiment.mts` changes exactly the `decodedSize>DECODED_CAP`
comparison in `Blocks.prepare()` inside the in-memory fixture Vite build; it never
edits `cloudSync.ts`. Production/default fixture behavior stays64MiB, fallback
download stays64MiB, and block/manifest/backup/package/authority limits remain.
The transform verifies the original source marker, applies once, and records
original/transformed SHA-256 plus exact experiment budget in measurements.json.
Only65..128MiB is accepted. Start with100 connections; require safe calibration
before1k. Keep the same watchdog,120s observation and manual disk limits. A pass
under128MiB is an experiment result, not production configuration acceptance.

Core phases execute real production modules and loopback HTTP→Hono→Postgres,
but are direct commands, not UI latency. Real UI cases remain in the registered
`personal-meaning-journey` and `retention-review-capacity` Playwright files.
The new `@capacity` graph case defaults to 1k semantic nodes; set
`SENSA_GRAPH_CAPACITY_SIZE` for a bounded exploration. Graph metrics end at
driver-observed DOM/camera conditions, not canvas paint. Graph nodes have no
shared edges in this fixture; linked/polysemous functional tests are separate.

Examples using existing registered Playwright Test cases (choose a new label):

```sh
SENSA_GRAPH_CAPACITY_SIZE=1000 node --import tsx scripts/assessment/runBoundedCapacity.mts \
  --label=graph-example -- npx playwright test tests/web/browser/personal-meaning-journey.spec.ts \
  --grep 'capacity graph exploration' --reporter=json
SENSA_RETENTION_CAPACITY_FIXTURE=.tmp/retention-capacity-facts-<actual-directory> \
  node --import tsx scripts/assessment/runBoundedCapacity.mts --label=retention-example -- \
  npx playwright test tests/web/browser/retention-review-capacity.spec.ts --reporter=json
```

The actual per-run command arrays and source fixture manifest hashes are in
`run-context.json`. Test preparation and existing test budgets remain authoritative;
the outer watchdog is an additional assessment safety boundary.

`--bootstrap-server` is a narrowly scoped baseline option for a verified, media-free
formal history fixture whose first client publication hits its decoded budget.
The helper normalizes exact facts and checks current codec roundtrips, then stores
blocks and commits through the existing isolated API. A normal empty Chromium
client restores that checkpoint. This bypasses client first publication and is
not onboarding success. The current helper does not reproduce inline data-URI
extraction or the client store-page byte budget; do not use it for inline-media
capacity conclusions. In the measured 1k case, every store body stayed below the
existing 3 MiB client budget. A 120s observation timeout can precede a later
promotion: inspect the subsequent diagnostic state and never infer data loss from
the timeout alone. No later phases run after that timeout.

`inventoryFixture.mts` verifies each retained batch digest/count and reports
actual connections, history, normalized private fact bytes/root, top-level field
and selected material subtree bytes. Nested fields and media occurrences overlap;
do not add them to full record bytes. It is read-only and is not a substitute for
the generator's complete replay validation.

Request bytes are UTF-8 JSON HTTP bodies after protocol block encoding. Stored
block bytes, decoded bytes, headers, network duration and wall time are distinct.
There is no HTTP gzip, TLS, production network or paid provider. Twenty no-change
samples support only local nearest-rank p50/p95; all other single operations are
single samples. Diagnostics, full hashing/validation and preparation are excluded
from operation timing. Sampled RSS and OPFS file sizes are not JS-only memory or
exclusive private/public physical bytes in the shared SQLite database.

`compareIndexLog.mts` is an offline hypothetical snapshot+index-log codec model
using exact captured row/ref maps. It checks serialized index snapshot and log
replay, model receipt/CAS, tombstones and pin-set accounting. It does not test
domain fact payload restore, durable API ACK, leases/GC, migration, explicit
conflict resolution or an O(delta) production implementation. Full map differencing
and cloning deliberately remain in the oracle. Periodic snapshot bytes are
reported; root/request overhead is excluded. Its output uses non-overwrite writes.

```sh
node --import tsx scripts/assessment/runBoundedCapacity.mts --label=index-example -- \
  node --import tsx scripts/assessment/compareIndexLog.mts --label=reproduction-example \
  --extra=output/playwright/long-term-capacity-2250269b-20261012/core-final100/measurements.json
```

This model also reads the retained prior `sync-scale-diagnostic` final capture.
Keep that capture with its original run context; it is not a new large-Target run.

Keep execution sources, source diffs, actual manifests/batch digests, native
results, traces, metrics, failures and independent reviews together. Use
`scripts/archiveJourneyEvidence.mts --sources=<json-path-list> --output=<fresh-dir>`
and verify its manifest. The commit identifies production source; source diffs
identify the uncommitted assessment harness used at each run.
