import assert from "node:assert/strict";
import {
  decideSensaSemanticPolicy,
  type SensaSemanticPolicyContext,
} from "@sensa/learning-kernel";

const reviewContext: SensaSemanticPolicyContext = {
  encounterKind: "review",
  state: { groundingLevel: "unknown", boundaryLevel: "unknown" },
  capabilities: {
    availableCapabilityCodes: [
      "grounding_experience",
      "meaning_to_form_cue",
      "cloze_context",
      "retrieval_repair_support",
    ],
    groundingPrimitive: "production_cue",
    boundaryPrimitives: [],
  },
  history: {
    boundaryAssessed: false,
    firstRetrievalKind: null,
    retrievalFailureCount: 0,
    strongSupportEmitted: false,
    retrievalRepairEmitted: false,
  },
};

assert.deepEqual(
  decideSensaSemanticPolicy({
    ...reviewContext,
    encounterKind: "introduction",
    capabilities: {
      ...reviewContext.capabilities,
      groundingPrimitive: "visual_grounding",
    },
  }),
  {
    decisionCode: "introduction_grounding",
    actionKind: "grounding_bind",
    targetDimension: "grounding",
    primitive: "visual_grounding",
    scaffoldLevel: "full",
    rendererKind: "content",
    capabilityCode: "grounding_experience",
    contextNoveltyStrategy: "not_applicable",
  },
);

assert.equal(
  decideSensaSemanticPolicy({
    ...reviewContext,
    capabilities: {
      ...reviewContext.capabilities,
      availableCapabilityCodes: [
        ...reviewContext.capabilities.availableCapabilityCodes,
        "boundary_contrast",
      ],
      boundaryPrimitives: ["counterexample"],
    },
  }).decisionCode,
  "boundary_gap",
);

assert.equal(
  decideSensaSemanticPolicy(reviewContext).decisionCode,
  "retrieval_first_meaning_to_form",
);

assert.equal(
  decideSensaSemanticPolicy({
    ...reviewContext,
    state: { ...reviewContext.state, groundingLevel: "stable" },
  }).decisionCode,
  "retrieval_first_cloze",
);

assert.deepEqual(
  decideSensaSemanticPolicy({
    ...reviewContext,
    history: {
      ...reviewContext.history,
      firstRetrievalKind: "meaning_to_form_recall",
      retrievalFailureCount: 1,
    },
  }),
  {
    decisionCode: "retrieval_repair",
    actionKind: "retrieval_repair",
    targetDimension: "retrieval",
    primitive: "production_cue",
    scaffoldLevel: "full",
    rendererKind: "content",
    capabilityCode: "retrieval_repair_support",
    contextNoveltyStrategy: "not_applicable",
  },
);

assert.equal(
  decideSensaSemanticPolicy({
    ...reviewContext,
    history: {
      ...reviewContext.history,
      firstRetrievalKind: "meaning_to_form_recall",
      retrievalFailureCount: 1,
      strongSupportEmitted: true,
      retrievalRepairEmitted: true,
    },
  }).scaffoldLevel,
  "reduced",
);

const continuedCloze = decideSensaSemanticPolicy({
  ...reviewContext,
  state: { groundingLevel: "stable", boundaryLevel: "stable" },
  history: {
    ...reviewContext.history,
    boundaryAssessed: true,
    firstRetrievalKind: "cloze_recall",
  },
});
assert.equal(continuedCloze.decisionCode, "retrieval_continue_cloze");
assert.equal(continuedCloze.contextNoveltyStrategy, "use_asset_novelty");

assert.equal(
  decideSensaSemanticPolicy({
    ...reviewContext,
    state: { ...reviewContext.state, groundingLevel: "stable" },
    capabilities: {
      ...reviewContext.capabilities,
      availableCapabilityCodes:
        reviewContext.capabilities.availableCapabilityCodes.filter(
          (code) => code !== "cloze_context",
        ),
    },
  }).decisionCode,
  "retrieval_first_meaning_to_form",
);

assert.throws(
  () => decideSensaSemanticPolicy({
    ...reviewContext,
    capabilities: {
      ...reviewContext.capabilities,
      availableCapabilityCodes: [
        ...reviewContext.capabilities.availableCapabilityCodes,
        "boundary_contrast",
      ],
    },
  }),
  /Boundary capability/,
);

assert.throws(
  () => decideSensaSemanticPolicy({
    ...reviewContext,
    history: { ...reviewContext.history, retrievalFailureCount: -1 },
  }),
  /retrievalFailureCount/,
);

console.log("Sensa Semantic Policy decision smoke passed");
