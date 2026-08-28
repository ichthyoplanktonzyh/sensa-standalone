# Sensa Sync Contract

Status: **Versioned technical contract; not a domain model**  
Wire status: **`sensa-sync-v1` frozen; additive `sensa-sync-v2` accepted**  
Date: 2026-08-24

Backend implementation status (2026-08-24): **Wave 1 v1 Application/Route complete; Wave 3 additive v2 implemented locally**. The production PostgreSQL Adapter and authenticated `bootstrap / push / pull` routes implement both negotiated versions and are covered by real PostgreSQL route-level integration. This status does not imply deployment, public content readiness, Cognito validation or production launch.

This document freezes the production Seam between an offline Sensa client and the server-owned Learning Runtime. It is the implementation contract for `0001_sensa_baseline.sql` and the Sensa Sync Module. It does not extend the existing generic flashcard sync union.

## 1. Boundary

Sensa sync reuses Account, Workspace and `sync.workspace_replicas` identity through an Adapter, but owns a separate versioned Interface, operation ledger, change sequences and cursors.

- The client writes raw user facts and lifecycle commands locally first.
- The server validates every operation and deterministically derives Evidence, Semantic State, Memory Outcome and FSRS state.
- Client-derived projections are responsive local views, never an authoritative write surface.
- Published Content Releases and Book Versions are immutable catalog snapshots. Their bodies are downloaded from catalog routes and addressed by ID and digest; Sensa pull only carries the learner's pinned references and personal runtime data.
- Existing `/workspaces/:workspaceId/sync/*`, `sync.hot_changes` and its entity union remain unchanged.

Wire versions: frozen `sensa-sync-v1` and additive `sensa-sync-v2`. The HTTP paths do not change. A replica moves one way from v1 to v2 only through a fresh v2 bootstrap; it cannot downgrade afterward. Generic Flashcards sync is unaffected.

### 1.1 Additive v2 boundary

`sensa-sync-v2` retains every v1 operation and result meaning and adds only Learner-Declared Mastery:

- bootstrap includes `learnerDeclaredMasteries`;
- the mutable feed adds entity type `learner_declared_mastery`;
- push adds `learner_declared_mastery.set`;
- stored results use `sensa-sync-result-v2` and v2 cursors.

A v1 replica never receives the v2-only entity. It still advances past those shared mutable-feed sequence rows so it cannot loop on an unknown change. After a replica bootstraps v2, a still-pending v1-subset operation can be sent in the v2 envelope and an already accepted identical v1 ledger row can replay without reinterpretation. V1 wire/result shapes remain frozen.

## 2. Scope and identity

Every authenticated request is scoped by this tuple:

```text
(workspace_id, learner_user_id, replica_id)
```

The route supplies `workspace_id`, authentication supplies `learner_user_id`, and the body supplies `replica_id`. The server must verify that the referenced `sync.workspace_replicas` row belongs to both values. A body cannot choose a different learner.

All user facts include stable UUIDs created offline. Every pushed operation includes an opaque `operationId`, unique within `(workspace_id, learner_user_id)`, a `kind`, `occurredAt`, and a canonical payload. Operation IDs and entity IDs are identities, not ordering mechanisms.

Encounter planning also freezes a learner-local calendar snapshot. An offline `sense_encounter.open` supplies an explicit valid IANA `timeZone`; the server derives `plannedLocalDate` from the canonical operation time and persists the timezone with source `client`. The online Planning service may instead resolve an omitted timezone from `org.user_settings.progress_time_zone`, then fall back to `UTC`, and records the actual source. Sync snapshots return `plannedLocalDate`, `planningTimeZone`, and `planningTimeZoneSource`; clients cannot submit a precomputed local date or source as authoritative facts.

`sense_encounter.open` may additionally carry `selectionMode: mixed | due_only`.
The field instructs the server-owned Planner; it does not let the client choose
a Sense or Encounter kind. Omission is interpreted as `mixed` so existing
replicas retain the primary daily-learning behavior. `due_only` can create only
an eligible Review Encounter and returns no candidate rather than introducing a
new Sense.

## 3. Version tuple

Bootstrap reports the supported tuple. An Encounter-opening operation freezes this tuple for that Encounter:

```text
wireVersion
capabilityResolverVersion
semanticPolicyVersion
stopPolicyVersion
evidenceRuleVersion
stateUpdaterVersion
outcomeMappingVersion
```

The current tuple advertised for newly opened Encounters is
`executable-learning-capability-resolver-v1 / semantic-policy-v2 / stop-policy-v2 / evidence-rule-v2 /
state-updater-v2 / memory-outcome-v3`. Historical V1 Evidence/State facts retain
their frozen V1 Evidence/State versions. Bootstrap and pull may therefore
contain either `sensa-state-updater-v1` or `sensa-state-updater-v2` projections;
the explicit field controls their interpretation. Attempt and
Encounter-closing operations repeat the Encounter ID rather than being allowed
to replace its versions. Unsupported or internally inconsistent versions
produce `upgrade_required` or `version_mismatch`; the operation is not
acknowledged and no derived state changes.

The Resolver field identifies the exact Package-to-executable-inventory
semantics used before Semantic Policy. Bootstrap, open-operation validation and
Encounter snapshots carry the same value; a replica cannot omit or substitute it.

Every `learning_action` fact for the current tuple includes
`semanticPolicyDecisionCode` and `actionSchemaVersion = sensa-learning-action-v3`.
The server validates the closed reason-code/Action-kind mapping and recomputes
the V3 Action digest over the reason code as well as payload and ordered asset
references. A client can render or explain the reason but cannot choose or
rewrite it.

A completed `sense_encounter` snapshot includes the server-owned completing
`stopPolicyDecisionCode`; non-completed snapshots carry null. Every
`memory_outcome` snapshot includes `decisionCode` beside `outcomeKind`. The
server validates both reason-code shapes and their compatibility; replicas may
explain or diagnose them but cannot submit them as authoritative choices.

## 4. Public Interface

### Bootstrap

```text
POST /workspaces/:workspaceId/sensa/sync/bootstrap
```

Input contains `wireVersion` and `replicaId`. The response is one transactionally consistent snapshot containing:

- the learner's Study Plans and their revisions;
- open/recent Learning Sessions and Sense Encounters needed to resume;
- authoritative Learner Semantic State and Sense Memory State projections;
- pinned Book Version and Content Release IDs plus digests;
- `mutableCursor` and `factCursor` covering the snapshot;
- the server-supported version tuple.

Bootstrap does not embed the full immutable content body. Repeating bootstrap replaces the local Sensa runtime partition for this scope; it does not merge an unknown local projection into the server snapshot.

### Push

```text
POST /workspaces/:workspaceId/sensa/sync/push
```

The request contains `wireVersion`, `replicaId`, the client's two last applied cursors, and an ordered operation list. The Sync Module processes operations in order and commits each operation atomically. A result is returned for every operation processed before a dependency or conflict stops the remainder:

```text
applied | replayed | rebased | conflict | rejected
```

`applied`, `replayed`, and `rebased` are acknowledgements and may be removed from the local outbox. `conflict` and `rejected` are not acknowledgements. A dependent suffix is returned as `blocked_by_prior_operation`, remains in the outbox, and is not executed.

### Pull

```text
POST /workspaces/:workspaceId/sensa/sync/pull
```

Input contains `wireVersion`, `replicaId`, `mutableCursor`, and `factCursor`. The response returns:

- append-only facts after `factCursor`;
- the latest server snapshots affected after `mutableCursor`;
- explicit tombstones where a mutable object becomes unavailable;
- authoritative corrections for locally derived Evidence, State, Outcome or scheduling;
- the next cursor pair.

Cursors are opaque, scope-bound and monotonic. A cursor from another learner, Workspace, wire version or bootstrap epoch is invalid. Expired/compacted cursors return `bootstrap_required`; the client must not silently reset to an empty state.

## 5. Push operation union

The V1 input union contains only user facts and lifecycle intent:

| Kind | Purpose | Conflict precondition |
|---|---|---|
| `study_plan.create` | Pin a published Book Version and create learner pacing | Plan ID must be unused |
| `study_plan.update` | Change pacing or active status | `expectedRevision` |
| `learning_session.start` | Open a session under one Study Plan | Session ID must be unused |
| `learning_session.complete` | Finish or abandon a session | `expectedRevision` |
| `sense_encounter.open` | Ask Planning to bind the next eligible Sense and immutable content/kernel versions; optional `selectionMode` defaults to `mixed` | Encounter ID must be unused |
| `learning_attempt.record` | Append one response to one emitted Action | Attempt ID must be unused; Action and Encounter must exist |
| `sense_encounter.complete` | Close an Encounter and request authoritative derivation plus one scheduler handoff | `expectedRevision` |
| `sense_encounter.interrupt` | Close without a Memory Outcome | `expectedRevision` |

There are deliberately no `evidence.write`, `semantic_state.write`, `memory_outcome.write`, or `fsrs_state.write` operations. Those objects are server-owned projections/derivations. A completion may carry optional client digests and a predicted outcome for drift detection, but those fields cannot select the authoritative result.

Study Plans are deactivated rather than hard-deleted through this Interface. Account and Workspace deletion continue through the Production Base cleanup path.

### 5.1 V2 Learner-Declared Mastery operation

`learner_declared_mastery.set` carries a stable client-created entity ID, `senseId`, boolean `isMastered`, and `expectedRevision` (`0` only for creation). It may include an Encounter ID and revision as exact UI context. The authoritative scope is `(workspace_id, learner_user_id, sense_id)`, global across Books and Study Plans; the optional Encounter is not the declaration scope.

An active declaration means the learner explicitly says the Sense is already mastered. The server excludes that Sense from both new and due Planning, cancels every same-Sense `planned` Encounter, interrupts every same-Sense `active` Encounter, and rejects stale open/Attempt/completion work. Revocation updates the same entity and restores eligibility from untouched prior state. Neither direction creates Attempt, Evidence, Learner Semantic State, Memory Outcome or FSRS changes.

## 6. Idempotency and canonical payloads

The operation ledger key is `(workspace_id, learner_user_id, operation_id)`.

- First valid application stages all canonical mutable/fact feed rows, then inserts the immutable operation ledger row last with `kind`, `replica_id`, canonical payload digest, result digest, acknowledgement status, server sequence and exact feed bounds. A deferred invariant rejects ledger-first writes or any attempt to extend the operation's feeds after the ledger exists.
- Repeating the same operation ID with the same kind and canonical payload returns the stored result as `replayed` and performs no writes or second FSRS update.
- Reusing the ID with a different kind or payload returns `operation_id_reuse`; no part is applied.
- Canonicalization is versioned by `sensa-sync-v1`: object keys are sorted, absent optional values are not rewritten as explicit nulls, UUIDs/enums use canonical lowercase spelling, and timestamps are normalized to UTC millisecond precision before hashing. Stored results use the independent frozen schema identifier `sensa-sync-result-v1`.
- An invalid or rejected operation does not reserve its operation ID unless the response is itself a durable deterministic conflict result. Transport failure never implies acknowledgement; retrying the same ID is required.

One `sense_encounter.complete` transaction creates at most one Memory Outcome,
updates the Sense Memory State through the Memory Outcome Module, writes all
resulting change-sequence entries, and records the acknowledgement.
`introduced` carries `scheduleDisposition=acquisition_pending` and nullable FSRS
fields; retrieval Outcomes carry `scheduleDisposition=fsrs_applied` and a
complete Adapter result. The completed Encounter's Stop Decision reason and the
Outcome's classification reason are persisted and returned together. The unique
Encounter-to-Outcome constraint and ledger are both required; neither replaces
the other.

## 7. Merge and conflict rules

### Append facts

Sessions, Encounters, Actions, Attempts, Evidence and Memory Outcomes retain immutable fact identities. Same identity plus the same canonical fact is an idempotent replay. Same identity plus different content is `immutable_fact_conflict`; the server never resolves it with last-write-wins.

### Mutable intent

Study Plan settings and lifecycle transitions use positive integer revisions. The server applies an operation only when `expectedRevision` equals the current revision. A stale revision returns the current authoritative snapshot and `revision_conflict`. The client pulls, preserves any unacknowledged local intent, and submits a newly chosen operation with a new operation ID if the user still wants it.

Lifecycle transitions are forward-only. A completed/interrupted Encounter cannot reopen, and a completed Session cannot return to active. Equivalent terminal replays are idempotent; conflicting terminal states are `terminal_state_conflict`.

### Derived learning state

The server serializes completion by `(workspace_id, learner_user_id, sense_id)`, replays the accepted facts through the frozen Kernel tuple, and treats the server result as authoritative. If valid concurrent activity makes a client's predicted projection stale but its raw facts remain valid, the server applies the facts, returns `rebased`, and includes the corrected projection. It does not discard real Attempts and does not accept the client's stale State or Outcome.

Within an Encounter, Attempts are ordered by `(occurred_at, attempt_id)`. Across concurrently completed Encounters, server acceptance sequence is the projection order. Original client timestamps remain available as facts and Product Event data. Acquisition-pending introductions have no `effectiveReviewedAt`. For retrieval Outcomes, the FSRS Adapter uses an `effectiveReviewedAt` that is not earlier than the previous accepted review time; any clamp and its reason are stored explicitly. This avoids negative scheduling intervals without rewriting the observed timestamp.

If deterministic replay cannot be performed—missing Action, unavailable immutable content, unsupported Kernel version, impossible timestamp, or corrupt dependency—the completion is not acknowledged and no Memory Outcome or FSRS update occurs.

## 8. Change feeds and `0001` storage contract

`0001_sensa_baseline.sql` establishes these dedicated tables under `sensa`:

1. `sync_operations`: the learner-scoped idempotency ledger and durable result metadata.
2. `sync_mutable_changes`: a monotonically sequenced log for Study Plan/runtime status and authoritative projection snapshots or tombstones.
3. `sync_append_facts`: a monotonically sequenced log referencing immutable runtime facts.
4. `sync_replica_states`: bootstrap epoch, acknowledged cursor pair and bootstrap/pull timestamps for one verified `sync.workspace_replicas` identity. A new replica state starts as bootstrap-required in epoch 1. Successful bootstrap rotates the epoch by exactly one, clears the requirement, and acknowledges exactly the two snapshot cursors; cursors and epochs never move backwards.

The logs use strong entity/fact enums and explicit identifiers; they do not store an unconstrained alternate copy of domain objects. Pull reads the referenced canonical tables from `0001` and `0001`. Sequence values are allocated by server-side security-definer triggers and establish delivery order, not domain identity; `backend_app` has no direct sequence privilege. Feed-first/ledger-last ordering makes the operation result and its cursor bounds immutable together.

Every table carries explicit constraints, indexes, `backend_app` grants and RLS. Policies require both `security.current_user_id()` learner ownership and existing Workspace access. A replica foreign key alone is not authorization.

`0001_sensa_baseline.sql` adds the learner/Sense declaration table and v2 enum/check vocabulary without altering generic sync. It also permits only the guarded one-way v1-to-v2 replica transition at bootstrap.

## 9. Structured errors

The stable V1 codes are:

```text
authentication_required
workspace_access_denied
replica_scope_mismatch
upgrade_required
version_mismatch
invalid_cursor
bootstrap_required
invalid_operation
operation_id_reuse
missing_dependency
blocked_by_prior_operation
immutable_fact_conflict
revision_conflict
terminal_state_conflict
kernel_replay_failed
content_unavailable
schedule_conflict
```

Errors identify `operationId` when applicable and say whether retrying unchanged can succeed. A sync failure is visible and recoverable; it must never be converted into an empty learning state.

## 10. Module acceptance checks

The Sensa Sync Module is a deep Module: its public Interface is `bootstrap`, `push`, and `pull`; transaction boundaries, replay, locking, projection repair and cursor storage remain hidden in its Implementation.

Wave 1 must prove with real Postgres integration that:

1. a verified replica can bootstrap and advance both cursors;
2. retrying one accepted completion returns `replayed` and cannot create a second Memory Outcome or FSRS update;
3. operation-ID payload reuse is rejected;
4. stale mutable revision returns an explicit conflict without LWW;
5. concurrent valid Encounter facts are server-rebased into one authoritative projection order;
6. RLS prevents another learner or inaccessible Workspace from reading or pushing data;
7. generic flashcard sync contracts and `sync.hot_changes` are unchanged.

The v2 addition must additionally prove that declaration/revocation is revisioned and replay-safe, all same-Sense nonterminal Encounters close under the shared lock, Planning excludes the declaration globally, v1 replicas keep advancing without seeing the v2 entity, and no Attempt/Evidence/Semantic State/Outcome/FSRS row changes.
