# Sensa product context

> Status: canonical ubiquitous language  
> Updated: 2026-09-05
> Domain document index: [`docs/sensa/README.md`](docs/sensa/README.md)

Sensa is a sense-first language-learning product. Its durable learning identity
is one learner-specific Sense–target-expression connection. A versioned,
learner-selectable Learning Policy coordinates purpose-specific Learning Protocols
that establish, check, strengthen or restore that connection across long-term retention.

## Content language

**Lexeme**:  
The form-level aggregate that owns a lemma, pronunciation and legal forms. It
is a shared lookup and presentation identity, not a learning or review identity.

**Sense**:  
A stable, addressable meaning distinction that a language community can
reproduce through one or more expressions. It can come from curated content or
confirmed on-demand Sense Construction; it is not a word, translation label or
learner's private experience.

**Sense Version**:  
The immutable semantic contract for one Sense, including its focus, boundary
and expression bindings. Published Packages and on-demand materializations pin it.

**Sense Expression Binding**:
A versioned relation from one Sense to a typed word, phrase, construction or
utterance in one language. It records how that expression covers the Sense and
never asserts a reversible translation equality.

**Sense Proposal**:
An LLM-generated, revisable semantic specification offered during Sense
Construction. It becomes a stable Sense identity only after valid direct or
learner-delegated Semantic Acceptance; acceptance alone does not make it reviewed
or learning-ready.

**Sense Construction**:
The learner–LLM dialogue that turns a personal meaning focus into a reproducible
Sense Proposal and, on valid Semantic Acceptance, a stable Sense. A Meaning Focus
is used only when Context does not already determine a teaching-sufficient Sense.
Construction creates semantic identity, not Learning Evidence or automatic
curriculum membership.

**Semantic LLM Role**:
The constrained model role that proposes and clarifies a Sense during Sense
Construction. Model output alone cannot create Semantic Acceptance or learning
content; a separate commit operation may act under an explicit learner delegation.

**Learning Content LLM Role**:
The constrained model role that generates candidate material for one fixed
Learning Target, Effective Learning Policy and purpose-specific Protocol. It cannot
change the Sense, silently downgrade the Policy, approve its own output or write
learner progress.

**Grading LLM Role**:
A future optional model role that evaluates an open response under a pinned
grader contract. It cannot invent or revise the rubric after seeing the response.

**Sense Learning Package**:  
The publishable bundle that pins a Sense Version, its target Sense Expression
Binding and referenced form versions, Acquisition Profile and approved Learning
Resources. It is the reusable published-content path, not the only lawful source
of learning content.

**Learning Target**:
The fixed object of one formal learning intent: a stable Sense Version, target
language expression binding, learner language/locale context and required scope.
It says what connection is being learned, not where content comes from or how it
will be taught.

**Learning Capability Objective（能力目标）**:
A versioned statement of the observable performance sought for one Learning Target.
It informs content, Protocol and evaluation; only an explicit, stable, independently
valuable objective with separate scheduling value extends Retention Target scope.

**Learning Entry Provenance**:
The versioned origin through which a Learning Target enters Curriculum, such as
Book membership, direct selection of an existing stable Sense, or a confirmed
complete Personal Meaning Alignment. It never changes target identity or makes Personal
Semantic World membership a prerequisite for learning.

**Learning Policy Profile**:
A versioned, auditable named composition of purpose-specific Protocol, content,
evaluation, progression, completion, repair, scheduling and claim policies. It
represents a mode such as lightweight or high-assurance, not target identity, daily
quantity or a generic presentation preference.

**Learning Policy Assignment**:
A versioned learner or Curriculum choice that applies one Learning Policy Profile at
learner-default, Curriculum-source or explicit target-override scope. It records its
scope and provenance. Ordinary Assignment changes may re-plan an uncommitted target,
but cannot replace a target's Committed Learning Policy or rewrite Protocol history.

**Effective Learning Policy**:
The deterministically resolved Learning Policy Assignment for one Learning Target.
Resolution prefers an explicit target override, then its applicable Curriculum
assignment, learner default and finally system default, while pinning profile version
and decision provenance.

**Committed Learning Policy**:
The Effective Learning Policy frozen for one Retention Target when its first formal
Protocol Run is created. It governs subsequent initial-learning, retention-review and
relearning Protocol selection for that learning lineage; ordinary settings or
Assignment changes cannot alter it.

**Learning Policy Migration**:
An explicit, auditable transition from one Committed Learning Policy to another at a
safe Runtime boundary. It creates new Assignment, commitment and plan revisions while
preserving prior Runs, outcomes, Evidence, Scheduling Handoffs and FSRS state; it is
not an in-place edit or an automatic response to newly available content.

**Resolved Learning Plan**:
The versioned plan derived from one Learning Target, its Learning Capability Objectives,
Effective Learning Policy and currently available content/runtime capabilities. It
resolves purpose-specific Protocols, provisioning requirements and readiness, not a
precomputed Card sequence, Session queue or future review calendar.

**Learning Plan Readiness**:
The purpose-specific `preparing | ready | blocked` state of a Resolved Learning Plan.
Only a `ready` purpose may enter formal Protocol planning; `blocked` preserves the
learner's Curriculum membership and reports the real capability or content reason.

**Retention Target**:
The authoritative learner-specific learning identity for one stable Sense–target-
expression connection and any explicitly independent retention scope. It owns
target-specific progress and at most one FSRS Memory State; protocol, content,
prompt, Card and ordinary capability variation do not create another target.

**Content Provisioning**:
The versioned decision that resolves a Learning Target through published,
on-demand or hybrid content, under a fixed Content Demand, into one immutable
Learning Materialization. It does not choose the Learning Protocol or modify
learner progress.

**Content Provisioning Task**:
The durable preparation objective for one fixed Learning Target, purpose-specific
Learning Protocol and exact Content Demand. It owns provisioning status and may
use multiple Content Agent Attempts, but never owns learner progress or Runtime state.

**Provisioning Batch**:
A non-atomic operational grouping of independent Content Provisioning Tasks for
dispatch, budgets and progress reporting. It does not share agent context, content
identity or failure fate, and it does not define daily learning quantity.

**Content Agent Attempt**:
One bounded, auditable execution of the Learning Content LLM Role and its approved
tools for a single Content Provisioning Task. It ends when it submits one Material
Candidate Bundle or fails, and has no authority after termination.

_Avoid_: Agent thread, generation chat

**Content Demand**:
A source-neutral, versioned and machine-readable declaration of the material
roles and input context a Learning Protocol requires, including their schemas,
cardinality, permitted sources/uses, validation policies and declared external
derivations. It says what must be available, not whether a catalog, model or tool
supplies it, and it does not prescribe Cards or session order.

**Content Context Artifact**:
One immutable, provenance-bearing input supplied to Content Provisioning, such
as the fixed target expression, confirmed Sense, an authorized Personal Anchor
or a source-backed lexical fact. It may be supplied initially or frozen from an
approved tool result; a model's unsupported observation never becomes authority.

**Content Generation Request**:
A standalone, idempotent request that combines one fixed Learning Target,
Effective Learning Policy, purpose-specific Learning Protocol, exact Content
Demand, initial authorized Content Context Artifacts and approved tool/budget
constraints for one production attempt.

**Material Candidate**:
One untrusted proposed item for a declared material role, whether generated,
reused or derived by an external tool. It cannot enter a Protocol Run until its
schema, provenance, required validators and Content Demand coverage are accepted
and it is assembled into a Learning Materialization.

**Material Candidate Bundle**:
The immutable submission of supporting Content Context Artifacts, role-indexed
Material Candidates, provenance and explicit optional-role omissions from one
Content Agent Attempt. It is untrusted input to independent validation, not a
Learning Materialization.

**Content Derivation**:
A versioned transformation from accepted source material into another declared
material role, such as media synthesis. It is performed under a pinned producer
policy and is not additional model context or a learner-progress transition.

**Published Learning Content**:
Reusable, versioned learning material prepared and approved before a learner
run, normally through a Sense Learning Package. Its producer may be human, LLM
or mixed; publication timing and governance distinguish it from on-demand content.

**On-demand Learning Content**:
Material generated for one fixed Learning Target, Effective Learning Policy and
purpose-specific Learning Protocol after the learner need is known. It must be
validated and frozen before use and does not become published content merely because
an LLM generated it successfully.

**Learning Materialization**:
The immutable, protocol-ready content snapshot resolved from published,
on-demand or hybrid sources for one learning run. It pins the effective policy/plan
and Protocol versions; Actions and outcomes cite this snapshot rather than mutable
prompts or a live model response.

**Learning Protocol**:
A versioned method contract that declares required content roles, allowed
actions, Checkpoints, evaluation and transition rules, completion semantics, evidence
claims and Scheduling Handoff rules for establishing, checking, strengthening or
restoring one meaning–form connection.

**Protocol Purpose**:
The closed purpose of a Learning Protocol: `initial_learning`,
`retention_review` or `relearning`. Purpose controls which completion and
scheduler transitions the Protocol may produce.

**Initial Learning Protocol**:
A Learning Protocol whose successful run establishes the first formal
meaning–form connection and must end in an Initial Learning Completion followed
by a Scheduling Handoff.

**Retention Review Protocol**:
A Learning Protocol that evaluates one FSRS-due Retention Target and produces at
most one Memory Outcome for that due Review. It updates an existing schedule
rather than initializing one.

**Relearning Protocol**:
A Learning Protocol opened after a Review exposes forgetting or a repair need.
It restores the connection without reinitializing FSRS or re-rating the due
Review; a versioned Protocol may declare separate relearning evaluations eligible
to produce their own auditable Memory Outcomes.

**Structured Acquisition Protocol**:
The high-assurance Learning Protocol that uses interference-spaced Recognition,
Recall, Transfer and conditional Boundary Gates. It can produce Acquisition
Graduation and evidence-backed scheduling, but is not the only protocol.

**Lightweight Study Protocol**:
A lightweight Initial Learning Protocol that teaches from a compact content set
and, when successfully completed, hands the connection to retention without
resolving the Structured Acquisition Gates. Its
Study Completion is not proof of independent recall, transfer or mastery.

**Experience Sketch**:  
A reviewed, modality-independent specification of the concrete experience a
learner should construct before or during Sense binding. It is not text, media,
an interactive component or a learner-authored Personal Semantic Anchor.

**Experience Render**:  
One approved text, image, animation or interaction that realizes an Experience
Sketch for a supported client. Multiple Renders may share one Sketch without
changing its teaching intent.

**Text Experience Render**:
An approved natural-language scene that lets the learner mentally enact the
roles, states, changes or causal relations in an Experience Sketch. It is a
complete grounding path, not a definition, explanation, alt text or recap.

**Experience Recap**:

A reviewed, learner-facing compact reminder of an Experience Sketch used after
grounding or during repair. It is neither the authoring Sketch itself nor proof
that the learner reconstructed the experience.

**L1 Bridge**:
A reviewed learner-locale access path that activates familiar concepts and marks
important L1/L2 coverage differences. It is a scaffold, not the Sense itself, a
translation identity or an assessment answer.

**Learning Example / Study Example**:  
Learning Example is an immutable, reviewed context with an exact target
occurrence bound to one Sense Version. Study Example is a permitted teaching or
repair role of a Learning Example, not a separate content identity.

**Usage Pattern / Usage Example Binding**:

A Usage Pattern is a source-backed construction, collocation or restriction for
one Sense. A Usage Example Binding links one displayed pattern or collocation to
an exact occurrence in an immutable Learning Example; it is not a list index or
runtime text match.

**Assessment Task Resource**:

An immutable, reviewed prompt, response contract, grading basis and feedback
binding that can materialize one assessment Learning Action. It is content, not
a Card, learner Attempt, current Action or runtime choice of what to assess.

**Repair Asset Binding**:

A reviewed mapping from one capability or failure basis to approved teaching
resources that may restore the connection. Semantic Policy chooses the current
repair Action; the binding does not prescribe learner order or create Evidence.
Default repair reuses resources already present in the Package and does not
require a Binding per capability; a Binding exists only for an explicit,
reason-specific override.

**Attested Usage**:  
A source-backed occurrence in external media or a corpus, fixed to exact source
provenance, context and target occurrence with an approved contextual Sense
assignment. It becomes a Learning Example only through explicit editorial use.

**Example Render**:  
One approved presentation of a Learning Example, such as text, static audio or
time-aligned media. A Render does not change the Example, its Sense assignment
or its teaching/assessment role.

**Acquisition Profile**:  
The Structured Acquisition content diagnosis of the grounding, form-mapping,
retrieval, transfer and real boundary needs of one Learning Target. It is not learner
progress, a fixed lesson or a requirement of every Learning Protocol.

**Minimum Sufficient Experience**:
The smallest concrete semantic structure an Acquisition Profile says a learner
must construct to ground one Sense. It is not a card sequence, medium or success
Evidence.

**Acquisition Primitive**:
A media-independent pedagogical mechanism recommended by an Acquisition Profile,
such as causal sequence, spatial relation or introspective scenario. It is not a
renderer kind, asset or Runtime Action.

**Experience Render Plan**:
The versioned choice of exactly one preferred Render for one Experience Sketch,
plus optional alternative and fallback delivery paths. A non-text preferred
Render requires an approved Text Experience Render fallback; a preferred Text
Experience Render is already a complete path. The Plan is content policy, not
a learner path or an instruction to show every Render.

**Required Capability Set**:  
The profile-derived set of learning capabilities that must be executable and
resolved before a learner can graduate a Structured Acquisition Cycle for that
Learning Target.

**Required Asset Manifest**:  
The deterministic publication gate proving that a Package supplies approved
resources for its Required Capability Set and Structured Acquisition delivery
profile.

**Executable Learning Capability Inventory**:  
The versioned intersection of a pinned Package, its Required Capability Set and
the runtime's closed Action/renderer vocabulary. It describes executable
capabilities, not authored content or learner progress.

**Book / Book Version**:  
An ordered, immutable curriculum of selected Senses. The product may group and
count them by Lexeme, but a Lexeme is not silently substituted for membership.

**Sense Relation**:  
A reviewed, versioned semantic relationship between two Senses, such as a real
contrast, equivalence, overlap or broader/narrower boundary. It is content truth,
not learner progress.

**Semantic Field / Semantic Field Version**:  
A finite, curated neighborhood of related Senses and Sense Relations in one
Content Release. It is neither a Book nor a claim to be a universal ontology.

**Reference Lexicon / Reference Release**:  
A broad, versioned lookup corpus of source-backed words, multiword expressions,
Reference Senses and licensed enrichment. It may contain meanings that Sensa
does not teach and is neither a Book nor the Learning Catalog.

**Reference Context**:  
The version anchor used for one lookup, including at least a Reference Release
and optionally the Content Release or saved-item provenance from which it opened.

**Reference Lexical Unit / Reference Sense**:  
A lookup headword or multiword expression and one meaning distinction within a
specific Reference Release. A Reference Sense is not automatically a Sensa
Sense, curriculum member or learner-progress identity.

**Sense Alignment**:  
A reviewed, versioned relation between a Reference Sense and a Sensa Sense. The
relation can be `equivalent`, `reference_broader`, `reference_narrower` or
`overlaps`; absence of an alignment is valid.

**Lexical Occurrence**:  
An exact single- or multi-token character span in one immutable Example,
resolved to a Reference Lexical Unit and optionally to a contextual meaning.

**Contextual Sense Resolution**:  
A versioned candidate selection for one Lexical Occurrence, with status
`authored_target`, `reviewed`, `model_confident`, `ambiguous` or `unresolved`.
Model output selects from closed Reference Sense candidates; it does not invent
a definition or become reviewed lexical truth.

**Contextual Lookup**:  
A read operation over an exact Example and clicked character span that returns
the full reference entry in one Reference Context and, when reliable, emphasizes
the meaning used there. Lookup has no learning-progress effects.

**Lexical Enrichment**:  
Source-backed or reviewed material that helps understand and remember a lexical
unit, including morphological analysis, etymology, lexical-family relations and
explicitly labeled mnemonic aids. It is optional reference scaffolding, not
Learning Evidence or an assessment asset.

## Learner language

**Familiar Language / Target Language（L1 / L2）**:
Learner-relative roles for languages used to access an existing meaning and to
acquire a new expression connection. They are not intrinsic language properties
and do not imply one-to-one translation.

**Study Plan**:  
A learner's active formal-learning arrangement. It combines one active Book
Enrollment, optional Supplemental Curriculum, formal Learning Policy Assignments
and a daily new-Sense limit, but does not select the current learning action.

**Book Enrollment**:  
A learner's relationship to one immutable Book Version and a resolved Book
Range. Its mode is `active`, `maintenance` or `paused`; at most one Enrollment
may introduce new Senses at a time.

**Book Range**:  
The stable selection of Book Version members eligible for future Introduction.
Changing it does not erase progress or silently stop already-started learning.

**Supplemental Curriculum / Supplemental Membership**:  
The learner-owned ordered curriculum of formal Learning Targets explicitly
accepted through Add-to-Learning. A Membership may remain while its Resolved
Learning Plan is preparing or blocked; it is neither a Book, a Personal Collection
nor a Saved list and is not runtime-eligible until ready.

**Study Scope / Study Scope Revision**:  
The resolved, mode-aware set of Learning Targets currently in formal Curriculum
scope, de-duplicated by Retention Target and carrying source, Effective Learning
Policy and plan-readiness provenance in an immutable revision. Only purpose-ready
members are executable; a Session pins one revision so later changes cannot silently
alter work already in progress.

**Learner Sense Progress**:  
The learner-by-Sense roll-up over all Retention Targets and explicitly Sense-
scoped learner facts. It supports projection and navigation but never collapses
different target expressions into one phase, Protocol Run or FSRS Memory State.

**Learning Phase**:  
The Retention-Target planning phase `new`, `acquiring`, `retaining` or
`relearning`. It is a planning state, not a third time scale: `acquiring` belongs to
short-term acquisition, while `retaining` and recovery-oriented `relearning` belong
to long-term retention.

**Acquisition Cycle**:  
The Structured Acquisition Protocol run through which a new or forgotten
Retention Target resolves its required Acquisition Gates. It can span multiple
Encounters and Sessions but is not created by other protocols.

**Acquisition Gate**:  
A Structured Acquisition Protocol Checkpoint that represents a required capability
criterion with an unresolved, passed or failed state. Baseline families cover contextual
Sense recognition, Sense-to-form recall and novel-context transfer; Boundary is required
only for a real confusion target.

**Acquisition Graduation**:  
The transition that occurs when every required Gate in an initial Acquisition
Cycle is resolved by valid independent behavior. It is a behavioral Initial
Learning Completion, not permanent mastery.

**Initial Learning Completion**:
The protocol-specific successful end of an Initial Learning Protocol, such as
Study Completion, Acquisition Graduation or an accepted imported completion.
It authorizes but is distinct from the required Scheduling Handoff.

**Study Completion**:
The immutable completion result of a Lightweight Study Protocol run. It may
be a non-evidentiary Initial Learning Completion but is not Learning Evidence,
Acquisition Graduation or a mastery claim.

**Scheduling Handoff**:
The explicit transition by which an Initial Learning Completion asks the
retention scheduler to initialize a schedule. It records the
protocol outcome, initialization basis (`protocol_completion`,
`acquisition_graduation`, `learner_rating` or `imported`) and an independent
evidence level (`non_evidentiary`, `self_report`, `behavioral` or
`externally_attested`).

**Relearning Cycle**:  
A Structured Acquisition Cycle used by a Structured Relearning Protocol after a
long-term Review exposes forgetting or a specific unresolved capability. Other
Relearning Protocols do not create this Cycle.

**5D State**:  
The Retention-Target-specific, evidence-derived diagnostic projection over
Grounding, Boundary, Form Mapping, Retrieval and Transfer. It helps choose
interventions but does not replace Gate progress or determine due time.

**FSRS Memory State**:  
The long-term retention projection initialized by a valid Scheduling Handoff.
Each Retention Target owns at most one such state; it retains initialization
basis and evidence level and decides when that target is due, not what the
learner has objectively mastered.

**Declared Mastery（已会声明）**:  
A reversible learner declaration over an explicit Retention Target. A Sense-level
UI action may apply it only to a stated set of targets; it changes planning
eligibility without inventing learning evidence, graduating an Acquisition Cycle
or modifying FSRS.

**Learner Semantic Projection**:  
A derived cross-Sense view that presents published meaning/form relationships
together with the Personal Semantic World, learner progress and practice
activity. It is neither an authoritative progress aggregate nor a literal model
of the learner's mind.

**Semantic Intake**:
A port-neutral capture of a real context together with any Expression and Sense
information currently available. Text selection, image/audio capture, first-party
extensions and learner-authorized Agents all submit through this boundary. An Intake
may be incomplete and does not become Personal Semantic World membership by itself.

**Intake Inbox Item**:
A learner-owned unresolved Semantic Intake awaiting an Expression selection, a
teaching-sufficient Sense resolution, valid acceptance authority or an explicit
decision to discard it. The Inbox is the receiving area of the Personal Semantic
World surface, not part of its stable semantic inventory.

**Semantic Acceptance**:
The auditable authority by which a complete Context–Expression–Sense resolution is
committed to the Personal Semantic World. Acceptance may be performed directly by
the learner or by an Agent acting under an explicit learner delegation; provenance
must distinguish the two, but delegated acceptance does not require a second
first-party confirmation. Acceptance is not content review, Add-to-Learning or
Learning Evidence.

**Personal Semantic World（个人语义世界）**:
The learner-owned set of complete Personal Meanings committed through valid direct
or delegated Semantic Acceptance. Each member preserves a real Context, a located
Expression and its stable Sense relationship; an optional Meaning Focus may explain
how an ambiguous Context was resolved. It can explicitly bridge a confirmed target
into Curriculum, but is neither a learning prerequisite nor a progress owner.

**Personal Content**:  
The learner-owned references, annotations and organization they intentionally
create. It excludes inferred progress, activity history and semantic projections.

**Saved Sense / Saved Example**:  
A learner's reversible personal reference to a stable Sense or an exact immutable
Example. Saving changes neither formal eligibility nor the target's learning state.

**Sense Note**:  
The learner's single current free-form note for one Sense. It persists independently
of saving and is neither published linguistic truth nor Learning Evidence.

**Personal Semantic Anchor**:  
A provenance-bearing text, image, audio, scene or other real Context intentionally
committed for a Personal Meaning by the learner or an authorized delegate. It may
remain useful after Sense confirmation but is a private optional learning scaffold,
not reviewed content, learner progress or Evidence.

**Personal Semantic Region**:

A learner-owned organization area for related Personal Meanings and Sense
references. Its name, membership, order and visual geometry express personal
organization only; they do not create a Semantic Field, Sense Relation,
curriculum order or inferred mental structure.

**Personal Meaning（个人意义）**:

A stable learner-owned identity for one accepted contextual meaning the learner
chooses to preserve. A complete member fixes at least one Personal Semantic Anchor,
one located Personal Expression Anchor and one active relation to a stable Sense
Version and compatible Sense Expression Binding. It is never replaced by a word, a
Sense or an LLM summary.

**Meaning Focus**:

An optional, learner-accepted statement used when Context alone does not make the
intended Sense clear, such as the receiving rather than giving perspective in one
borrowing event. It is a resolution bridge, not a required field of Personal Meaning
or Personal Meaning Alignment, and must not be synthesized from a Sense definition
merely to satisfy storage shape.

**Personal Expression Anchor**:

A typed word, phrase, construction or utterance that helps the learner access or
tentatively express a Personal Meaning. It records language, learner-relative
familiar/target role, provenance and verification status; it is not a translation
identity or proof of learning.

**Personal Meaning Alignment**:

The explicit relation from one Personal Meaning to one stable Sense Version, grounded
in its Context and located Expression and optionally qualified by a Meaning Focus.
It preserves resolution and direct/delegated acceptance provenance. Acceptance
preserves the Personal Meaning and does not by itself add the Sense to formal learning.

**Personal Collection / Collection Membership**:  
A learner-named ordered organization of Sense and Example targets, plus one typed
reference placing a target in it. It is independent of saving, Books and Semantic Fields.

**Add-to-Learning Intent**:  
An explicit learner request to admit a resolved Learning Target into formal
Curriculum planning under an explicit or inherited Learning Policy. Curriculum may
accept it into Supplemental Curriculum with a preparing, ready or blocked plan,
report its Retention Target already in scope or reject an invalid/conflicting request;
the Intent is distinct from saving, collection membership and Free Practice.

## Runtime language

**Unified Planner**:  
The service that selects among due Review, ready protocol work and eligible new
Retention-Target work while respecting Study Plan and the pinned Learning Protocol.

**Learning Session**:  
A bounded period of learner activity containing ordered Encounters. Its intent
is `mixed` or `review_only`; it is not itself a learning or FSRS result.

**Mixed Session**:  
The primary daily-learning mode in which all eligible work families may be
planned, including new Sense introduction.

**Review-only Session**:  
The secondary mode restricted to due long-term Review and Review-originated
Relearning. It never introduces a new Sense or advances an initial Learning
Protocol run.

**Sense Encounter**:  
One scheduled contact with one Retention Target, its Sense and one Protocol Step
purpose. It can contain presentation, study, assessment and feedback or repair
according to its pinned Learning Protocol and Learning Materialization.

**Protocol Step**:
One versioned unit in a Learning Protocol's ordered, branching or cyclic
transition model. It declares purpose, required material roles, interaction,
result eligibility and next-step rules without prescribing a visual component.

**Experience Recall Step**:
The non-evidentiary practice Step in Lightweight Study that presents an
experience-and-Sense cue while withholding the target expression and invites the
learner to retrieve that expression before requesting a reveal.

**Expression Reveal Step**:
The instructional Step in Lightweight Study that discloses the target expression,
confirms its Sense binding and records a learner rating without creating behavioral
Evidence.

**Learning Action Intent**:
The semantic purpose of one Protocol Action: instruction, practice, assessment,
feedback or repair. Intent determines result eligibility; visual form does not.

**Protocol Step Instance**:
The learner-specific execution of one Protocol Step inside a Protocol Run. It
records pinned material bindings, state and transition result for replay/resume.

**Learning Action**:  
The intended intervention materialized from immutable resources. A UI may
render it as a card, but Card is not a domain identity.

**Card Presentation**:
A transient client rendering of the current Protocol Step/Action, possibly with
prompt, reveal, feedback or detail phases. It owns no learning identity,
curriculum membership, Evidence or schedule.

**Card Presentation Slot**:
A named region in a versioned Card Presentation contract that admits declared
material roles under cardinality, order, disclosure, missing-resource and
overflow rules. It owns neither content identity nor learning progress.

**Learning Attempt**:  
The learner's immutable raw response to the current Action.

**Learning Observation**:
The immutable interpretation of one Attempt and its response conditions under a pinned
interaction/grader contract, including correctness, latency, support use or learner rating.
It is input to evaluation, not itself Evidence, progress or a scheduler result.

**Learning Evidence**:  
The server-derived evidentiary statement from a valid Learning Observation under a
pinned Evidence Rule. Exposure, audio playback, acknowledgement and self-reported
understanding are not Evidence; a lawful protocol may still use them as non-evidentiary
completion or scheduling basis.

**Protocol Checkpoint**:
A protocol-local evaluative milestone that references one or more Learning Capability
Objectives and owns current credit within a Protocol Run. It is optional, is not a
Capability Objective or Retention Target, and never derives identity from a Card.

**Protocol Transition Decision**:
The immutable, versioned decision that maps an Observation and any admissible Evidence
to Checkpoint credit, repair, reassessment, progress reset, advancement or completion.

**Progress Reset**:
A Protocol Transition effect that invalidates current Checkpoint credit for an explicit
scope—one Checkpoint, a declared set or the Run—without deleting Attempt, Observation,
Evidence or prior transition history.

**Encounter Outcome**:  
The immutable semantic completion result of one Encounter under its pinned
Learning Protocol. Acquisition Step, Lightweight Study and long-term Memory
Outcomes retain distinct semantics; a Protocol Run may separately reach an
Initial Learning Completion or Relearning Completion after applying them.

**Acquisition Step Outcome**:  
The immutable result of an Acquisition Encounter, such as introduction, Gate
pass or Gate failure. It updates Acquisition progress and never directly rates FSRS.

**Lightweight Study Outcome**:
The immutable result of a Lightweight Study Encounter, such as content presented,
optional recall attempted or Study Completion. It does not create Gate or 5D facts.

**Memory Outcome**:  
An immutable scheduler-facing result from one protocol-declared evaluation of an
existing Retention Target. A due Review produces at most one; a scheduler-eligible
Relearning evaluation may produce a separate result. Every result records its
origin, grade and basis, is applied to FSRS at most once and never rewrites an earlier one.

**Memory Outcome Grade**:
The scheduler-stable ordinal result `again | hard | good | easy`. Protocol-specific
responses and labels map to a grade without collapsing meaningful uncertainty into a
Boolean; grade remains separate from evidence basis and claim strength.

**Scheduling Decision**:
The immutable scheduler result obtained from one Memory State revision and one valid
Memory Outcome. It produces the next Memory State and due time; Protocols and clients
cannot write either directly.

**Relearning Completion**:
The successful end of a Relearning Protocol Run. It returns the Retention Target
to retention without changing the triggering Review outcome or reinitializing
FSRS; completion itself is not a scheduler update.

**Semantic Policy**:  
The Structured Acquisition policy that selects the smallest current intervention from the
Protocol Step purpose, executable capabilities, Gate progress, Evidence and 5D State.

**Free Practice Profile**:  
A versioned delivery contract declaring permitted Practice Task families and
their target, channel, resource, renderer and grader requirements. It is not an
Acquisition Profile, learner preference or progress state.

**Package Practice Manifest**:  
The approved practice roles and resources one Package can offer under a Free
Practice Profile. Its absence never makes an acquisition-ready Package unpublishable.

**Executable Practice Capability Inventory**:  
The versioned intersection of a Free Practice Profile, Package Practice
Manifests and current runtime/client support. It determines which Task families
can honestly be offered, not what the learner has mastered.

**Free Practice Session**:  
A learner-initiated activity over an explicitly chosen Practice Scope. It is
separate from Learning Session and does not settle formal Acquisition or Review.

**Practice Scope**:  
The resolved set of Sense, Lexeme-form or Example targets selected for one Free
Practice Session, with provenance such as a Book slice, saved items or history.

**Practice Mode**:  
The learner-facing receptive or productive channel grouping—listening,
speaking, reading or writing. It is not a mastery dimension or graduation gate.

**Practice Task**:  
One practice item defined by its prompt channel, response channel, target
capability and support level. Its target can be Sense-, Lexeme-form- or
Example-specific.

**Practice Activity**:  
A practice-local record of passive or non-graded interaction such as browsing,
playback or following along. It is neither a Practice Result nor Learning Evidence.

**Practice Attempt / Practice Result**:  
A learner response inside Free Practice and its practice-local evaluation. They
do not become Learning Evidence, an Encounter Outcome or an FSRS input.

## Account and settings language

**Account / Learner**:  
Account is the authenticated access and lifecycle identity; Learner is the
learning identity that owns plans, progress, personal content and learner-scoped
preferences. Sensa V1 relates one Account to exactly one Learner without merging them.

**Account Session**:  
One authorized login session for an Account. It grants product access and is
unrelated to a Learning Session or Free Practice Session.

**Learner Preference**:  
A typed, versioned choice that follows one Learner across devices and influences
future presentation or approved asset selection. It is not a Study Plan setting,
learning policy, Evidence or progress.

**Device Installation / Device Preference**:  
One learner-visible installation and its local presentation choices, such as
autoplay, theme or playback behavior. A Device Installation may use a Replica
for transport, but the Replica is not the product identity.

**Sync Health**:  
A derived, read-only view of pending local work, connectivity, installed content
and the last successful convergence. It is a status, not a preference.

**Settings Surface**:  
A product page composing Account, Learner Preference, Device Preference, Study
Plan links, Sync Health and data controls. It is not a domain aggregate and does
not own the facts it displays.

**Data Control Request**:  
An explicit, auditable Account request to export or delete the learner's data.
It has its own lifecycle and is distinct from sign-out, local data clearance and
any future learning-history reset.

**Local Data Clearance**:  
A device-scoped removal of installed content, media and local replica data after
pending work is resolved or explicitly discarded. It does not delete Account or
server-side Learner data.

## Transport language

**LearnerScope / Replica**:  
The authenticated learner boundary and one offline installation identity. They
are authorization and synchronization concepts, not product navigation.

## Boundary language

**Independent learning entry**:
Formal Learning may begin from Book membership, direct selection of an existing
stable Sense or an explicit Personal Semantic World bridge. Every path remains
Sense-first, but only the personal-first path owns Personal Meaning facts.

**Shared Lexeme, independent Senses**:  
Sibling Senses reuse Lexeme-level form facts but keep independent learning
content/materializations, curriculum membership, Protocol Runs, Evidence,
declarations and schedules.

**Reference breadth, learning selectivity**:  
The Reference Lexicon may show every discoverable Reference Sense, while Sensa
only admits stable Senses with a target expression and a valid Learning Policy
Assignment. Formal Runtime still requires a ready Resolved Learning Plan and an
executable published, on-demand or hybrid content path; browsing a reference-only
meaning creates neither fact.

**Preference scope, explicit ownership**:  
Learner Preferences sync, Device Preferences remain local, and Curriculum owns
daily limits, Books, ranges and Learning Policy Assignments. Changing any
presentation preference or learning policy never rewrites learning history,
active Protocol facts or derived mastery state.

**Standalone Product Boundary**:  
The Sensa product covers selected Sense content, Learning Protocols, retention,
lexical reference, semantic exploration, personal content and free practice
around them, including constrained learner–LLM Sense Construction. Exam-paper
corpora or “真题” sections, Cards, Decks, generic flashcard behavior, Workspace
navigation, generic AI/MCP surfaces, community, commerce and historical
experiments are outside this context.
