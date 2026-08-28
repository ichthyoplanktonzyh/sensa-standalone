# Sensa Runtime Rule Packet V2

Status: **Active versioned implementation contract; not a domain model**  
Date: 2026-08-26

This packet is the current deterministic Learning Kernel contract for newly
planned Encounters. It makes the Semantic Policy decision explicit, retains
the V1 completion behavior through an explicit Stop Policy V2 and Memory
Outcome V3 Decision interface, corrects Evidence/5D projection, and separates
acquisition pacing from FSRS scheduling.

## 1. Frozen tuple

Every newly planned Encounter freezes this exact tuple:

```text
capabilityResolverVersion = sensa-executable-learning-capability-resolver-v1
semanticPolicyVersion = sensa-semantic-policy-v2
stopPolicyVersion     = sensa-stop-policy-v2
evidenceRuleVersion   = sensa-evidence-rule-v2
stateUpdaterVersion   = sensa-state-updater-v2
outcomeMappingVersion = sensa-memory-outcome-v3
```

The Resolver version is part of the Kernel replay tuple, not merely content
tooling metadata. Action payloads use the closed `sensa-learning-action-v3` union and Attempt
responses remain `sensa-learning-response-v1`. V3 adds a stable Semantic Policy
decision code to the immutable Action identity and digest; it does not add a
client-writable decision surface.

Action, Attempt and Evidence facts remain immutable. The pre-launch runtime
writes only the tuple above; it does not carry a second Memory Outcome mapping
or FSRS Adapter path.

## 2. Semantic Policy V2

`SemanticPolicyModule.decide(context)` is a pure, in-process Kernel seam. Its
input is limited to the current Encounter kind, relevant 5D levels, the pinned
Package's resolved executable capability inventory, and accepted Encounter history.
It does not query Postgres, select a concrete asset row, write learner state or
choose a UI component. It returns the minimum learning decision required now:
reason code, Action kind, target dimension, primitive, scaffold, renderer
capability, capability code and context-novelty strategy. The Encounter
Module materializes that decision from the pinned Package.

`ExecutableLearningCapabilityModule.resolve(packageSnapshot)` is the pure seam
immediately before Policy. It intersects Profile requirements/preferences,
approved Package resources and the closed runtime vocabulary. It returns stable
`resolverVersion`, capability codes plus eligible asset identities. Its Interface
also exposes the same frozen `version`. Policy receives only codes and
primitive availability; Encounter receives the identities after Policy decides.
Unsupported required capability fails closed. Missing optional capability is
omitted and cannot be mistaken for an executable renderer.

Publication records the Resolver version on the Content Release and every
satisfied Required Asset Manifest. Planning copies that version into the
immutable Encounter. Runtime accepts only the exact current tuple and resolves
the pinned Package through that same Module version; it never live-upgrades an
existing Encounter to different capability semantics.

The frozen decision order is:

| Condition | decision code | Action |
|---|---|---|
| Introduction | `introduction_grounding` | full-support `grounding_bind` |
| Review, Boundary not stable/not yet assessed, executable case exists | `boundary_gap` | `boundary_discrimination` |
| Exactly one retrieval failure and no repair emitted | `retrieval_repair` | full-support `retrieval_repair` |
| First retrieval, Grounding not stable | `retrieval_first_meaning_to_form` | `meaning_to_form_recall` |
| First retrieval, Grounding stable | `retrieval_first_cloze` | `cloze_recall` |
| Later retrieval after meaning-to-form | `retrieval_continue_meaning_to_form` | preserve meaning-to-form |
| Later retrieval after Cloze | `retrieval_continue_cloze` | preserve Cloze |

The first retrieval kind remains fixed within the Encounter. Retrieval uses
`reduced` scaffold after a failure or strong support; otherwise it uses `none`.
A first-retrieval preference falls back to the other executable retrieval kind
when its preferred capability is absent; if neither is available, the Package
is not executable.
A Cloze context is forced familiar after either condition; otherwise selected
asset novelty is retained. Boundary asset rotation and concrete payload/asset
construction are Encounter materialization concerns, not Policy branches.

Every persisted Action must carry one allowed decision code whose shape matches
its Action kind and metadata. `actionDigest` covers Encounter id, ordinal,
decision code, canonical payload and ordered asset references. This makes the
server-owned reason replayable and tamper-evident across API and Sync.

## 3. Evidence Rule V2

Content Actions, acknowledgement, invalid response, interruption and
cancellation still emit no mastery Evidence. Boundary and Cloze mappings are
unchanged.

| Action result | V2 Evidence |
|---|---|
| Boundary correct / incorrect | Boundary positive / negative |
| Meaning-to-form correct | Grounding, Form Mapping and Retrieval positive |
| Meaning-to-form incorrect | Form Mapping and Retrieval negative |
| Cloze correct / incorrect | Form Mapping and Retrieval positive / negative |
| Eligible novel unscaffolded Cloze | additionally Transfer positive / negative |

An incorrect meaning-to-form response establishes that the learner did not
recover the target form from the cue. It does not establish that the learner
failed to understand the cue itself, so V2 emits no Grounding-negative row for
that result. Basis codes and deterministic Evidence identity construction are
otherwise unchanged; V2 rows carry `sensa-evidence-rule-v2`.

## 4. State Updater V2

The projection shape remains `{ level, positiveCount, failureStreak }` for each
of Grounding, Boundary, Form Mapping, Retrieval and Transfer.

Positive Evidence is unchanged: increment `positiveCount`, clear the failure
streak, and make the level `emerging` after the first positive or `stable` after
the second.

Negative Evidence increments `failureStreak` without incrementing
`positiveCount`:

- an `unknown` level remains `unknown` after its first failure;
- an `emerging` level remains `emerging` after its first consecutive failure;
- a `stable` level falls to `emerging` after its first consecutive failure;
- any level becomes `unknown` after two consecutive failures.

Therefore failure never manufactures progress from `unknown` to `emerging`.

## 5. Stop Policy V2 and Memory Outcome V3

`SensaEncounterCompletionPolicyModule.decide(input)` is a pure, in-process
Kernel seam. It returns one atomic pair:

- a Stop Decision with `continue|complete` plus a stable reason code;
- no Memory Outcome Decision for `continue`, or exactly one compatible Memory
  Outcome Decision for `complete`.

Callers cannot independently choose when to stop and which Outcome kind to
apply. Continue decisions are reproducible from immutable Encounter facts; a
completed Encounter persists its completion reason. Every Memory Outcome
persists both its kind and classification reason.

The Stop Policy order is:

| Condition | disposition | Stop Decision code |
|---|---|---|
| Invalid response | continue | `attempt_invalid` |
| Introduction without accepted `grounding_bind` | continue | `introduction_grounding_required` |
| Accepted introduction `grounding_bind` | complete | `introduction_grounding_accepted` |
| Review Action is not retrieval | continue | `review_retrieval_required` |
| Valid retrieval has no resolved correctness | continue | `retrieval_result_unresolved` |
| First incorrect retrieval | continue | `retrieval_retry_required` |
| Second incorrect retrieval | complete | `retrieval_failure_limit_reached` |
| Correct retrieval | complete | `retrieval_succeeded` |

Every completed Encounter still emits exactly one semantic Memory Outcome, but
not every Outcome is an FSRS review:

| Outcome | Memory Outcome Decision code | disposition | FSRS rating |
|---|---|---|---|
| `introduced` | `introduced_after_grounding` | `acquisition_pending` | null |
| `retrieval_failed` | `retrieval_failed_after_failure_limit` | `fsrs_applied` | 0 |
| `supported_retrieval` | `supported_retrieval_after_prior_failure` | `fsrs_applied` | 1 |
| `supported_retrieval` | `supported_retrieval_after_strong_support` | `fsrs_applied` | 1 |
| `independent_retrieval` | `independent_retrieval_without_support` | `fsrs_applied` | 2 |
| `transfer_confirmed` | `transfer_confirmed_after_novel_cloze` | `fsrs_applied` | 3 |

Classification is least optimistic in this order: prior retrieval failure,
strong support, eligible novel unscaffolded Cloze transfer, then independent
retrieval. The two supported-retrieval reason codes distinguish repair history
from other strong support without changing their FSRS rating.

An acquisition-pending Outcome has null `effectiveReviewedAt`, Adapter version,
scheduler digest and due time. Its Sense Memory State remains the valid `new`
shape (`reps=0`, null FSRS memory fields). Planning schedules its first
evidence-bearing retrieval according to Session acquisition pacing. The first
completed retrieval starts FSRS from `new`; later retrievals advance the stored
FSRS state normally.

The single active Adapter version is `sensa-fsrs-adapter-v2`. Callers pass the
complete Memory Outcome Decision to the Memory Outcome Module once and do not
branch on Outcome kind themselves.

## 6. Deterministic V1-to-V2 projection transition

`Learner Semantic State` is a rebuildable cache, so upgrading it is not an
in-place edit of the V1 snapshot. On the next Evidence-bearing Attempt the
server rebuilds the Sense projection from its complete Evidence stream ordered
by `(derived_at, learning_evidence_id)` under `sensa-state-updater-v2`.

During that rebuild, a legacy V1 row matching all of these fields is consumed
but excluded from dimension counts:

```text
evidenceRuleVersion = sensa-evidence-rule-v1
dimension           = grounding
polarity            = negative
basisCode            = meaning_to_form.incorrect
```

This is the deterministic compatibility rule for the V1 overclaim; the
append-only Evidence fact is not deleted. `projectedThroughEvidenceId` still
advances through the consumed row. Existing untouched V1 projections may be
served as V1 until their next Evidence-bearing Attempt; both projection
versions are explicit on the wire.

The V2 State digest uses the same canonical line format as V1 with
`projection=sensa-state-updater-v2`. Mutable revision and timestamps remain
outside the digest.

## 7. Acceptance examples

1. `unknown` Retrieval plus one negative remains `unknown` with failure streak 1.
2. `stable` Retrieval plus one negative becomes `emerging`; a second consecutive
   negative becomes `unknown`.
3. Incorrect meaning-to-form produces exactly Form Mapping and Retrieval
   negatives.
4. Correct meaning-to-form produces Grounding, Form Mapping and Retrieval
   positives.
5. Rebuilding a V1 stream under V2 skips only the legacy Grounding-negative
   overclaim above and reproduces the same V2 digest on every replay.
6. Completing `introduced` produces `acquisition_pending`, null rating/due and
   a `new` Memory State with `reps=0`.
7. The first completed retrieval produces `fsrs_applied`; only then does the
   Memory State gain FSRS memory values and a due time.
8. The same Policy context always returns the same complete decision, and the
   introduction/boundary/first-retrieval/repair/continuation matrix is closed.
9. Changing an Action's decision code without changing its payload invalidates
   its canonical V3 digest.
10. Every completion reason maps to a compatible Outcome kind, and changing an
    Outcome Decision reason to one from another kind is rejected by contracts
    and storage constraints.
