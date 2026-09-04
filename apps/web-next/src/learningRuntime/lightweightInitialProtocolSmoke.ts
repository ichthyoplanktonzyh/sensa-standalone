import type { ReactElement } from 'react';
import { ExperienceRecallCard } from '../components/cards/lightweight/ExperienceRecallCard';
import { ExpressionRevealCard } from '../components/cards/lightweight/ExpressionRevealCard';
import {
  PROTOTYPE_LEARNING_TARGETS,
  defaultRetentionTargetIdFor,
} from '../learningJourney/prototypeLearning';
import {
  LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION,
  LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION,
  assembleLightweightInitialPresentation,
  validateLightweightInitialPresentationContracts,
} from './lightweightInitialPresentation';
import {
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP,
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  LIGHTWEIGHT_EXPRESSION_REVEAL_STEP,
  LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND,
  LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS,
  createLightweightInitialProtocolRun,
  currentLightweightInitialStep,
  transitionLightweightInitialProtocol,
  validateLightweightInitialProtocol,
} from './lightweightInitialProtocol';
import { learningPolicyProfileRegistry } from './policyProfiles';
import {
  stepRendererRegistry,
  type LightweightInitialStepRendererProps,
} from './stepRenderers';

const failures: string[] = [];
let checks = 0;
const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};
const checkThrows = (label: string, run: () => void): void => {
  checks += 1;
  try {
    run();
    failures.push(label);
  } catch {
    // expected fail-closed behavior
  }
};

validateLightweightInitialProtocol();
validateLightweightInitialPresentationContracts();

check('轻量首学只有两个正式 Step', LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS.length === 2);
check('Experience Recall 是不取证的 practice',
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP.intent === 'practice'
  && !LIGHTWEIGHT_EXPERIENCE_RECALL_STEP.resultEligibility.evidence);
check('Expression Reveal 是不取证的 instruction',
  LIGHTWEIGHT_EXPRESSION_REVEAL_STEP.intent === 'instruction'
  && !LIGHTWEIGHT_EXPRESSION_REVEAL_STEP.resultEligibility.evidence
  && !LIGHTWEIGHT_EXPRESSION_REVEAL_STEP.resultEligibility.memoryOutcome);
check('Profile 固定到两卡协议版本',
  learningPolicyProfileRegistry.get('lightweight').protocols.initial_learning.protocolVersion === 'v2');
check('Experience Recall 的 Slot 不接收 target expression',
  LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION.slots.every((slot) =>
    !slot.acceptedMaterialRoleKeys.includes('target_expression')));
check('Reveal 的 expression 与 Sense Slot 都是必要区域',
  LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION.slots
    .filter((slot) => slot.required)
    .map((slot) => slot.slotId)
    .join('|') === 'expression_primary|sense_confirmation');

const target = PROTOTYPE_LEARNING_TARGETS['borrow-receive'];
const retentionTargetId = defaultRetentionTargetIdFor(target);
let state = createLightweightInitialProtocolRun({
  protocolRunId: 'smoke:lightweight-initial:1',
  retentionTargetId,
});
let step = currentLightweightInitialStep(state)!;
check('运行从 Experience Recall Step 开始',
  step.definition.stepKind === LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND
  && step.ordinal === 1);

const recallPresentation = assembleLightweightInitialPresentation(step, target);
check('经验卡装配结果没有来源或阶段字段',
  recallPresentation.kind === 'experience_recall'
  && !('source' in recallPresentation)
  && !('stage' in recallPresentation));
check('经验卡装配结果没有泄露目标 Expression',
  !JSON.stringify(recallPresentation).toLocaleLowerCase().includes(target.expression.toLocaleLowerCase()));

const recallElement = stepRendererRegistry
  .get<LightweightInitialStepRendererProps>(step.definition.stepKind)({
    step,
    presentation: recallPresentation,
    onReveal: () => {},
    onRate: () => {},
  }) as ReactElement;
check('Experience Recall 通过统一 renderer registry 选卡',
  recallElement.type === ExperienceRecallCard);

const revealed = transitionLightweightInitialProtocol(state, 'reveal_requested');
state = revealed.state;
step = currentLightweightInitialStep(state)!;
check('请求揭晓产生 practice Observation 并推进到 Reveal',
  revealed.completedStep.observation.kind === 'practice_completed'
  && revealed.completedStep.transitionDecision.effects.some((effect) => effect.kind === 'advance')
  && step.definition.stepKind === LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND
  && !state.progress.completed);

const revealPresentation = assembleLightweightInitialPresentation(step, target);
const revealElement = stepRendererRegistry
  .get<LightweightInitialStepRendererProps>(step.definition.stepKind)({
    step,
    presentation: revealPresentation,
    onReveal: () => {},
    onRate: () => {},
  }) as ReactElement;
check('Expression Reveal 通过统一 renderer registry 选卡',
  revealElement.type === ExpressionRevealCard);

const repeated = transitionLightweightInitialProtocol(state, 'again');
state = repeated.state;
step = currentLightweightInitialStep(state)!;
check('Again 回到 Experience Recall 且不完成',
  step.definition.stepKind === LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND
  && state.retryCount === 1
  && !state.progress.completed
  && state.completionRating === null);

state = transitionLightweightInitialProtocol(state, 'reveal_requested').state;
const completed = transitionLightweightInitialProtocol(state, 'hard');
check('Hard 由 completion-only kernel 完成 Run',
  completed.state.progress.completed
  && completed.state.currentStepDefinitionId === null
  && completed.state.completionRating === 'hard'
  && completed.completedStep.transitionDecision.effects.some((effect) => effect.kind === 'complete'));
check('完成状态不是第三个 Step', currentLightweightInitialStep(completed.state) === null);
checkThrows('完成后的 Run 不接受更多结果', () => {
  transitionLightweightInitialProtocol(completed.state, 'good');
});

const fresh = createLightweightInitialProtocolRun({
  protocolRunId: 'smoke:lightweight-initial:2',
  retentionTargetId,
});
checkThrows('Recall Step 不接受 Rating', () => {
  transitionLightweightInitialProtocol(fresh, 'good');
});

const expressionAgnosticTarget = {
  ...target,
  expression: 'Would you mind giving me a moment?',
  expressionTypeLabel: '',
  partOfSpeech: '',
  example: '',
};
const expressionAgnosticState = transitionLightweightInitialProtocol(fresh, 'reveal_requested').state;
const expressionAgnosticStep = currentLightweightInitialStep(expressionAgnosticState)!;
const expressionAgnosticPresentation = assembleLightweightInitialPresentation(
  expressionAgnosticStep,
  expressionAgnosticTarget,
);
check('Reveal 不要求 Expression 是单词，也允许词法与例句 Slot 缺失',
  expressionAgnosticPresentation.kind === 'expression_reveal'
  && expressionAgnosticPresentation.slots.expressionPrimary.surface
    === 'Would you mind giving me a moment?'
  && expressionAgnosticPresentation.slots.languageStructure === null
  && expressionAgnosticPresentation.slots.usageGuidance === null);

const leakingTarget = {
  ...PROTOTYPE_LEARNING_TARGETS['tactful-expression'],
  // Embedded CJK text has no whitespace boundary; disclosure checks must still
  // reject it rather than relying on Latin-style word boundaries.
  expression: '传达真实意见',
};
const leakingRun = createLightweightInitialProtocolRun({
  protocolRunId: 'smoke:lightweight-initial:leak',
  retentionTargetId: defaultRetentionTargetIdFor(leakingTarget),
});
checkThrows('Experience Recall 内容泄露 Expression 时 fail closed', () => {
  assembleLightweightInitialPresentation(currentLightweightInitialStep(leakingRun)!, leakingTarget);
});

if (failures.length > 0) {
  console.error(`lightweight initial protocol smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`lightweight initial protocol smoke OK (${checks} checks)`);
