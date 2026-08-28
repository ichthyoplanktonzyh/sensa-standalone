# Sensa Curriculum and Runtime Contract

Status: **Active versioned implementation contract; not a domain model**  
Date: 2026-08-22  
Implementation scope: `0001_sensa_baseline.sql` through
`0005_sensa_semantic_policy_decisions.sql`, and the current
Planning/Semantic Policy/Encounter/Memory Outcome Module Interfaces.

This contract turns the domain hierarchy in
[`learning-runtime-model.md`](learning-runtime-model.md) into current relational
boundaries. It depends on the stable/versioned Content Kernel identities from
`0001` and the Memory Outcome mapping ADR. It does not define UI pages, a fixed
sequence of exercises, or permanent domain ontology.

## 1. Module boundaries

The Curriculum Module publishes immutable ordered Books and stores a learner's mutable Study Plan. The Planning Module combines an active Study Plan, unseen Book members and due Sense Memory States to select candidates. The pure `SemanticPolicyModule` maps the current learner/Sense context to one minimum learning decision without storage or resource I/O. The Encounter Module owns the Semantic Learning Loop, materializes that decision from pinned resources, and emits server-authoritative facts/projections. `MemoryOutcomeModule` is the single completion Seam: it records acquisition-pending introductions itself and hands only retrieval Outcomes to FSRS.

Public Interfaces remain small:

```ts
interface SessionPlanningModule {
  planNext(input: PlanNextEncounterInput): Promise<PlannedEncounter | NoCandidate>;
}

type PlanningMode = "mixed" | "due_only";

interface EncounterModule {
  open(input: OpenEncounterInput): Promise<EncounterStep>;
  submitAttempt(input: SubmitAttemptInput): Promise<EncounterStep>;
  interrupt(input: InterruptEncounterInput): Promise<InterruptedEncounter>;
}

interface SemanticPolicyModule {
  decide(context: SemanticPolicyContext): SemanticPolicyDecision;
}

type EncounterStep = NextLearningAction | CompletedEncounter;

interface MemoryOutcomeModule {
  applyMemoryOutcome(input: ApplyMemoryOutcomeInput): Promise<ApplyMemoryOutcomeResult>;
}
```

The Interfaces do not expose SQL rows, let callers write Evidence/State/Outcome, or require an HTTP round trip for each Action. Their Implementations hide locking, policy choice, evidence derivation, state projection, Memory Outcome classification and scheduling transactions.

`PlanNextEncounterInput.selectionMode` is a versioned Planning instruction. `mixed`
is the primary daily-learning mode: it selects eligible due/acquisition-pacing
Reviews before reserving an unseen Sense, subject to the daily new-Sense target.
`due_only` is the secondary “只巩固已学” mode: it can select only an eligible
Review and never introduces a new Sense. An omitted field on the additive Sync
operation is interpreted as `mixed` for compatibility. V1 deliberately has no
`new_only` mode because first retrieval is part of acquisition, not a separate
user-managed queue.

## 2. Frozen shared runtime vocabulary

`0001`/`0001` add these enums:

- `sensa.book_version_status`: `draft | published | retired`
- `sensa.study_plan_status`: `active | paused | completed | archived`
- `sensa.learning_session_status`: `active | completed | abandoned`
- `sensa.encounter_status`: `planned | active | completed | interrupted | cancelled`
- `sensa.encounter_kind`: `introduction | review`
- `sensa.mastery_dimension`: `grounding | boundary | form_mapping | retrieval | transfer`
- `sensa.mastery_level`: `unknown | emerging | stable`
- `sensa.evidence_polarity`: `positive | negative`
- `sensa.context_novelty`: `familiar | novel`
- `sensa.scaffold_level`: `full | reduced | minimal | none`
- `sensa.renderer_kind`: `content | single_choice | text_input`
- `sensa.attempt_validity`: `valid | invalid`
- `sensa.memory_outcome_kind`: `introduced | retrieval_failed | supported_retrieval | independent_retrieval | transfer_confirmed`
- `sensa.fsrs_card_state`: `new | learning | review | relearning`

Action payloads and Attempt responses are the two deliberately versioned structured contracts. Their JSON columns must be objects, carry a nonempty schema-version column, have a canonical SHA-256 digest, and pass the corresponding TypeScript validator before persistence. They are not generic entity storage.

## 3. Migration `0001_sensa_baseline.sql`

The migration is additive and explicitly reads/modifies `sensa`, `org`, `security`, and `pg_catalog`.

### 3.1 Stable Book identity

#### `sensa.books`

- `book_id UUID PRIMARY KEY`
- `book_key TEXT UNIQUE NOT NULL`, trimmed and stable across versions
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

The stable row contains no mutable public title or membership.

### 3.2 Immutable Book versions

#### `sensa.book_versions`

- `book_version_id UUID PRIMARY KEY`
- `book_id UUID NOT NULL` FK `sensa.books` restrict
- `version_number INTEGER NOT NULL CHECK > 0`
- `content_release_id UUID NOT NULL` FK `sensa.content_releases` restrict
- `target_language / learner_locale TEXT NOT NULL`
- `title TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `status sensa.book_version_status NOT NULL DEFAULT draft`
- `manifest_digest TEXT NOT NULL`, lowercase SHA-256 hex
- `sense_count / lexeme_count INTEGER NOT NULL DEFAULT 0 CHECK >= 0`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `published_at / retired_at TIMESTAMPTZ`
- unique `(book_id, version_number)` and unique `manifest_digest`

Allowed transition is `draft -> published -> retired`; there is no rollback to draft and no direct draft-to-retired transition. A published/retired Book Version and all membership rows are immutable. Retirement only removes it from new-plan selection; existing Study Plans remain pinned.

#### `sensa.book_version_senses`

- `book_version_id UUID NOT NULL` FK cascade while draft, protected once published
- `ordinal INTEGER NOT NULL CHECK > 0`
- `sense_version_id UUID NOT NULL` FK `sensa.sense_versions` restrict
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- primary key `(book_version_id, ordinal)`
- unique `(book_version_id, sense_version_id)`

A trigger verifies the Sense Version belongs to the Book Version's Content Release. Publishing verifies:

1. the Content Release is `published`;
2. membership is nonempty and ordinals are contiguous from 1;
3. every selected approved Sense Version has a `satisfied` Required Asset Manifest for the frozen validator and Capability Resolver versions;
4. stored Sense and distinct Lexeme counts match membership;
5. the deterministically recomputed membership digest matches `manifest_digest`.

Publication never infers “1,000 words” from row count. The public V1 launch gate remains `lexeme_count >= 1000`; internal fixtures may publish only under an explicitly non-public availability path added later by the Catalog Module.

### 3.3 Learner Study Plans

#### `sensa.study_plans`

- `study_plan_id UUID PRIMARY KEY`, client-creatable offline
- `workspace_id UUID NOT NULL` FK `org.workspaces` cascade
- `learner_user_id TEXT NOT NULL`
- `book_version_id UUID NOT NULL` FK `sensa.book_versions` restrict
- `status sensa.study_plan_status NOT NULL DEFAULT active`
- `daily_new_sense_target SMALLINT NOT NULL CHECK BETWEEN 1 AND 100`
- `revision BIGINT NOT NULL DEFAULT 1 CHECK > 0`
- `created_by_replica_id UUID NOT NULL` FK `sync.workspace_replicas` restrict
- `created_at / updated_at TIMESTAMPTZ NOT NULL`
- `activated_at TIMESTAMPTZ NOT NULL`
- `paused_at / completed_at / archived_at TIMESTAMPTZ`

A Study Plan can only pin a published Book Version. Status/timestamp shapes are checked. The server increments revision on each accepted mutation; clients cannot choose the next revision. At most one active Study Plan exists for `(workspace_id, learner_user_id)` in V1, enforced with a partial unique index. Progress is derived from Book membership plus learner/runtime state; no manually maintained `learned_count` column is stored.

Content Book tables grant `backend_app` read access only. Study Plans grant the backend necessary DML under RLS requiring both `learner_user_id = security.current_user_id()` and `security.current_workspace_access_allowed(workspace_id)`. All identifiers are schema-qualified.

## 4. Migration `0001_sensa_baseline.sql`

The migration is additive and explicitly reads/modifies `sensa`, `org`, `sync`, `security`, and `pg_catalog`. It does not add Sensa entities to `sync.hot_changes`.

### 4.1 Session and Encounter lifecycle

#### `sensa.learning_sessions`

- `learning_session_id UUID PRIMARY KEY`
- `workspace_id / learner_user_id NOT NULL`
- `study_plan_id UUID NOT NULL` FK restrict
- `created_by_replica_id UUID NOT NULL` FK `sync.workspace_replicas` restrict
- `status sensa.learning_session_status NOT NULL DEFAULT active`
- `revision BIGINT NOT NULL DEFAULT 1 CHECK > 0`
- `started_at TIMESTAMPTZ NOT NULL`
- `ended_at TIMESTAMPTZ`
- `created_at / updated_at TIMESTAMPTZ NOT NULL`

The Study Plan, learner, Workspace and replica scopes must match. `ended_at` is null only while active. Terminal Sessions cannot return to active.

#### `sensa.sense_encounters`

- `sense_encounter_id UUID PRIMARY KEY`
- `workspace_id / learner_user_id NOT NULL`
- `learning_session_id UUID NOT NULL` FK restrict
- `study_plan_id UUID NOT NULL` FK restrict
- `sense_id UUID NOT NULL` FK `sensa.senses` restrict
- `sense_version_id UUID NOT NULL` FK `sensa.sense_versions` restrict
- `content_release_id UUID NOT NULL` FK `sensa.content_releases` restrict
- `book_version_id UUID NOT NULL` FK `sensa.book_versions` restrict
- `session_ordinal INTEGER NOT NULL CHECK > 0`
- `kind sensa.encounter_kind NOT NULL`
- `status sensa.encounter_status NOT NULL DEFAULT planned`
- `revision BIGINT NOT NULL DEFAULT 1 CHECK > 0`
- the full frozen version tuple: `capability_resolver_version`, `semantic_policy_version`, `stop_policy_version`, `evidence_rule_version`, `state_updater_version`, `outcome_mapping_version`
- `stop_policy_decision_code TEXT`, null until terminal completion and then fixed
  to one completing Stop Policy V2 reason code
- `semantic_state_revision_at_open / memory_state_revision_at_open BIGINT NOT NULL CHECK >= 0`
- `planned_at TIMESTAMPTZ NOT NULL`
- `planned_local_date DATE NOT NULL`、`planning_time_zone TEXT NOT NULL` 与 `planning_time_zone_source TEXT NOT NULL`（由 `0001` 增加并作为不可变 planning snapshot）
- `opened_at / closed_at TIMESTAMPTZ`
- `created_at / updated_at TIMESTAMPTZ NOT NULL`
- unique `(learning_session_id, session_ordinal)`

Cross-table triggers verify all learner, plan, Book, release, Sense and version identities agree and were visible at planning time. The caller does not choose the two `*_revision_at_open` values: when the Encounter moves from `planned` to `active`, the server derives them from the current learner-by-Sense projections while holding the runtime transaction, and revalidates that the pinned Plan and Session are still active. Lifecycle is `planned -> active -> completed|interrupted|cancelled`, with direct planned-to-cancelled allowed. At transaction commit, `completed` requires exactly one completing Stop Decision and one compatible Memory Outcome; every other status requires neither.

`0001_sensa_baseline.sql` freezes the IANA timezone used at planning, its source (`client|user_settings|utc_fallback`), and the derived local calendar date. Existing rows receive an exact UTC-derived metadata backfill without changing lifecycle facts. The migration fails closed instead of silently cancelling/abandoning historical duplicates before adding partial unique indexes for one `planned|active` Encounter per Session and one active Session per Plan. Daily-new usage counts distinct introduced Senses whose reservation is still planned or whose Encounter was opened, grouped by learner local date; cancelled-before-open reservations are released, timezone changes cannot create a second quota for the same calendar date, and due reviews remain unbounded by the new quota.

In `mixed` mode the Planner treats the first evidence-bearing retrieval after an `introduced`
Outcome as the completion of acquisition pacing rather than an ordinary
wall-clock review. Within the same Learning Session it becomes eligible after
three distinct other Senses have completed an Encounter. The Planner drains
the remaining first-retrieval candidates once no further new Sense can be
introduced, even when the final candidates have a shorter gap; a candidate
carried into a later Session is immediately eligible. A Sense can receive at
most one non-cancelled Review Encounter in one Session. These rules prevent
reading speed from controlling the lesson sequence. `introduced` creates no
FSRS learning step or due time; the first completed retrieval initializes FSRS,
and subsequent cross-Session due times remain under FSRS ownership.

`due_only` applies the same eligibility and same-Session repeat rules but skips
new-Sense reservation entirely. Therefore “只巩固已学” does not mean “show every
historically seen Sense”; it means “continue only the currently eligible
acquisition/review work selected by the server-owned Planner”.

### 4.2 Action and Attempt facts

#### `sensa.learning_actions`

- `learning_action_id UUID PRIMARY KEY`
- `sense_encounter_id UUID NOT NULL` FK restrict
- `ordinal INTEGER NOT NULL CHECK > 0`
- `target_dimension sensa.mastery_dimension NOT NULL`
- `primitive sensa.acquisition_primitive NOT NULL`
- `scaffold_level sensa.scaffold_level NOT NULL`
- `renderer_kind sensa.renderer_kind NOT NULL`
- `semantic_policy_decision_code TEXT NOT NULL`, one closed V2 reason code
- `action_schema_version / evidence_rule_version TEXT NOT NULL`
- `action_payload JSONB NOT NULL CHECK jsonb_typeof(...) = 'object'`
- `action_digest TEXT NOT NULL`, lowercase SHA-256 hex
- `created_at TIMESTAMPTZ NOT NULL`
- unique `(sense_encounter_id, ordinal)` and `(sense_encounter_id, action_digest)`

#### `sensa.learning_action_assets`

- `learning_action_id UUID NOT NULL` FK cascade
- `ordinal SMALLINT NOT NULL CHECK > 0`
- `learning_asset_id UUID NOT NULL` FK `sensa.learning_assets` restrict
- `asset_role TEXT NOT NULL`, validated by the action schema
- primary key `(learning_action_id, ordinal)`
- unique `(learning_action_id, learning_asset_id, asset_role)`

The selected Asset must belong to the Encounter's immutable Content Release and Sense/Lexeme owner. The decision code must match the Action kind and metadata, and is included in the V3 canonical Action digest. Action facts are immutable after insert.

#### `sensa.learning_attempts`

- `learning_attempt_id UUID PRIMARY KEY`
- `workspace_id / learner_user_id NOT NULL`
- `sense_encounter_id / learning_action_id UUID NOT NULL` FKs restrict
- `ordinal SMALLINT NOT NULL CHECK > 0`
- `source_replica_id UUID NOT NULL` FK `sync.workspace_replicas` restrict
- `response_schema_version TEXT NOT NULL`
- `response_payload JSONB NOT NULL CHECK jsonb_typeof(...) = 'object'`
- `response_digest TEXT NOT NULL`, lowercase SHA-256 hex
- `duration_ms INTEGER CHECK >= 0`
- `validity sensa.attempt_validity NOT NULL`
- `is_correct BOOLEAN`, nullable for non-assessment Actions
- `evaluation_code TEXT NOT NULL`
- `occurred_at / recorded_at TIMESTAMPTZ NOT NULL`
- unique `(learning_action_id, ordinal)`

Attempt IDs and payloads are immutable. `validity`, correctness and evaluation code are computed by the server replay before the accepted row is inserted; an invalid Attempt may be retained for traceability but emits no mastery-positive Evidence merely because the UI advanced.

### 4.3 Append-only Evidence

#### `sensa.learning_evidence`

- `learning_evidence_id UUID PRIMARY KEY`
- `workspace_id / learner_user_id NOT NULL`
- `sense_id / sense_version_id UUID NOT NULL`
- `sense_encounter_id / learning_action_id / learning_attempt_id UUID NOT NULL`
- `dimension sensa.mastery_dimension NOT NULL`
- `polarity sensa.evidence_polarity NOT NULL`
- `context_novelty sensa.context_novelty NOT NULL`
- `evidence_rule_version TEXT NOT NULL`
- `basis_code TEXT NOT NULL`
- `occurred_at / derived_at TIMESTAMPTZ NOT NULL`
- unique `(learning_attempt_id, dimension, evidence_rule_version, basis_code)`

Evidence has no user-set weight or continuous “mastery probability” in V1. It is an immutable versioned observation. A passive view, auto-play, continue tap, invalid response or interruption does not create positive mastery Evidence.

### 4.4 Rebuildable 5D projection

#### `sensa.learner_semantic_states`

- `learner_semantic_state_id UUID PRIMARY KEY`
- `workspace_id / learner_user_id / sense_id NOT NULL`
- for each of `grounding`, `boundary`, `form_mapping`, `retrieval`, `transfer`:
  - `<dimension>_level sensa.mastery_level NOT NULL DEFAULT unknown`
  - `<dimension>_positive_count INTEGER NOT NULL DEFAULT 0 CHECK >= 0`
  - `<dimension>_failure_streak INTEGER NOT NULL DEFAULT 0 CHECK >= 0`
- `projection_version TEXT NOT NULL`
- `revision BIGINT NOT NULL CHECK > 0`
- `state_digest TEXT NOT NULL`, lowercase SHA-256 hex
- `projected_through_evidence_id UUID` nullable FK restrict
- `updated_at TIMESTAMPTZ NOT NULL`
- unique `(workspace_id, learner_user_id, sense_id)`

This row is a cache/projection, not learning history. Only the State Updater Implementation writes it. Rebuilding the ordered Evidence stream under `projection_version` must reproduce its digest. Clients receive and may locally overlay it but cannot push it as a write operation.

### 4.5 Memory Outcome and FSRS projection

#### `sensa.sense_memory_states`

- `sense_memory_state_id UUID PRIMARY KEY`
- `workspace_id / learner_user_id / sense_id NOT NULL`
- `due_at TIMESTAMPTZ`
- `reps / lapses INTEGER NOT NULL DEFAULT 0 CHECK >= 0`
- `fsrs_card_state sensa.fsrs_card_state NOT NULL DEFAULT new`
- `fsrs_step_index INTEGER CHECK >= 0`
- `fsrs_stability / fsrs_difficulty DOUBLE PRECISION`
- `fsrs_last_reviewed_at TIMESTAMPTZ`
- `fsrs_scheduled_days INTEGER CHECK >= 0`
- `revision BIGINT NOT NULL CHECK > 0`
- `last_memory_outcome_id UUID NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- unique `(workspace_id, learner_user_id, sense_id)`

It mirrors the invariant shape already enforced for flashcard FSRS state: `new` has null due/memory fields/step; non-new has complete memory fields; `review` has null step; `learning|relearning` has a non-null step. It is not a foreign key to `content.cards` and does not create Carrier Cards.

#### `sensa.memory_outcomes`

- `memory_outcome_id UUID PRIMARY KEY`
- `workspace_id / learner_user_id / sense_id NOT NULL`
- `sense_encounter_id UUID NOT NULL UNIQUE` FK restrict
- `outcome_kind sensa.memory_outcome_kind NOT NULL`
- `decision_code TEXT NOT NULL`, fixed to a Memory Outcome V3 reason compatible
  with `outcome_kind`
- `outcome_mapping_version TEXT NOT NULL`, fixed to `sensa-memory-outcome-v3`
- `schedule_disposition TEXT NOT NULL`, either `acquisition_pending` or `fsrs_applied`
- `fsrs_rating SMALLINT CHECK BETWEEN 0 AND 3`, null only while acquisition is pending
- `observed_completed_at TIMESTAMPTZ NOT NULL`
- `effective_reviewed_at TIMESTAMPTZ`, null only while acquisition is pending
- `review_time_clamped BOOLEAN NOT NULL`
- `review_time_clamp_reason sensa.review_time_clamp_reason`, null only when unclamped and `previous_accepted_review_time` only when clamped
- `prior_memory_revision / resulting_memory_revision BIGINT NOT NULL CHECK >= 0`, with resulting = prior + 1
- `fsrs_adapter_version / scheduler_settings_digest TEXT`, null only while acquisition is pending
- `created_at TIMESTAMPTZ NOT NULL`

A CHECK enforces the V3 Decision/kind mapping and acquisition split: `introduced` has disposition
`acquisition_pending` and no rating, effective review time, Adapter version or
scheduler digest. Retrieval Outcomes have disposition `fsrs_applied` and map as
`retrieval_failed -> 0`, `supported_retrieval -> 1`,
`independent_retrieval -> 2`, `transfer_confirmed -> 3`; they carry the complete
`sensa-fsrs-adapter-v2` result.

`sense_memory_states.last_memory_outcome_id` is added as a deferrable `NO ACTION` FK after both tables exist. A Memory State can only exist after an accepted Memory Outcome and must point to the Outcome that produced its current revision. An introduction writes the valid `new` state shape (`reps=0`, null due and FSRS fields) as the acquisition marker; it does not call the scheduler. A retrieval calls FSRS and replaces that projection with the returned schedule. Encounter completion, Memory Outcome insert, optional FSRS calculation, memory-state update, semantic projection update and sync acknowledgement/change rows form one server transaction. Deferred invariant triggers check both directions at commit: a completed Encounter has exactly one consistent Outcome/Memory State, while a planned, active, interrupted or cancelled Encounter has none. If any step fails, the Encounter is not acknowledged as completed.

Original occurrence time remains immutable. Acquisition-pending introduction has no effective FSRS review time. For retrieval Outcomes, if offline/concurrent acceptance would make FSRS time go backwards, `effective_reviewed_at` is clamped to the previous accepted review time plus the smallest Adapter-supported increment, `review_time_clamped = true`, and `review_time_clamp_reason = previous_accepted_review_time`; otherwise effective and observed time are equal and the reason is null. The observed time is never overwritten.

### 4.6 Immutability, access and indexes

- Actions, Attempts, Evidence and Memory Outcomes reject direct UPDATE/DELETE through trigger and grants. Their history-preserving foreign keys use `NO ACTION`; owner-controlled Account/Workspace cleanup is still allowed to remove the aggregate through the existing cascade path.
- Terminal Session/Encounter facts reject mutation except narrowly defined operational timestamps set in the same transition.
- State tables are server-owned mutable projections with positive revision increments.
- All learner tables enable RLS and require both matching authenticated learner and Workspace access. Cross-table triggers also verify referenced replica/user/workspace identities.
- `backend_app` receives only the DML each Module requires; clients never connect directly.
- Due lookup index: `(workspace_id, learner_user_id, due_at)` for non-null due rows.
- Resume indexes: active Sessions by learner/updated time and planned/active Encounters by Session ordinal.
- Evidence rebuild index: `(workspace_id, learner_user_id, sense_id, occurred_at, learning_evidence_id)`.
- History indexes: Attempts and Outcomes by learner plus occurrence time.

### 4.7 Learner-Declared Mastery (`0001` additive)

`sensa.learner_declared_masteries` stores one revisioned, reversible declaration per `(workspace_id, learner_user_id, sense_id)`. Its identity is stable across Books and Study Plans. `is_mastered = true` means the learner explicitly chose “already mastered”; `is_mastered = false` is the revocation of that same declaration. The declaration carries user-declared provenance by entity type and timestamps, not by generating synthetic learning facts.

This entity is intentionally separate from Learner Semantic State and Sense Memory State. Creating, replaying, or revoking it must not insert an Attempt, Learning Evidence or Memory Outcome, must not update a 5D projection, and must not invoke FSRS. Revocation restores Planning eligibility against the unchanged prior semantic/memory state.

The Planning, Encounter and Sync Modules share one learner-by-Sense transaction lock. A successful active declaration excludes both new and due candidates, changes every same-scope/same-Sense `planned` Encounter to `cancelled`, changes every `active` Encounter to `interrupted`, and blocks stale open/Attempt/completion work. An optional client Encounter reference is only a revisioned context check; it is never the authority that decides which Encounters are closed.

## 5. Required Module behavior

### Planning

- New candidates are Book members with no Sense Memory State; due candidates have `due_at <= now()`.
- A Sense with active Learner-Declared Mastery is ineligible in every Book and Study Plan for that learner, for both new and due selection.
- The planner honors the active Study Plan's daily-new target but never hides due reviews merely because the new quota is exhausted.
- Selection is deterministic for the same inputs and exposes a planning reason (`new` or `due`) without exposing internal scoring as API surface.
- Planning an Encounter does not update mastery or FSRS.

### Encounter

- First learning and review enter the same Module.
- It resolves the pinned Package through the pure Executable Learning Capability
  Module before Policy; runtime and publication validation share this Interface,
  and the Manifest, Release and Encounter must all name its exact frozen version.
- It calls the pure Semantic Policy once for each new Action, then owns concrete
  asset selection and payload materialization from the selected capability;
  the Policy never reads Postgres or sees a concrete Asset row.
- Every Action persists the stable decision code that explains its selection.
- Each submitted Attempt is validated against the referenced immutable Action and content.
- Evidence Rule and State Updater are deterministic and versioned.
- Stop Policy may complete without making every dimension stable.
- Interrupt/cancel emits no Memory Outcome. Resume continues the same Encounter only while it remains nonterminal.
- The Completion Policy returns one atomic Stop Decision/optional Memory Outcome
  Decision pair with stable reason codes; callers cannot recombine the two.
- A completion emits exactly one classified Memory Outcome and freezes both
  completion and classification reasons; `introduced` remains acquisition-pending
  and only retrieval classifications invoke FSRS.
- Active Learner-Declared Mastery rejects open, Attempt and completion for that learner/Sense. The declaration transition itself interrupts/cancels nonterminal Encounters and emits no Outcome.

### Memory Outcome Module

- It owns the complete Decision-to-Outcome-to-memory transition so Encounter and Sync callers do not branch.
- It records `introduced` as acquisition pending without calling `computeReviewSchedule`.
- It adapts retrieval `MemoryOutcomeKind` values to the existing `computeReviewSchedule` Interface; it does not copy the FSRS algorithm.
- It preserves Outcome kind separately; `retrieval_failed` maps to rating 0, while introduction has no rating.
- It locks and validates the learner-by-Sense Memory State revision.
- Repeating an Encounter completion returns the existing result and cannot increment reps twice.

## 6. Minimal real verification

Do not add blanket unit coverage. The implementation packet must prove these boundaries:

1. a Book cannot publish with cross-release, missing, noncontiguous or unsatisfied members, and published membership is immutable;
2. a Study Plan pins one published Book Version and RLS prevents another learner from reading it;
3. a real transaction can persist `Attempt -> Evidence -> Semantic State -> Memory Outcome -> FSRS Memory State`;
4. retrying that Encounter completion leaves exactly one Outcome and one FSRS revision increment;
5. interruption emits no Outcome;
6. rebuilding Semantic State from Evidence reproduces `state_digest`;
7. no Carrier Card, generic sync entity, or existing route contract is created or changed.
8. declaring, replaying and revoking Learner-Declared Mastery leaves Attempts, Evidence, Semantic State, Memory Outcomes and FSRS revisions unchanged while Planning eligibility and nonterminal Encounter status follow the declaration.
9. the closed Semantic Policy matrix is deterministic, and a real review persists
   `boundary_gap -> retrieval_first_* -> retrieval_repair -> retrieval_continue_*`
   with each reason protected by the V3 Action digest.
10. the same executable-capability resolver gates a real pinned Package and
    materializes both introduction grounding and a Relation-backed Boundary
    Action without letting Policy select a concrete Asset row.
