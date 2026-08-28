# Sensa V1 Runtime Rule Packet

Status: **Frozen legacy implementation contract; superseded for new Encounters by V2**  
Date: 2026-08-23

This document turns the V1 runtime version identifiers into one deterministic, replayable Learning Kernel contract. It is the implementation source of truth for the first production Encounter Module. It does not claim learning efficacy; its thresholds are conservative product semantics to be revised only under a new version after real-user evidence exists.

The stable runtime objects and invariants are defined by
[`learning-runtime-model.md`](learning-runtime-model.md). This packet may choose
V1 actions and thresholds but cannot redefine those objects.

## 1. Frozen tuple and boundary

Every Encounter freezes this exact tuple:

```text
semanticPolicyVersion = sensa-semantic-policy-v1
stopPolicyVersion     = sensa-stop-policy-v1
evidenceRuleVersion   = sensa-evidence-rule-v1
stateUpdaterVersion   = sensa-state-updater-v1
outcomeMappingVersion = sensa-memory-outcome-v1
```

The packet owns action selection inside one Sense Encounter, Attempt evaluation, Evidence derivation, 5D projection, stop decisions, and Memory Outcome classification. It does not select the next Sense or due time, alter immutable content, generate content, choose a UI design, or replace FSRS.

The same inputs must produce the same canonical Action, Evidence, State digest, stop decision, and Outcome kind. Server replay is authoritative. A client may run the same packet for immediate offline UI, but cannot write Evidence, State, Outcome, or FSRS projections directly.

## 2. V1 action semantics and response schema

The V1 runtime semantics are serialized by the current closed
`sensa-learning-action-v2` Action payload union; all Attempt response payloads
use `sensa-learning-response-v1`. The Action schema version predates this
packet supersession and is independent from its Evidence/State tuple. Unknown
properties, unsupported kinds, non-finite numbers, or mismatched referenced
assets are invalid rather than ignored.

V1 Action kinds are:

| Kind | Renderer | Intent | Evidence-bearing |
|---|---|---|---|
| `grounding_bind` | `content` | Present the minimum sufficient first experience and bind it to the L2 form | No |
| `boundary_discrimination` | `single_choice` | Choose which side of an approved contrast expresses the target Sense | Yes, Boundary only |
| `meaning_to_form_recall` | `text_input` | Recover an accepted Lexeme form from the Sense-specific Experience Sketch | Yes, Grounding + Form Mapping + Retrieval |
| `cloze_recall` | `text_input` | Recover the exact target form in an approved quiz Example with its target span masked | Yes, Form Mapping + Retrieval; sometimes Transfer |
| `retrieval_repair` | `content` | Re-present approved grounding/bridge/study material after a failed retrieval | No |

`grounding_bind` and `retrieval_repair` accept only `{ kind: "acknowledgement", acknowledged: true }`. Acknowledgement is a lifecycle fact, not mastery Evidence.

`boundary_discrimination` accepts only `{ kind: "single_choice", choiceId: string }`. The choices are the approved positive and negative cases from one `contrast_pair` or `counterexample` asset and its Sense Relation. Choice order is derived from the Action digest, not ambient randomness.

`meaning_to_form_recall` and `cloze_recall` accept only `{ kind: "text_input", answer: string }`. The expected answer is derived from the pinned Content Release, not accepted from the caller. Meaning-to-form accepts the pinned lemma and declared Lexeme forms. Cloze accepts only the referenced Example's `targetForm` because its construction may require a specific inflection.

Text comparison applies Unicode NFKC, trims leading/trailing Unicode whitespace, collapses internal whitespace runs to one ASCII space, and lowercases with the locale-independent Unicode default. It performs no stemming, fuzzy edit-distance acceptance, translation inference, or LLM judgment in V1.

Each Action persists its target dimension, Primitive, scaffold level, renderer, canonical payload digest, and ordered asset references. It references immutable Learning Assets and does not copy their bodies into an unconstrained payload.

## 3. Scaffold semantics

- `none`: the Action contains no target-revealing cue.
- `minimal`: it may expose non-answer structure such as part of speech or construction, but no target characters or completed answer.
- `reduced`: the learner has received target-revealing repair earlier in the same Encounter; even if the current prompt is masked, success is supported.
- `full`: the Action directly presents the target form or an approved explanation containing it and is not a retrieval assessment.

An Encounter that has emitted `grounding_bind` or `retrieval_repair` records that strong support occurred before the next retrieval. Strong support prevents `independent_retrieval` and `transfer_confirmed` for that Encounter.

## 4. Deterministic asset selection

The Module only reads the Encounter-pinned Book Version, Content Release, Sense Version, Acquisition Profile, satisfied Manifest, approved Usage Patterns, and approved assets. A pinned `retired` Book Version with a `superseded` Release remains runtime-readable; it does not become publicly discoverable again.

Selection uses stable content ordinal first, then UUID. It never uses database arrival order or unseeded randomness.

- `grounding_bind` references the single Experience Sketch, single L1 Bridge, the first study Example, pronunciation audio, and that study Example's audio when available.
- `boundary_discrimination` is eligible only when the Profile declares `boundary_formation` or a required boundary target. It selects the first not-yet-used approved required target and its executable contrast asset. If all were used, it selects the least recently emitted target, then ordinal/UUID.
- `meaning_to_form_recall` references the Experience Sketch and Lexeme identity but not the L1 Bridge or target-revealing text.
- `cloze_recall` selects an approved `quiz` Example not previously emitted to this learner for this Sense. Once every currently available approved quiz Example has been seen, it selects the least recently emitted quiz Example, then Example ordinal/UUID. The pool is not a fixed size; initial packages have at least three quiz Examples and later releases may add more.
- `retrieval_repair` references the Experience Sketch, L1 Bridge, and first study Example plus its available baseline audio.

An Example is learner-unseen once no prior Learning Action for the learner and Sense has referenced it; emission, not successful response, marks it seen. Context novelty is therefore deterministic as `novel` for a first-emitted quiz Example and `familiar` otherwise.

Missing baseline or required conditional assets are `content_unavailable`; the Module does not invent a payload, silently relax the Manifest, or emit substitute Evidence. Profile fallback Primitives may be used only when their required approved assets exist and the Action keeps the same assessment semantics.

## 5. Semantic Policy V1

The policy is state-driven, not a universal fixed lesson sequence.

### Introduction Encounter

An `introduction` Encounter emits one `grounding_bind` Action at `full` scaffold. A valid acknowledgement completes the Encounter as `introduced`. It emits no positive or negative Learning Evidence. Cancellation or interruption emits no Outcome.

This creates the `introduced` scheduling fact without claiming that content
exposure measured mastery. The Curriculum/Planning contract spaces the first
evidence-bearing retrieval by intervening Senses inside the current Session;
the default FSRS learning-step timestamp alone does not force its immediate
selection.

### Review Encounter

On open or resume, the Module first returns an already emitted unresolved Action. Otherwise it evaluates accepted facts in this order:

1. If the Profile requires Boundary work, Boundary state is not `stable`, and this Encounter has not yet assessed Boundary, emit one `boundary_discrimination` Action at `none` scaffold.
2. Select the primary retrieval family:
   - while Grounding is not `stable`, emit `meaning_to_form_recall` at `none` scaffold;
   - otherwise emit `cloze_recall` at `none` scaffold, preferring a learner-unseen quiz Example.
3. After the first valid retrieval failure, emit exactly one `retrieval_repair` Action at `full` scaffold.
4. After repair acknowledgement, emit one retry in the same retrieval family at `reduced` scaffold, using the next deterministic eligible quiz Example for cloze.
5. A valid retrieval success or the second valid retrieval failure completes the Encounter.

A Boundary result never replaces the required retrieval result for a review Encounter. Invalid responses do not advance these steps, emit Evidence, or consume the one valid retrieval attempt; the current Action remains resumable. The V1 branch emits at most four Actions in one review Encounter: optional Boundary assessment, primary retrieval, repair, and retry.

## 6. Attempt validity and evaluation codes

The server verifies authenticated learner/Workspace/replica scope, active Encounter, current Action identity, Attempt identity and ordinal, response schema version, canonical digest, and referenced immutable content before evaluation.

Stable V1 evaluation codes are:

```text
acknowledged
boundary_correct
boundary_incorrect
meaning_to_form_correct
meaning_to_form_incorrect
cloze_correct
cloze_incorrect
response_schema_invalid
response_version_unsupported
action_not_current
content_reference_invalid
```

Valid content acknowledgements store `is_correct = null`. Valid assessments store a boolean. A structurally invalid response may be retained as `validity = invalid`, `is_correct = null`, emits no Evidence, and returns the same current Action. Duration is retained when nonnegative but has no V1 correctness or Evidence threshold; no response-time bands are treated as empirical learning facts.

Reusing an Attempt ID with the same canonical fact is a replay. Reusing it with different canonical input is `immutable_fact_conflict`. A replay cannot append Evidence twice, update State twice, or produce a second Memory Outcome.

## 7. Evidence Rule V1

Content Actions, auto-play, acknowledgement, invalid response, interruption, and cancellation emit no mastery Evidence.

Each valid assessment emits at most one row per affected dimension:

| Action result | Evidence |
|---|---|
| Boundary correct / incorrect | Boundary positive / negative, basis `boundary_discrimination.correct|incorrect` |
| Meaning-to-form correct / incorrect | Grounding, Form Mapping, and Retrieval positive / negative, basis `meaning_to_form.correct|incorrect` |
| Cloze correct / incorrect | Form Mapping and Retrieval positive / negative, basis `cloze.correct|incorrect` |
| Novel first-attempt unscaffolded cloze with pre-open Retrieval at least `emerging` | additionally Transfer positive / negative, basis `novel_cloze.correct|incorrect` |

All rows carry `sensa-evidence-rule-v1`, the Action's deterministic context novelty, and the Attempt occurrence time. A retry after repair is `familiar` for Outcome independence even if it references a newly emitted Example, because strong support already occurred in the Encounter; it never emits Transfer Evidence.

Evidence IDs are deterministic from `(attemptId, dimension, evidenceRuleVersion, basisCode)`. Replaying the same Attempt therefore addresses the same immutable Evidence facts.

## 8. State Updater V1

Each dimension projects `{ level, positiveCount, failureStreak }`. Initial state is `{ unknown, 0, 0 }`.

For a positive Evidence row:

1. increment `positiveCount`;
2. reset `failureStreak` to `0`;
3. set level to `emerging` after the first positive and `stable` after the second or later positive.

For a negative Evidence row:

1. leave `positiveCount` unchanged;
2. increment `failureStreak`;
3. one consecutive failure caps the level at `emerging`; two or more consecutive failures set it to `unknown`.

The updater never weights Evidence by duration, media type, or a caller-supplied score. Multiple dimension rows from one Attempt are applied in canonical dimension order `grounding, boundary, form_mapping, retrieval, transfer`, and the learner-by-Sense projection revision advances once for that accepted Attempt batch.

Rebuild order is server acceptance order `(derived_at, learning_evidence_id)`. The State digest is lowercase SHA-256 over UTF-8 canonical lines containing the Sense scope, `sensa-state-updater-v1`, the five dimension tuples in canonical order, and `projectedThroughEvidenceId`; it excludes mutable revision and timestamps. A rebuild from accepted Evidence must reproduce the digest.

## 9. Stop Policy and Memory Outcome

Stop Policy V1 completes only on these conditions:

- introduction: valid `grounding_bind` acknowledgement;
- review success: the first or repaired retrieval assessment is valid and correct;
- review failure: the repaired second valid retrieval assessment is incorrect.

Invalid responses never force completion. An unavailable dependency returns an explicit error and leaves the Encounter resumable. User intent may instead transition the Encounter to `interrupted` or `cancelled`, which emits no Outcome and does not call FSRS.

For a completed Encounter, Outcome classification follows the accepted ADR and least-optimistic applicable rule:

1. introduction acknowledgement with no retrieval Attempt -> `introduced`;
2. final retrieval failure -> `retrieval_failed`;
3. retrieval success after any retrieval failure or strong support -> `supported_retrieval`;
4. otherwise, first valid unscaffolded retrieval success -> `independent_retrieval`;
5. upgrade that result to `transfer_confirmed` only when it is a learner-unseen cloze context, valid Retrieval and Transfer positive Evidence were emitted, and pre-open Retrieval was at least `emerging`.

The resulting kind is passed once to the existing `sensa-fsrs-adapter-v1` under `sensa-memory-outcome-v1`. Introduction uses Encounter completion time; assessment outcomes use the last evidence-bearing Attempt time. The Encounter close, Evidence/State projection, Memory Outcome, FSRS state, and later Sync acknowledgement are one transaction.

## 10. Required production verification

The Encounter vertical slice must use the real Module, routes, `backend_app`, RLS, immutable Content Release, and PostgreSQL 18. It must prove at least:

1. opening an introduction emits the canonical grounding Action; acknowledgement completes with one `introduced` Outcome and zero mastery Evidence;
2. first due meaning-to-form success emits exactly three positive Evidence rows, updates the corresponding 5D dimensions, and produces `independent_retrieval` once;
3. failed retrieval -> repair -> successful retry produces `supported_retrieval`; two failures produce `retrieval_failed`;
4. an unseen cloze with pre-open Retrieval `emerging` emits Transfer Evidence and can produce `transfer_confirmed`; a seen, scaffolded, or first-state-unknown context cannot;
5. Boundary Evidence appears only for a required approved boundary Action;
6. invalid/passive/interrupted flows emit no positive Evidence and interruption emits no Outcome;
7. replay returns the same Action/Attempt/Outcome and does not increment semantic or FSRS revisions twice;
8. rebuilding State from Evidence reproduces `state_digest`;
9. another learner/Workspace cannot read or mutate the Encounter;
10. no generic sync entity, Carrier Card, draft content, or existing Flashcards route contract is changed.
