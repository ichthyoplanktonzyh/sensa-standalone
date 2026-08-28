import type {
  SensaAcquisitionPrimitive,
  SensaMasteryDimension,
  SensaRendererKind,
  SensaScaffoldLevel,
  SensaSemanticDimensionSnapshot,
} from "./browserSafe.js";
import type { SensaExecutableLearningCapabilityCode } from "./executableLearningCapabilities.js";
import type { SensaSemanticPolicyDecisionCode } from "./semanticPolicyVocabulary.js";

export type SensaSemanticPolicyActionKind =
  | "grounding_bind"
  | "boundary_discrimination"
  | "meaning_to_form_recall"
  | "cloze_recall"
  | "retrieval_repair";

export type SensaSemanticPolicyContext = Readonly<{
  encounterKind: "introduction" | "review";
  state: Readonly<{
    groundingLevel: SensaSemanticDimensionSnapshot["level"];
    boundaryLevel: SensaSemanticDimensionSnapshot["level"];
  }>;
  capabilities: Readonly<{
    availableCapabilityCodes: readonly SensaExecutableLearningCapabilityCode[];
    groundingPrimitive: SensaAcquisitionPrimitive;
    boundaryPrimitives: readonly ("contrast_pair" | "counterexample")[];
  }>;
  history: Readonly<{
    boundaryAssessed: boolean;
    firstRetrievalKind: "meaning_to_form_recall" | "cloze_recall" | null;
    retrievalFailureCount: number;
    strongSupportEmitted: boolean;
    retrievalRepairEmitted: boolean;
  }>;
}>;

export type SensaSemanticPolicyDecision = Readonly<{
  decisionCode: SensaSemanticPolicyDecisionCode;
  actionKind: SensaSemanticPolicyActionKind;
  targetDimension: SensaMasteryDimension;
  primitive: SensaAcquisitionPrimitive;
  scaffoldLevel: SensaScaffoldLevel;
  rendererKind: SensaRendererKind;
  capabilityCode: SensaExecutableLearningCapabilityCode;
  contextNoveltyStrategy: "not_applicable" | "force_familiar" | "use_asset_novelty";
}>;

export interface SensaSemanticPolicyModule {
  decide(context: SensaSemanticPolicyContext): SensaSemanticPolicyDecision;
}

function retrievalDecision(
  context: SensaSemanticPolicyContext,
): SensaSemanticPolicyDecision {
  const available = new Set(context.capabilities.availableCapabilityCodes);
  if (
    context.history.retrievalFailureCount === 1 &&
    !context.history.retrievalRepairEmitted &&
    available.has("retrieval_repair_support")
  ) {
    return Object.freeze({
      decisionCode: "retrieval_repair",
      actionKind: "retrieval_repair",
      targetDimension: "retrieval",
      primitive: "production_cue",
      scaffoldLevel: "full",
      rendererKind: "content",
      capabilityCode: "retrieval_repair_support",
      contextNoveltyStrategy: "not_applicable",
    });
  }

  const firstRetrievalKind = context.history.firstRetrievalKind;
  const preferredFirstKind = context.state.groundingLevel === "stable"
    ? "cloze_recall"
    : "meaning_to_form_recall";
  const capabilityAvailable = (
    actionKind: "meaning_to_form_recall" | "cloze_recall",
  ): boolean => actionKind === "meaning_to_form_recall"
    ? available.has("meaning_to_form_cue")
    : available.has("cloze_context");
  let actionKind = firstRetrievalKind;
  if (actionKind === null) {
    if (capabilityAvailable(preferredFirstKind)) {
      actionKind = preferredFirstKind;
    } else {
      const fallbackKind = preferredFirstKind === "cloze_recall"
        ? "meaning_to_form_recall"
        : "cloze_recall";
      if (!capabilityAvailable(fallbackKind)) {
        throw new Error("No executable retrieval capability is available");
      }
      actionKind = fallbackKind;
    }
  } else if (!capabilityAvailable(actionKind)) {
    throw new Error("The Encounter's first retrieval capability is no longer executable");
  }
  const scaffoldLevel =
    context.history.retrievalFailureCount > 0 ||
      context.history.strongSupportEmitted
      ? "reduced"
      : "none";
  const first = firstRetrievalKind === null;

  if (actionKind === "meaning_to_form_recall") {
    return Object.freeze({
      decisionCode: first
        ? "retrieval_first_meaning_to_form"
        : "retrieval_continue_meaning_to_form",
      actionKind,
      targetDimension: "retrieval",
      primitive: "production_cue",
      scaffoldLevel,
      rendererKind: "text_input",
      capabilityCode: "meaning_to_form_cue",
      contextNoveltyStrategy: "not_applicable",
    });
  }

  return Object.freeze({
    decisionCode: first
      ? "retrieval_first_cloze"
      : "retrieval_continue_cloze",
    actionKind,
    targetDimension: "retrieval",
    primitive: "contextual_variation",
    scaffoldLevel,
    rendererKind: "text_input",
    capabilityCode: "cloze_context",
    contextNoveltyStrategy:
      context.history.retrievalFailureCount > 0 ||
        context.history.strongSupportEmitted
        ? "force_familiar"
        : "use_asset_novelty",
  });
}

export function decideSensaSemanticPolicy(
  context: SensaSemanticPolicyContext,
): SensaSemanticPolicyDecision {
  if (
    !Number.isSafeInteger(context.history.retrievalFailureCount) ||
    context.history.retrievalFailureCount < 0
  ) {
    throw new Error("retrievalFailureCount must be a non-negative safe integer");
  }

  const available = new Set(context.capabilities.availableCapabilityCodes);
  if (!available.has("grounding_experience")) {
    throw new Error("The Package has no executable grounding capability");
  }
  if (
    available.has("boundary_contrast")
    !== (context.capabilities.boundaryPrimitives.length > 0)
  ) {
    throw new Error("Boundary capability and primitive inventory are inconsistent");
  }

  if (context.encounterKind === "introduction") {
    return Object.freeze({
      decisionCode: "introduction_grounding",
      actionKind: "grounding_bind",
      targetDimension: "grounding",
      primitive: context.capabilities.groundingPrimitive,
      scaffoldLevel: "full",
      rendererKind: "content",
      capabilityCode: "grounding_experience",
      contextNoveltyStrategy: "not_applicable",
    });
  }

  if (
    context.state.boundaryLevel !== "stable" &&
    !context.history.boundaryAssessed &&
    available.has("boundary_contrast")
  ) {
    return Object.freeze({
      decisionCode: "boundary_gap",
      actionKind: "boundary_discrimination",
      targetDimension: "boundary",
      primitive: context.capabilities.boundaryPrimitives[0]!,
      scaffoldLevel: "none",
      rendererKind: "single_choice",
      capabilityCode: "boundary_contrast",
      contextNoveltyStrategy: "not_applicable",
    });
  }

  return retrievalDecision(context);
}

export const sensaSemanticPolicyModule: SensaSemanticPolicyModule =
  Object.freeze({ decide: decideSensaSemanticPolicy });

export function semanticPolicyDecisionMatchesActionKind(
  decisionCode: SensaSemanticPolicyDecisionCode,
  actionKind: SensaSemanticPolicyActionKind,
): boolean {
  switch (decisionCode) {
    case "introduction_grounding":
      return actionKind === "grounding_bind";
    case "boundary_gap":
      return actionKind === "boundary_discrimination";
    case "retrieval_repair":
      return actionKind === "retrieval_repair";
    case "retrieval_first_meaning_to_form":
    case "retrieval_continue_meaning_to_form":
      return actionKind === "meaning_to_form_recall";
    case "retrieval_first_cloze":
    case "retrieval_continue_cloze":
      return actionKind === "cloze_recall";
  }
}
