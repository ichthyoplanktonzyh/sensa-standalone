# Sensa content production

`content/` is the standalone authoring and immutable-release boundary for Sensa.
Production is organized around an isolated `SensePackageBuild`, not a fixed Job 1–10
sequence. The domain resource model is
[`../docs/sensa/sense-learning-resource-model.md`](../docs/sensa/sense-learning-resource-model.md).

Creators do not need to use this repository's authoring pipeline. The distribution seam for
all Published Lightweight Content, including Sensa Official releases, is the single-file
[Portable Lightweight Package](portable-lightweight-package.md): a `.sensa` ZIP archive
containing the public `package.json` contract and content-addressed raw media. Core/Overlay
splitting, prompts, provider choices, review stages and build storage are implementation
details of Sensa Official production. Official status comes from the Registry and protected
publication evidence, never from a privileged runtime payload or a field the file can self-assert.

## Architecture

```text
authoritative facts
  -> Acquisition Profile
  -> Grounding + Examples + conditional resources
  -> deterministic text compilation
  -> independent whole-package semantic review
  -> approved-text compilation
  -> content-addressed media
  -> package validator
  -> isolated release candidate
```

`data/senses.db` is the only authoritative local content store. It contains Sense facts,
frozen dictionary evidence, verified Lexeme forms, mutable Build selections, immutable
stage Attempts, append-only Build events and content-addressed media metadata. The package
gate writes its JSON candidate only to a temporary directory.

JSON is retained as a wire/export format: `pipeline.py release` materializes one isolated
release root for validation and API/Postgres ingestion. That directory is derived,
rebuildable and ignored by Git. YAML is not used by the production workflow.

Selecting a replacement attempt invalidates only downstream stages. Approved upstream
artifacts are not regenerated because an unrelated Example, review or TTS operation failed.

## Concurrency boundary

Package production supports bounded, single-host concurrency. Different Senses may advance
in parallel, while a renewable SQLite lease allows only one active producer for a Sense
across all of its Builds. `run`, `repair`, `retry` and `rebuild-text` acquire that lease
before any external call. A heartbeat retains ownership during a long provider request;
an expired owner can be recovered, but cannot commit an Attempt or Build revision after
losing the lease.

Concurrent non-forced `create` calls for the same Sense and fact digest resolve to one
current Build. Build revisions still use optimistic compare-and-swap as a second protection.
TTS uses a separate expiring claim per cache key, so concurrent packages share one synthesis
and contenders consume the completed content-addressed result.

These leases coordinate processes that share one local `senses.db`. They are not a
distributed/cloud queue and must not be used across hosts or a network filesystem.

## Current V2 delivery adapter

The authoring model treats Examples as reusable resources with `study`, `cloze` and
`transfer` usages. The current application/database still consumes the V2 role contract,
so the compiler selects three distinct Study candidates and at least three distinct Cloze
candidates and emits legacy `study | quiz` roles. This is a delivery adapter, not the
domain definition of Example.

No scene-domain or construction diversity quota is enforced. Those fields remain
descriptive metadata required by the current V2 wire shape.

## Portable Book release delivery

The official producer emits one independently valid `.sensa` per Lightweight member and a
Book Version Manifest that orders and references those artifacts. Each source names a stable
`bookKey`, positive `versionNumber`, publication
time, learner-facing change summary, exact Target/Support languages, and a separate
`senseVersion` and `bindingVersion` for every entry. Raising the Book version alone does
not change a Learning Target: semantic or primary-expression identity changes must be
declared by raising the corresponding entry version.

Build one Registry candidate without publishing anything:

```sh
npm run build -w @sensa/learning-kernel
npm run build -w @sensa/contracts
npm run build -w @sensa/content-validator
node --import tsx scripts/release/buildPortableBookRegistry.mts
node --import tsx tests/web/run.mts --suite=fast --id=learning-registry
node --import tsx tests/web/run.mts --suite=fast --id=portable-learning-registry
```

The builder requires the authored source to declare its publisher, author and license,
plus a positive `packageVersion` for every member. It writes content-addressed packages,
Book Version Manifests and `release-candidate/portable-catalog.json`. Generated release
files remain ignored build artifacts. By default it includes every JSON source in
`content/authored/`; a bounded custom build may override the list with comma-separated
`SENSA_BOOK_RELEASE_SOURCES` paths or point `SENSA_BOOK_RELEASE_SOURCE_DIRECTORY` at a
directory of derived Book sources. Set `SENSA_PACKAGE_EXISTING_CATALOG` when a bounded
batch must be merged into an already-built Registry candidate; existing descriptors are
retained byte-for-byte, and a duplicate Book version is rejected. The existing catalog
and output catalog may be the same local path because the old snapshot is read before the
new one is written.

The reviewed multilingual foundation is fixed at
`content/authored/route-foundation-v1/prepared.json`. The protected publication workflow
expands that file into all 18 × 18 route Book sources, adds the direct JSON Books from
`content/authored/`, and builds one Registry. The prepared file is the reviewed authoring
input; the expanded per-route files and release artifacts remain ignored outputs.

`scripts/release/publishPortableLearningRegistry.mjs` implements the immutable upload
order Package → Manifest → Registry and verifies the public bytes at every step. The
protected workflow promotes this Registry only after all referenced Manifest and Package
bytes are public and verified. The Web Catalog validates the same hierarchy and sends every
member through the Portable installation authority.

Authored audio and images use the same content-addressed release seam. A source
stores only `{ "sha256": "…", "mimeType": "audio/mpeg" }` or
`{ "sha256": "…", "mimeType": "image/jpeg" }`; approved bytes live outside Git
under `content/data/media/audio/<sha256>.mp3` and
`content/data/media/images/<sha256>.jpg`. Set `SENSA_AUTHORED_MEDIA_ROOT` to an
equivalent sealed media directory when building elsewhere. The release builder
verifies the digest, MIME signature and size before embedding the bytes as a
raw media inside the immutable `.sensa`. It never fetches arbitrary media or calls
a generation provider. Missing or changed media fails the build. Scene images
are capped by the saved-image contract and remain attached to the materialized
experience recall cue.

For protected CI publication, seal the exact referenced objects into one ignored
release input and record the printed SHA-256:

```sh
node --import tsx content/tools/route_foundation.mts \
  expand content/authored/route-foundation-v1/prepared.json .tmp/release-book-sources
cp content/authored/*.json .tmp/release-book-sources/
SENSA_BOOK_RELEASE_SOURCE_DIRECTORY=.tmp/release-book-sources \
  node --import tsx scripts/release/buildAuthoredMediaPack.mts
```

The resulting `release-candidate/authored-media-pack.json` is uploaded as a
GitHub Release asset, not committed. The publication workflow downloads the
owner-selected release asset, verifies its whole-file digest, then sets
`SENSA_AUTHORED_MEDIA_PACK`; the builder also verifies every inner object and
rejects missing or unused bytes.

Production publication is only through the protected
`sensa-learning-content-publish.yml` workflow. It uploads and verifies every `.sensa`, then
its Book Manifest, publishes the Registry last, and promotes the API's public Registry URL.
It makes no model or TTS calls and never overwrites an existing object.

## Layout

```text
pipeline/    Build model, store, fact loader, validation, stages, compiler and orchestrator
tools/       operator CLI, provider adapters, inventory tools and no-cost validators
prompts/     focused Profile, Grounding, Example, conditional-resource and review prompts
schema/      inventory and dictionary-evidence source schemas
data/        canonical senses.db, content-addressed MP3 objects and input wordlists
```

## Command flow

All commands run from the repository root.

Validate or inspect an externally produced portable package without network, model or TTS
calls:

```sh
npm run sensa:package -- pack path/to/authoring-directory path/to/package.sensa
npm run sensa:package -- validate path/to/package.sensa
npm run sensa:package -- inspect path/to/package.sensa
```

Create an isolated Build and load immutable facts without an external call:

```sh
python3 content/tools/pipeline.py create --sense borrow-01
python3 content/tools/pipeline.py plan --sense borrow-01
python3 content/tools/pipeline.py inspect --sense borrow-01
```

Generate Profile and text candidates, stopping before independent review:

```sh
python3 content/tools/pipeline.py run \
  --sense borrow-01 \
  --until review_pending \
  --allow-llm
```

Run the separately configured whole-package semantic reviewer:

```sh
python3 content/tools/pipeline.py run \
  --sense borrow-01 \
  --until text_approved \
  --allow-review
```

Compile approved text, use/rebuild media, and run the package gate:

```sh
python3 content/tools/pipeline.py run \
  --sense borrow-01 \
  --until package_valid \
  --allow-tts
```

`--allow-tts` authorizes only cache misses. Existing content-addressed audio is reused
without a provider call.

Advance an explicit set of Senses concurrently:

```sh
python3 content/tools/pipeline.py batch \
  --sense borrow-01 \
  --sense lend-01 \
  --sense-file /absolute/path/to/additional-sense-ids.txt \
  --until package_valid \
  --concurrency 4 \
  --llm-concurrency 2 \
  --review-concurrency 1 \
  --tts-concurrency 2 \
  --allow-llm --allow-review --allow-tts
```

The batch command never discovers or processes all historical Senses implicitly. It
deduplicates only the supplied IDs, preserves their input order in the JSON report and
returns nonzero if any Sense is blocked, busy or failed. External-stage limits are
independent, apply within that batch process, and may not exceed the overall worker
concurrency. Run one batch coordinator when provider-wide rate limits must be enforced.

Repair one resource without discarding approved upstream work:

```sh
python3 content/tools/pipeline.py repair \
  --sense borrow-01 \
  --stage examples \
  --artifact-id example-abc123-01 \
  --instruction 'Replace this example: its event expresses the sibling Sense.' \
  --allow-llm
```

Profile, full Grounding, all Examples or all conditional resources can also be repaired by
omitting `--artifact-id`. Grounding accepts `experience_sketch` or `l1_bridge` as targeted
artifact IDs.

Retry a transient reviewer, media-provider or deterministic-gate failure without
discarding the selected authoring artifacts:

```sh
python3 content/tools/pipeline.py retry \
  --sense borrow-01 \
  --stage media \
  --allow-tts
```

Semantic review retries require `--allow-review` and deliberately bypass a cached
rejection. Package-gate retries are no-cost and are intended for rerunning the gate after
compiler or validator fixes; semantic content failures should be repaired upstream.

After a deterministic compiler/review-input contract change, preserve all authoring
resources and invalidate only compilation and its downstream proof/media/gate:

```sh
python3 content/tools/pipeline.py rebuild-text --sense borrow-01
```

Export one or more package-valid Builds into an isolated release root and run the no-cost
release validator:

```sh
python3 content/tools/pipeline.py release \
  --build build-borrow-01-... \
  --out /tmp/sensa-release-calibration-01
```

Repeat `--build` to assemble several packages. The command does not publish to Postgres,
R2 or any cloud provider. The destination must not already exist. Export is assembled and
validated in a unique sibling staging directory, then atomically renamed; concurrent
exporters cannot overwrite the same release root.

## External-call boundaries

The CLI has three independent permissions:

- `--allow-llm`: Profile and content generation through `SENSA_ACQUISITION_LLM_*`;
- `--allow-review`: independent semantic review through `SENSA_REVIEW_LLM_*`;
- `--allow-tts`: external TTS for media cache misses.

No permission implies another. `plan`, `inspect`, deterministic compilation, package
validation and release validation never call an external provider.

Provider settings belong in ignored `content/.env`, copied from `.env.example`. Credentials
must not be passed on the command line or stored in Build documents. Attempts retain only
provider/model/request/prompt/digest provenance.

## No-cost verification

```sh
python3 -m compileall -q content/pipeline content/tools
python3 content/tools/pipeline.py --help
python3 content/tools/smoke_pipeline.py
python3 content/tools/smoke_pipeline_concurrency.py
python3 content/tools/validate_release.py --help
```

The state smoke creates a temporary authoring database and isolated Build, compiles a
complete fixture, runs the real TypeScript package validator, and proves downstream
invalidation. The concurrency smoke covers idempotent create, Sense lease exclusion and
recovery, lost-lease commit rejection, stale revisions, TTS single-flight and atomic
release publication. Neither smoke calls LLM, reviewer or TTS providers.

## Inventory and evidence

Inventory remains a separate factual workflow. It precedes Package Builds and must not be
silently modified by content generation:

```sh
python3 content/tools/inventory.py draft borrow --allow-external
python3 content/tools/inventory.py validate borrow
python3 content/tools/inventory.py mark-reviewed borrow
python3 content/tools/inventory.py approve borrow
```

The Pipeline reads factual tables through query-only connections while Build state is
transactionally written to other tables in the same `data/senses.db`. If Sense identity,
source evidence or verified forms are incomplete, the Build is blocked and a new Build
must be created after the factual source is repaired.

## Release boundary

A package-valid Build is not a published release. Publication still requires an immutable
release root, shared Lexeme/Relation consistency, real media bytes, complete review proof,
the public curriculum gate when applicable, and controlled API/database/media ingestion.
Local tools never deploy AWS, Neon, R2 or Cloudflare resources.

## Consumer static pronunciation candidates

For one already accepted target expression, `python3 content/tools/consumer_pronunciation.py
--text '<expression>' --output-dir /tmp/sensa-pronunciation --allow-tts` performs one opt-in TTS
call. Run the same command with `--validate` instead of `--allow-tts` for a no-cost media check.
The tool emits a content-addressed MP3, manifest and SQL candidate for controlled review/CI
ingestion; it never uploads or deploys. Do not commit generated media or manifests.
