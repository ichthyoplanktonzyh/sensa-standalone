import type { ReactElement } from 'react';
import { SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND } from '@sensa/contracts/sensa';
import { ExperienceRecallCard } from '../components/cards/lightweight/ExperienceRecallCard';
import { ExpressionRevealCard } from '../components/cards/lightweight/ExpressionRevealCard';
import {
  PROTOTYPE_LEARNING_TARGETS,
  defaultRetentionTargetIdFor,
  lightweightContentInputForTarget,
  lightweightInitialMaterializationForTarget,
} from '../learningJourney/prototypeLearning';
import {
  createLightweightInitialGenerationRequest,
  provisionLightweightInitialContent,
} from './lightweightInitialContent';
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
check('Profile 固定到两卡协议和具体 Content Demand 版本',
  learningPolicyProfileRegistry.get('lightweight').protocols.initial_learning.protocolVersion === 'v2'
  && learningPolicyProfileRegistry.get('lightweight').protocols.initial_learning
    .contentDemands.some((demand) =>
      demand.contentDemandKey === 'lightweight-initial-content'
      && demand.definitionVersion === 'v1'));
check('Experience Recall 的 Slot 不接收 target expression',
  LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION.slots.every((slot) =>
    !slot.acceptedMaterialRoleKeys.includes('target_expression')));
check('Reveal 的 expression 与 Sense Slot 都是必要区域',
  LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION.slots
    .filter((slot) => slot.required)
    .map((slot) => slot.slotId)
    .join('|') === 'expression_primary|sense_confirmation');
check('Lightweight Initial Demand 明确声明三项必要 material role',
  SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles
    .filter((role) => role.required)
    .map((role) => role.materialRoleKey)
    .join('|')
  === 'experience_recall_cue|target_expression|sense_confirmation');

const target = PROTOTYPE_LEARNING_TARGETS['borrow-receive'];
const retentionTargetId = defaultRetentionTargetIdFor(target);
const materialization = lightweightInitialMaterializationForTarget(target);
if (!materialization) throw new Error('Borrow Lightweight Materialization is required by smoke.');
let state = createLightweightInitialProtocolRun({
  protocolRunId: 'smoke:lightweight-initial:1',
  retentionTargetId,
  learningMaterializationId: materialization.snapshot.learningMaterializationId,
  materialResources: materialization.content.resources,
});
let step = currentLightweightInitialStep(state)!;
check('运行从 Experience Recall Step 开始',
  step.definition.stepKind === LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND
  && step.ordinal === 1);

const recallPresentation = assembleLightweightInitialPresentation(step, materialization);
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

const revealPresentation = assembleLightweightInitialPresentation(step, materialization);
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
  learningMaterializationId: materialization.snapshot.learningMaterializationId,
  materialResources: materialization.content.resources,
});
checkThrows('Recall Step 不接受 Rating', () => {
  transitionLightweightInitialProtocol(fresh, 'good');
});

const expressionAgnosticResult = provisionLightweightInitialContent({
  ...lightweightContentInputForTarget(target),
  expression: {
    surface: 'Would you mind giving me a moment?',
    languageTag: 'en',
    expressionKind: 'utterance',
  },
  originExperience: null,
  referenceFacts: [],
});
if (expressionAgnosticResult.status !== 'ready') {
  throw new Error('Expression-agnostic fixture must provision successfully.');
}
const expressionAgnosticMaterialization = expressionAgnosticResult.materialization;
const expressionAgnosticRun = createLightweightInitialProtocolRun({
  protocolRunId: 'smoke:lightweight-initial:utterance',
  retentionTargetId,
  learningMaterializationId:
    expressionAgnosticMaterialization.snapshot.learningMaterializationId,
  materialResources: expressionAgnosticMaterialization.content.resources,
});
const expressionAgnosticState = transitionLightweightInitialProtocol(
  expressionAgnosticRun,
  'reveal_requested',
).state;
const expressionAgnosticStep = currentLightweightInitialStep(expressionAgnosticState)!;
const expressionAgnosticPresentation = assembleLightweightInitialPresentation(
  expressionAgnosticStep,
  expressionAgnosticMaterialization,
);
check('Reveal 不要求 Expression 是单词，也允许词法与例句 Slot 缺失',
  expressionAgnosticPresentation.kind === 'expression_reveal'
  && expressionAgnosticPresentation.slots.expressionPrimary.surface
    === 'Would you mind giving me a moment?'
  && expressionAgnosticPresentation.slots.languageStructure === null
  && expressionAgnosticPresentation.slots.usageGuidance === null
  && expressionAgnosticPresentation.slots.pronunciation === null
  && expressionAgnosticPresentation.slots.sceneBridge === null);

const phraseResult = provisionLightweightInitialContent({
  ...lightweightContentInputForTarget(target),
  expression: {
    surface: 'give me a moment',
    languageTag: 'en',
    expressionKind: 'phrase',
  },
  sense: {
    meaning: '请求对方稍等片刻。',
    familiarLanguageTag: 'zh-CN',
  },
  originExperience: null,
  referenceFacts: [],
});
check('同一 Demand 对词、短语与句子没有不同的必填资源集合',
  phraseResult.status === 'ready'
  && materialization.content.resources.some((resource) =>
    resource.materialRoleKey === 'target_expression')
  && expressionAgnosticMaterialization.content.resources.some((resource) =>
    resource.materialRoleKey === 'target_expression'));

checkThrows('缺少必要角色时不能创建 Protocol Run', () => {
  createLightweightInitialProtocolRun({
    protocolRunId: 'smoke:lightweight-initial:missing-role',
    retentionTargetId,
    learningMaterializationId: materialization.snapshot.learningMaterializationId,
    materialResources: materialization.content.resources.filter((resource) =>
      resource.materialRoleKey !== 'target_expression'),
  });
});

const leakingTarget = {
  ...PROTOTYPE_LEARNING_TARGETS['tactful-expression'],
  // Embedded CJK text has no whitespace boundary; disclosure checks must still
  // reject it rather than relying on Latin-style word boundaries.
  expression: '传达真实意见',
};
const leakingResult = provisionLightweightInitialContent(
  lightweightContentInputForTarget(leakingTarget),
);
check('Experience Recall Candidate 泄露 Expression 时不产生 Materialization',
  leakingResult.status === 'invalid'
  && leakingResult.materialization === null
  && leakingResult.issues.some((issue) => issue.code === 'candidate_rejected'));

const tactfulRequest = createLightweightInitialGenerationRequest(
  lightweightContentInputForTarget(PROTOTYPE_LEARNING_TARGETS['tactful-expression']),
);
check('交给内容 producer 的独立 Request 带 exact Demand 与 Personal Anchor use grant',
  tactfulRequest.demandReference.contentDemandKey === 'lightweight-initial-content'
  && tactfulRequest.contextArtifacts.some((artifact) =>
    artifact.source === 'personal_anchor'
    && artifact.personalAnchorUseGrantId !== null));

const pronunciationResult = provisionLightweightInitialContent({
  ...lightweightContentInputForTarget(target),
  referenceFacts: [{
    source: 'pronunciation_lexicon',
    sourceVersion: 'smoke-pronunciation-v1',
    fact: {
      factKind: 'pronunciation',
      audioUrl: null,
      phoneticNotation: '/ˈbɒrəʊ/',
      accentLabel: 'UK',
    },
  }],
});
const pronunciationResource = pronunciationResult.status === 'ready'
  ? pronunciationResult.materialization.content.resources.find((resource) =>
      resource.materialRoleKey === 'pronunciation')
  : null;
check('发音资源只由 source-bound objective adapter 派生，不伪装成模型输出',
  pronunciationResource?.productionMethod === 'external_tool'
  && pronunciationResource.producerModel === null
  && pronunciationResource.sourceArtifactIds.length === 1
  && pronunciationResource.sourceMaterialCandidateIds.length === 1);

if (failures.length > 0) {
  console.error(`lightweight initial protocol smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`lightweight initial protocol smoke OK (${checks} checks)`);
