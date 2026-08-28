import assert from "node:assert/strict";

import {
  decideSensaEncounterCompletion,
  sensaEncounterCompletionPolicyModule,
  sensaMemoryOutcomeVersion,
  sensaStopPolicyVersion,
  type SensaEncounterCompletionDecisionInput,
} from "@sensa/learning-kernel";

const groundingAction: SensaEncounterCompletionDecisionInput["action"] = {
  payload: {
    kind: "grounding_bind",
    schemaVersion: "sensa-learning-action-v3",
  },
  scaffoldLevel: "full",
};

const meaningToFormAction: SensaEncounterCompletionDecisionInput["action"] = {
  payload: {
    kind: "meaning_to_form_recall",
    schemaVersion: "sensa-learning-action-v3",
    prompt: "produce the form",
  },
  scaffoldLevel: "none",
};

const novelClozeAction: SensaEncounterCompletionDecisionInput["action"] = {
  payload: {
    kind: "cloze_recall",
    schemaVersion: "sensa-learning-action-v3",
    exampleAssetId: "00000000-0000-4000-8000-000000000001",
    maskedText: "A novel ___ context.",
    contextNovelty: "novel",
  },
  scaffoldLevel: "none",
};

function input(
  overrides: Partial<SensaEncounterCompletionDecisionInput> = {},
): SensaEncounterCompletionDecisionInput {
  return {
    encounterKind: "review",
    action: meaningToFormAction,
    evaluation: {
      validity: "valid",
      isCorrect: true,
      evidence: [],
    },
    priorValidRetrievalCorrectness: [],
    strongSupportEmitted: false,
    ...overrides,
  };
}

assert.deepEqual(
  decideSensaEncounterCompletion(input({
    evaluation: { validity: "invalid", isCorrect: null, evidence: [] },
  })),
  {
    stopDecision: { disposition: "continue", decisionCode: "attempt_invalid" },
    memoryOutcomeDecision: null,
  },
);

assert.equal(
  decideSensaEncounterCompletion(input({ encounterKind: "introduction" }))
    .stopDecision.decisionCode,
  "introduction_grounding_required",
);

assert.deepEqual(
  decideSensaEncounterCompletion(input({
    encounterKind: "introduction",
    action: groundingAction,
  })),
  {
    stopDecision: {
      disposition: "complete",
      decisionCode: "introduction_grounding_accepted",
    },
    memoryOutcomeDecision: {
      outcomeKind: "introduced",
      decisionCode: "introduced_after_grounding",
    },
  },
);

assert.equal(
  decideSensaEncounterCompletion(input({ action: groundingAction }))
    .stopDecision.decisionCode,
  "review_retrieval_required",
);

assert.equal(
  decideSensaEncounterCompletion(input({
    evaluation: { validity: "valid", isCorrect: null, evidence: [] },
  })).stopDecision.decisionCode,
  "retrieval_result_unresolved",
);

assert.equal(
  decideSensaEncounterCompletion(input({
    evaluation: { validity: "valid", isCorrect: false, evidence: [] },
  })).stopDecision.decisionCode,
  "retrieval_retry_required",
);

assert.deepEqual(
  decideSensaEncounterCompletion(input({
    evaluation: { validity: "valid", isCorrect: false, evidence: [] },
    priorValidRetrievalCorrectness: [false],
  })),
  {
    stopDecision: {
      disposition: "complete",
      decisionCode: "retrieval_failure_limit_reached",
    },
    memoryOutcomeDecision: {
      outcomeKind: "retrieval_failed",
      decisionCode: "retrieval_failed_after_failure_limit",
    },
  },
);

assert.equal(
  decideSensaEncounterCompletion(input({
    priorValidRetrievalCorrectness: [false],
    strongSupportEmitted: true,
  })).memoryOutcomeDecision?.decisionCode,
  "supported_retrieval_after_prior_failure",
);

assert.equal(
  decideSensaEncounterCompletion(input({ strongSupportEmitted: true }))
    .memoryOutcomeDecision?.decisionCode,
  "supported_retrieval_after_strong_support",
);

assert.equal(
  decideSensaEncounterCompletion(input({
    action: novelClozeAction,
    evaluation: {
      validity: "valid",
      isCorrect: true,
      evidence: [{
        dimension: "transfer",
        polarity: "positive",
        contextNovelty: "novel",
        basisCode: "novel_cloze_exact_match",
      }],
    },
  })).memoryOutcomeDecision?.decisionCode,
  "transfer_confirmed_after_novel_cloze",
);

assert.equal(
  decideSensaEncounterCompletion(input()).memoryOutcomeDecision?.decisionCode,
  "independent_retrieval_without_support",
);

assert.equal(
  sensaEncounterCompletionPolicyModule.stopPolicyVersion,
  sensaStopPolicyVersion,
);
assert.equal(
  sensaEncounterCompletionPolicyModule.outcomeMappingVersion,
  sensaMemoryOutcomeVersion,
);

console.log("Sensa completion policy smoke passed.");
