# Sensa product context

> Status: canonical ubiquitous language  
> Updated: 2026-08-28  
> Domain document index: [`docs/sensa/README.md`](docs/sensa/README.md)

Sensa is a sense-first language-learning product. Its learning identity is one
specific meaning, and its learning loop first acquires that meaning–form
connection before handing it to long-term retention scheduling.

## Content language

**Lexeme**:  
The form-level aggregate that owns a lemma, pronunciation and legal forms. It
is a shared lookup and presentation identity, not a learning or review identity.

**Sense**:  
One selected meaning distinction of a Lexeme. It is the curriculum membership,
learner progress, declaration and scheduling identity.

**Sense Version**:  
The immutable linguistic facts for one Sense in a Content Release.

**Sense Learning Package**:  
The publishable bundle that pins a Sense Version, its Lexeme Version,
Acquisition Profile and approved Learning Resources.

**Experience Sketch**:  
A reviewed, modality-independent specification of the concrete experience a
learner should construct before or during Sense binding. It is not text, media,
an interactive component or a learner-authored Personal Semantic Anchor.

**Experience Render**:  
One approved text, image, animation or interaction that realizes an Experience
Sketch for a supported client. Multiple Renders may share one Sketch without
changing its teaching intent.

**Learning Example / Study Example**:  
Learning Example is an immutable, reviewed context with an exact target
occurrence bound to one Sense Version. Study Example is a permitted teaching or
repair role of a Learning Example, not a separate content identity.

**Attested Usage**:  
A source-backed occurrence in external media or a corpus, fixed to exact source
provenance, context and target occurrence with an approved contextual Sense
assignment. It becomes a Learning Example only through explicit editorial use.

**Example Render**:  
One approved presentation of a Learning Example, such as text, static audio or
time-aligned media. A Render does not change the Example, its Sense assignment
or its teaching/assessment role.

**Acquisition Profile**:  
The content diagnosis of the grounding, form-mapping, retrieval, transfer and
real boundary needs of one Sense. It is not learner progress or a fixed lesson.

**Required Capability Set**:  
The profile-derived set of learning capabilities that must be executable and
resolved before a learner can graduate an Acquisition Cycle for the Sense.

**Required Asset Manifest**:  
The deterministic publication gate proving that a Package supplies approved
resources for its Required Capability Set and current delivery profile.

**Executable Learning Capability Inventory**:  
The versioned intersection of a pinned Package, its Required Capability Set and
the runtime's closed Action/renderer vocabulary. It describes executable
capabilities, not authored content or learner progress.

**Book / Book Version**:  
An ordered, immutable curriculum of selected Senses. The product may group and
count them by Lexeme, but a Lexeme is not silently substituted for membership.

**Sense Relation**:  
A reviewed, versioned semantic relationship between two Senses, such as a real
contrast or confusion boundary. It is content truth, not learner progress.

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

**Study Plan**:  
A learner's active formal-learning arrangement. It combines one active Book
Enrollment, optional Supplemental Curriculum and a daily new-Sense limit, but
does not select the current learning action.

**Book Enrollment**:  
A learner's relationship to one immutable Book Version and a resolved Book
Range. Its mode is `active`, `maintenance` or `paused`; at most one Enrollment
may introduce new Senses at a time.

**Book Range**:  
The stable selection of Book Version members eligible for future Introduction.
Changing it does not erase progress or silently stop already-started learning.

**Supplemental Curriculum / Supplemental Membership**:  
The learner-owned ordered curriculum of individual Senses explicitly accepted
through Add-to-Learning. It is neither a Book, a Personal Collection nor a Saved list.

**Study Scope / Study Scope Revision**:  
The resolved, mode-aware and de-duplicated set of Senses currently eligible for
formal Planning, with source provenance and an immutable revision. A Session
pins one revision so later curriculum changes cannot silently alter work already
in progress.

**Learner Sense Progress**:  
The authoritative learner-by-Sense aggregate that records the learning phase,
active Acquisition Cycle, gate projection, declaration and optional FSRS state.

**Learning Phase**:  
The learner-by-Sense planning phase `new`, `acquiring`, `retaining` or
`relearning`. Declared Mastery is a separate, orthogonal declaration.

**Acquisition Cycle**:  
The short-term, interference-spaced process through which a new or forgotten
Sense resolves its required Acquisition Gates. It can span multiple Encounters
and Sessions.

**Acquisition Gate**:  
A required capability checkpoint with an unresolved, passed or failed state.
Baseline gate families cover contextual Sense recognition, Sense-to-form recall
and novel-context transfer; Boundary is required only for a real confusion target.

**Acquisition Graduation**:  
The transition that occurs when every required Gate in an initial Acquisition
Cycle is resolved by valid independent behavior. It initializes long-term
retention but does not mean permanent mastery.

**Relearning Cycle**:  
An Acquisition Cycle opened after a long-term Review exposes forgetting or a
specific unresolved capability. It preserves all earlier learning and FSRS
history; completion returns to retention without reinitializing FSRS.

**5D State**:  
The evidence-derived diagnostic projection over Grounding, Boundary, Form
Mapping, Retrieval and Transfer. It helps choose interventions but does not
replace Gate progress or determine due time.

**FSRS Memory State**:  
The long-term retention projection initialized only after Acquisition
Graduation. It decides when a retaining Sense is due, not what the learner does.

**Declared Mastery（已会声明）**:  
A reversible learner declaration that one Sense is already known. It changes
planning eligibility without inventing learning evidence, graduating an
Acquisition Cycle or modifying FSRS.

**Learner Semantic Projection**:  
A derived cross-Sense view that overlays learner progress, personal content and
practice activity on published Semantic Fields. It is not an authoritative
progress aggregate or a literal model of the learner's mind.

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
A learner-authored personal experience or scenario connected to one Sense. It is
a private optional scaffold, not reviewed content, learner progress or Evidence.

**Personal Collection / Collection Membership**:  
A learner-named ordered organization of Sense and Example targets, plus one typed
reference placing a target in it. It is independent of saving, Books and Semantic Fields.

**Add-to-Learning Intent**:  
An explicit learner request to admit a Sense into formal Curriculum planning.
Curriculum may accept it into Supplemental Curriculum, report it already in
scope or reject it; the Intent is distinct from saving, collection membership
and Free Practice.

## Runtime language

**Unified Planner**:  
The service that selects among due Review, ready Relearning, ready Acquisition
and eligible new-Sense work while respecting Study Plan and interference rules.

**Learning Session**:  
A bounded period of learner activity containing ordered Encounters. Its intent
is `mixed` or `review_only`; it is not itself a learning or FSRS result.

**Mixed Session**:  
The primary daily-learning mode in which all eligible work families may be
planned, including new Sense introduction.

**Review-only Session**:  
The secondary mode restricted to due long-term Review and Review-originated
Relearning. It never introduces a new Sense or advances initial Acquisition.

**Sense Encounter**:  
One scheduled contact with one Sense and one primary learning purpose. It can
contain presentation, one evidence-bearing assessment and feedback or repair,
but an Acquisition Cycle spans multiple Encounters.

**Learning Action**:  
The intended intervention materialized from immutable resources. A UI may
render it as a card, but Card is not a domain identity.

**Learning Attempt**:  
The learner's immutable raw response to the current Action.

**Learning Evidence**:  
The server-derived behavioral observation from a valid Attempt. Exposure,
audio playback, acknowledgement and self-reported understanding are not Evidence.

**Encounter Outcome**:  
The immutable semantic completion result of one Encounter. It is either an
Acquisition Step Outcome or a long-term Memory Outcome, never both.

**Acquisition Step Outcome**:  
The immutable result of an Acquisition Encounter, such as introduction, Gate
pass or Gate failure. It updates Acquisition progress and never directly rates FSRS.

**Memory Outcome**:  
The single long-term retention result of a completed due Review Encounter. It
is mapped to FSRS at most once even when failure opens a later Relearning Cycle.

**Semantic Policy**:  
The versioned policy that selects the smallest current intervention from the
Encounter purpose, executable capabilities, Gate progress, Evidence and 5D State.

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

**Shared Lexeme, independent Senses**:  
Sibling Senses reuse Lexeme-level form facts but keep independent Packages,
curriculum membership, Acquisition, Evidence, declarations and schedules.

**Reference breadth, learning selectivity**:  
The Reference Lexicon may show every discoverable Reference Sense, while Sensa
only learns selected Senses with an executable published Package. Browsing a
reference-only meaning does not make it eligible for Add-to-Learning.

**Preference scope, explicit ownership**:  
Learner Preferences sync, Device Preferences remain local, and Curriculum owns
daily limits, Books and ranges. Changing any preference never rewrites learning
history or derived mastery state.

**Standalone Product Boundary**:  
The Sensa product covers selected Sense content, acquisition, retention,
lexical reference, semantic exploration, personal content and free practice
around them. Exam-paper corpora or “真题” sections, Cards, Decks, generic
flashcard behavior, Workspace navigation, AI/MCP surfaces, community, commerce
and historical experiments are outside this context.
