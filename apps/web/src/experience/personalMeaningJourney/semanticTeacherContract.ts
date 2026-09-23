import { z } from 'zod';
import type { SemanticAgentTurnInput, SemanticAgentWorkingSet } from './semanticAgent';

const text = z.string().trim().min(1).max(4000);
const expressionType = z.enum(['word', 'phrase', 'construction', 'sentence', 'utterance_strategy']);

/** The model submits a compact candidate; the host supplies route-owned fields. */
export const organizeAnswerSchema = z.object({
  context: text,
  sense: text,
  senseKey: text.max(200),
  scene: text,
  expression: text,
  expressionType,
  relation: z.enum(['realizes', 'approximates', 'evokes']),
  coverage: z.enum(['exact', 'broader', 'narrower', 'overlapping']),
  reason: text,
  changeReason: text.optional(),
}).strict();

export const replyToLearnerSchema = z.object({ text }).strict();
export type OrganizedAnswer = z.infer<typeof organizeAnswerSchema>;

const normalize = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();

/** Reject changes to explicit learner edits and silent replacement of a familiar expression. */
export function parseOrganizedAnswer(raw: unknown, input: SemanticAgentTurnInput): OrganizedAnswer {
  const answer = organizeAnswerSchema.parse(raw);
  const edited = input.learnerEditedTracks;
  if ((edited.includes('context') && input.workingSet.context?.summary !== answer.context)
    || (edited.includes('sense') && input.workingSet.sense?.coreMeaningFocus !== answer.sense)
    || (edited.includes('expression') && (
      input.workingSet.expression?.surfaceForm !== answer.expression
      || input.workingSet.expression?.expressionType !== answer.expressionType
    ))) throw new Error('teacher_learner_edit_changed');
  const familiar = input.material.familiarExpression?.trim();
  if (familiar && normalize(familiar) !== normalize(answer.expression) && !answer.changeReason) {
    throw new Error('teacher_expression_changed_silently');
  }
  return answer;
}

/** Only source-grounded candidate fields become a reviewable working set. */
export function workingSetForAnswer(answer: OrganizedAnswer, input: SemanticAgentTurnInput): SemanticAgentWorkingSet {
  const expression = {
    surfaceForm: answer.expression,
    expressionType: answer.expressionType,
    languageTag: input.languages.targetLanguageTag,
    relation: answer.relation,
    semanticCoverage: answer.coverage,
    rationale: answer.reason,
  };
  return {
    context: { summary: answer.context, salientDetails: [], unresolvedDetails: [], rationale: answer.reason },
    focus: input.workingSet.focus,
    sense: {
      proposedSenseKey: answer.senseKey,
      coreMeaningFocus: answer.sense,
      prototypeScenes: [{ summary: answer.scene, participantRoles: [], states: [], directionOrCausality: null }],
      includedCases: [], excludedCases: [], neighborContrasts: [], openQuestions: [], unresolvedQuestions: [],
      rationale: answer.reason,
    },
    expression,
    expressions: [expression],
  };
}

/** The visible reply must actually announce the staged expression and explain replacements. */
export function parseLearnerReply(raw: unknown, answer: OrganizedAnswer | null, familiarExpression: string | null): string {
  const reply = replyToLearnerSchema.parse(raw).text;
  if (answer && !normalize(reply).includes(normalize(answer.expression))) {
    throw new Error('teacher_reply_omits_expression');
  }
  const familiar = familiarExpression?.trim();
  if (answer && familiar && normalize(familiar) !== normalize(answer.expression)
    && !normalize(reply).includes(normalize(familiar))) {
    throw new Error('teacher_reply_omits_familiar_expression');
  }
  return reply;
}
