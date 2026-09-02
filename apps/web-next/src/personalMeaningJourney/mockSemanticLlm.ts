/**
 * Deterministic Semantic LLM adapter.
 *
 * It maps the learner's private material to a fixed scenario and replays
 * reproducible Meaning Focus suggestions, adaptive clarification turns,
 * and a full Sense Proposal. Given the same input it always returns the same
 * business result, so the acceptance scenarios, the smoke and refresh-recovery
 * all stay stable. It proposes only; it never confirms anything.
 */

import type {
  ConstructionTurnContext,
  ConstructionTurnDraft,
  GenerateProposalContext,
  SemanticLlmContext,
  SemanticLlmPort,
  SenseProposalDraft,
  SuggestFocusesResult,
} from './semanticLlm';
import {
  MOCK_PROVENANCE,
  MOCK_SEMANTIC_POLICY_VERSION,
  buildConstructionAcknowledgement,
  matchScenario,
  pickScenarioFocus,
} from './scenarios';

/** Explicit mock limitation surfaced to the UI; never replaced with a fake proposal. */
export class MockScenarioUnavailableError extends Error {
  constructor(reason = '没有匹配的模拟语义场景') {
    super(`当前模拟旅程${reason}，暂时无法提供澄清。请补充已支持的示例材料或稍后重试。`);
    this.name = 'MockScenarioUnavailableError';
  }
}

const materialText = (context: SemanticLlmContext): string =>
  [
    ...context.familiarExpressions.map((expression) => expression.surfaceForm),
    ...context.experienceAnchors.map((anchor) => anchor.bodyText),
    context.learnerIntentNote ?? '',
  ]
    .filter(Boolean)
    .join('\n');

export const createMockSemanticLlm = (): SemanticLlmPort => ({
  label: 'Semantic LLM（模拟）',

  async suggestMeaningFocuses(
    context: SemanticLlmContext,
  ): Promise<SuggestFocusesResult> {
    const scenario = matchScenario(materialText(context));
    if (!scenario) throw new MockScenarioUnavailableError();
    return {
      focuses: scenario.focuses.map((focus) => focus.suggestion),
      multipleAspects: scenario.multipleAspects,
      provenance: MOCK_PROVENANCE,
    };
  },

  async nextConstructionTurn(
    context: ConstructionTurnContext,
  ): Promise<ConstructionTurnDraft> {
    const scenario = matchScenario(materialText(context));
    if (!scenario) throw new MockScenarioUnavailableError();
    const focus = pickScenarioFocus(scenario, context.focusStatement);
    if (!focus) {
      throw new MockScenarioUnavailableError('当前 Focus 与匹配的模拟场景不相符');
    }
    const learnerHasAnswered = context.priorTurns.some(
      (turn) => turn.actor === 'learner',
    );

    const forcedClarification = context.priorTurns.some(
      (turn) => turn.actor === 'system' && turn.body === '继续澄清',
    );

    if (!learnerHasAnswered || forcedClarification) {
      return {
        body: focus.boundaryQuestion,
        boundaryOptions: focus.boundaryOptions,
        readyForProposal: false,
        provenance: MOCK_PROVENANCE,
      };
    }

    return {
      body: buildConstructionAcknowledgement(context),
      boundaryOptions: [],
      readyForProposal: true,
      provenance: MOCK_PROVENANCE,
    };
  },

  async generateSenseProposal(
    context: GenerateProposalContext,
  ): Promise<SenseProposalDraft> {
    const scenario = matchScenario(materialText(context));
    if (!scenario) throw new MockScenarioUnavailableError();
    const focus = pickScenarioFocus(scenario, context.focusStatement);
    if (!focus) {
      throw new MockScenarioUnavailableError('当前 Focus 与匹配的模拟场景不相符');
    }
    return {
      ...focus.proposal,
      semanticPolicyVersion: MOCK_SEMANTIC_POLICY_VERSION,
      provenance: MOCK_PROVENANCE,
    };
  },
});
