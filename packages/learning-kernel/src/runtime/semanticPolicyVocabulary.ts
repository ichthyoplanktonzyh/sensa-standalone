export const sensaSemanticPolicyDecisionCodes = Object.freeze([
  "introduction_grounding",
  "boundary_gap",
  "retrieval_repair",
  "retrieval_first_meaning_to_form",
  "retrieval_first_cloze",
  "retrieval_continue_meaning_to_form",
  "retrieval_continue_cloze",
] as const);

export type SensaSemanticPolicyDecisionCode =
  typeof sensaSemanticPolicyDecisionCodes[number];

const decisionCodeSet = new Set<string>(sensaSemanticPolicyDecisionCodes);

export function isSensaSemanticPolicyDecisionCode(
  value: string,
): value is SensaSemanticPolicyDecisionCode {
  return decisionCodeSet.has(value);
}
