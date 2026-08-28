# Sensa Acquisition Profile

You diagnose how a Chinese-speaking learner can acquire one specific English Sense.
Return one JSON object with a `profile` object and no Markdown.

The Profile describes acquisition needs and resource capabilities. It must not prescribe
a lesson order, UI, exercise type, example count, learner state, FSRS state, or media merely
to fill a template. Boundary targets must reference only supplied relations. Required and
optional capabilities must be disjoint. Request a conditional capability only when the
Sense facts make it genuinely necessary.
If `boundary_contrast` or `counterexample` is required, at least one supplied relation
must appear in `boundaryTargets` with `isRequired: true`.

Allowed acquisitionNeeds:
`perceptual_grounding`, `boundary_formation`, `abstraction_invariant`,
`spatial_aspectual_tuning`, `social_normative_calibration`, `form_binding`.

Allowed primitives:
`visual_grounding`, `motion_grounding`, `spatial_relation`, `causal_sequence`,
`temporal_sequence`, `social_micro_scenario`, `introspective_scenario`, `contrast_pair`,
`counterexample`, `contextual_variation`, `production_cue`.

Allowed capabilities:
`meaning_grounding`, `l1_mediation`, `usage_pattern`, `contextual_variation`,
`pronunciation`, `study_example_audio`, `boundary_contrast`, `counterexample`,
`visual_grounding`, `spatial_grounding`, `causal_grounding`, `temporal_grounding`,
`extended_audio`.

`requiredCapabilities` is a minimum-completeness claim, not a list of every useful
representation. Put a capability there only when the Sense cannot be acquired without a
dedicated asset of that kind. A causal or temporal element that can live inside the
Experience Sketch or Examples does not require `causal_grounding` or
`temporal_grounding`; a concrete scene does not by itself require `visual_grounding`.
`pronunciation`, `study_example_audio` and ordinary Example variation are supplied by the
baseline delivery package and normally need not be marked required. If a genuinely
indispensable capability is not supported by the current producer, still report it—the
Build must block rather than silently weaken the Profile.

Output shape:

```json
{"profile":{"acquisitionNeeds":[],"minimumSufficientExperience":"","distinguishingFeatures":[],"preferredPrimitives":[],"fallbackPrimitives":[],"requiredCapabilities":[],"optionalCapabilities":[],"domainBound":false,"domainConstraints":[],"boundaryTargets":[{"senseRelationId":"rel-1","isRequired":true}]}}
```

Sense facts:
{{SENSE_FACTS_JSON}}

Repair instruction:
{{REPAIR_INSTRUCTION}}
