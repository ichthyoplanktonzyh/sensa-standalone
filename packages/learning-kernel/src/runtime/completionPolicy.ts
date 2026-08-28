import {
  isRetrievalAction,
  sensaMemoryOutcomeVersion,
  sensaStopPolicyVersion,
  type MemoryOutcomeKind,
  type SensaEncounterCompletionDecisionInput,
} from "./browserSafe.js";

export const sensaStopPolicyDecisionCodes = Object.freeze([
  "attempt_invalid",
  "introduction_grounding_required",
  "review_retrieval_required",
  "retrieval_result_unresolved",
  "retrieval_retry_required",
  "introduction_grounding_accepted",
  "retrieval_failure_limit_reached",
  "retrieval_succeeded",
] as const);

export type SensaStopPolicyDecisionCode =
  typeof sensaStopPolicyDecisionCodes[number];

export type SensaStopPolicyContinueDecisionCode = Extract<
  SensaStopPolicyDecisionCode,
  | "attempt_invalid"
  | "introduction_grounding_required"
  | "review_retrieval_required"
  | "retrieval_result_unresolved"
  | "retrieval_retry_required"
>;

export type SensaStopPolicyCompletionDecisionCode = Extract<
  SensaStopPolicyDecisionCode,
  | "introduction_grounding_accepted"
  | "retrieval_failure_limit_reached"
  | "retrieval_succeeded"
>;

export type SensaStopPolicyDecision =
  | Readonly<{
      disposition: "continue";
      decisionCode: SensaStopPolicyContinueDecisionCode;
    }>
  | Readonly<{
      disposition: "complete";
      decisionCode: SensaStopPolicyCompletionDecisionCode;
    }>;

export const sensaMemoryOutcomeDecisionCodes = Object.freeze([
  "introduced_after_grounding",
  "retrieval_failed_after_failure_limit",
  "supported_retrieval_after_prior_failure",
  "supported_retrieval_after_strong_support",
  "independent_retrieval_without_support",
  "transfer_confirmed_after_novel_cloze",
] as const);

export type SensaMemoryOutcomeDecisionCode =
  typeof sensaMemoryOutcomeDecisionCodes[number];

export type SensaMemoryOutcomeDecision =
  | Readonly<{
      outcomeKind: "introduced";
      decisionCode: "introduced_after_grounding";
    }>
  | Readonly<{
      outcomeKind: "retrieval_failed";
      decisionCode: "retrieval_failed_after_failure_limit";
    }>
  | Readonly<{
      outcomeKind: "supported_retrieval";
      decisionCode:
        | "supported_retrieval_after_prior_failure"
        | "supported_retrieval_after_strong_support";
    }>
  | Readonly<{
      outcomeKind: "independent_retrieval";
      decisionCode: "independent_retrieval_without_support";
    }>
  | Readonly<{
      outcomeKind: "transfer_confirmed";
      decisionCode: "transfer_confirmed_after_novel_cloze";
    }>;

export type SensaEncounterCompletionDecision =
  | Readonly<{
      stopDecision: Extract<SensaStopPolicyDecision, { disposition: "continue" }>;
      memoryOutcomeDecision: null;
    }>
  | Readonly<{
      stopDecision: Extract<SensaStopPolicyDecision, { disposition: "complete" }>;
      memoryOutcomeDecision: SensaMemoryOutcomeDecision;
    }>;

function continueWith(
  decisionCode: SensaStopPolicyContinueDecisionCode,
): SensaEncounterCompletionDecision {
  return {
    stopDecision: { disposition: "continue", decisionCode },
    memoryOutcomeDecision: null,
  };
}

function completeWith(
  decisionCode: SensaStopPolicyCompletionDecisionCode,
  memoryOutcomeDecision: SensaMemoryOutcomeDecision,
): SensaEncounterCompletionDecision {
  return {
    stopDecision: { disposition: "complete", decisionCode },
    memoryOutcomeDecision,
  };
}

/**
 * Decide whether the current Encounter stops and, only when it stops, classify
 * its single Memory Outcome. The pair is returned atomically so callers cannot
 * combine an incompatible Stop Decision and Outcome classification.
 */
export function decideSensaEncounterCompletion(
  input: SensaEncounterCompletionDecisionInput,
): SensaEncounterCompletionDecision {
  const { action, evaluation } = input;
  if (evaluation.validity !== "valid") {
    return continueWith("attempt_invalid");
  }

  if (input.encounterKind === "introduction") {
    return action.payload.kind === "grounding_bind"
      ? completeWith(
          "introduction_grounding_accepted",
          {
            outcomeKind: "introduced",
            decisionCode: "introduced_after_grounding",
          },
        )
      : continueWith("introduction_grounding_required");
  }

  if (!isRetrievalAction(action.payload)) {
    return continueWith("review_retrieval_required");
  }

  const priorFailures = input.priorValidRetrievalCorrectness
    .filter((correct) => correct === false)
    .length;
  if (evaluation.isCorrect === false) {
    return priorFailures + 1 >= 2
      ? completeWith(
          "retrieval_failure_limit_reached",
          {
            outcomeKind: "retrieval_failed",
            decisionCode: "retrieval_failed_after_failure_limit",
          },
        )
      : continueWith("retrieval_retry_required");
  }
  if (evaluation.isCorrect !== true) {
    return continueWith("retrieval_result_unresolved");
  }

  if (priorFailures > 0) {
    return completeWith(
      "retrieval_succeeded",
      {
        outcomeKind: "supported_retrieval",
        decisionCode: "supported_retrieval_after_prior_failure",
      },
    );
  }
  if (input.strongSupportEmitted) {
    return completeWith(
      "retrieval_succeeded",
      {
        outcomeKind: "supported_retrieval",
        decisionCode: "supported_retrieval_after_strong_support",
      },
    );
  }
  if (
    action.payload.kind === "cloze_recall"
    && action.payload.contextNovelty === "novel"
    && action.scaffoldLevel === "none"
    && evaluation.evidence.some((item) => (
      item.dimension === "transfer" && item.polarity === "positive"
    ))
  ) {
    return completeWith(
      "retrieval_succeeded",
      {
        outcomeKind: "transfer_confirmed",
        decisionCode: "transfer_confirmed_after_novel_cloze",
      },
    );
  }
  return completeWith(
    "retrieval_succeeded",
    {
      outcomeKind: "independent_retrieval",
      decisionCode: "independent_retrieval_without_support",
    },
  );
}

export function isSensaStopPolicyDecisionCode(
  value: string,
): value is SensaStopPolicyDecisionCode {
  return (sensaStopPolicyDecisionCodes as readonly string[]).includes(value);
}

export function isSensaStopPolicyCompletionDecisionCode(
  value: string,
): value is SensaStopPolicyCompletionDecisionCode {
  return value === "introduction_grounding_accepted"
    || value === "retrieval_failure_limit_reached"
    || value === "retrieval_succeeded";
}

export function isSensaMemoryOutcomeDecisionCode(
  value: string,
): value is SensaMemoryOutcomeDecisionCode {
  return (sensaMemoryOutcomeDecisionCodes as readonly string[]).includes(value);
}

export function memoryOutcomeDecisionMatchesKind(
  decisionCode: SensaMemoryOutcomeDecisionCode,
  outcomeKind: MemoryOutcomeKind,
): boolean {
  switch (decisionCode) {
    case "introduced_after_grounding":
      return outcomeKind === "introduced";
    case "retrieval_failed_after_failure_limit":
      return outcomeKind === "retrieval_failed";
    case "supported_retrieval_after_prior_failure":
    case "supported_retrieval_after_strong_support":
      return outcomeKind === "supported_retrieval";
    case "independent_retrieval_without_support":
      return outcomeKind === "independent_retrieval";
    case "transfer_confirmed_after_novel_cloze":
      return outcomeKind === "transfer_confirmed";
  }
}

export function stopCompletionDecisionMatchesOutcome(
  decisionCode: SensaStopPolicyCompletionDecisionCode,
  outcomeKind: MemoryOutcomeKind,
): boolean {
  switch (decisionCode) {
    case "introduction_grounding_accepted":
      return outcomeKind === "introduced";
    case "retrieval_failure_limit_reached":
      return outcomeKind === "retrieval_failed";
    case "retrieval_succeeded":
      return outcomeKind === "supported_retrieval"
        || outcomeKind === "independent_retrieval"
        || outcomeKind === "transfer_confirmed";
  }
}

export interface SensaEncounterCompletionPolicyModule {
  readonly stopPolicyVersion: typeof sensaStopPolicyVersion;
  readonly outcomeMappingVersion: typeof sensaMemoryOutcomeVersion;
  decide(
    input: SensaEncounterCompletionDecisionInput,
  ): SensaEncounterCompletionDecision;
}

export const sensaEncounterCompletionPolicyModule:
SensaEncounterCompletionPolicyModule = Object.freeze({
  stopPolicyVersion: sensaStopPolicyVersion,
  outcomeMappingVersion: sensaMemoryOutcomeVersion,
  decide: decideSensaEncounterCompletion,
});
