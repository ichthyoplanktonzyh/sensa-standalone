/**
 * Deterministic smoke for Step renderer 注册表。
 *
 * 这里钉的是 `stepKind → 组件` 这条 seam 的三件事：
 *
 *  1. **闭合发生在注册表。** Structured 既有七种与 Lightweight Initial
 *     两种全部登记；查不到直接抛，不静默渲染
 *     空白；编排能盖出的每一种章（真实目录动作 × 四套编排过 `stepKindFor`）
 *     都有卡可查。
 *  2. **查表与落地前的七个分支等价。** LearnScreen 落地前的分支守卫逐字搬来
 *     当基准，对每种 stepKind × 输入组合（内容/评测材料/结算结果/修复内容的
 *     有无）核对"旧分支会渲染哪张卡"与"注册表查出什么"一致。复习步的
 *     kind/spec/resource 三者在落地前的 memo 里同进同退，网格因此把它们
 *     绑成一组，不制造 memo 产不出来的状态。
 *  3. **宿主接线没有走样。** 适配函数把统一的 host 合同接线成各卡自己的
 *     props——签名差异（讲解卡带 sentenceIndex、评测卡固定 (0, 0)）、默认参
 *     （讲解卡字典落回 curWord）与 remount key 的格式都在这里钉住。
 *
 * 卡片组件本身零改动，它们的渲染行为由既有的 `smoke:flow` 与
 * `sensa:runtime-learning-smoke` 覆盖；这里只钉"选卡与接线"这一层。
 *
 * Run with `npm run smoke:renderers`.
 */
import type { ReactElement } from 'react';
import {
  PROTOTYPE_LEARNING_PACKAGES,
  toWordPresentation,
  type PrototypeIntroductionPackage,
} from '../content/learningCatalog';
import {
  assessmentKindForCapability,
  materializeAssessmentResource,
  type AssessmentResource,
} from '../content/assessmentResources';
import { buildPrototypeReviewAssessment } from '../content/prototypeReviewCards';
import {
  acquisitionOrchestration,
  retentionOrchestration,
} from '../engine/stepOrchestration';
import type {
  BuiltinLearningStepKind,
  LearningCapability,
  RepairResourceReference,
  ScheduledActionDefinition,
} from '../engine/types';
import { IntroductionCard } from '../components/cards/IntroductionCard';
import { RecognitionCard } from '../components/cards/RecognitionCard';
import { RecallCard } from '../components/cards/RecallCard';
import { NovelTransferCard } from '../components/cards/NovelTransferCard';
import { SensaReviewAssessmentCard } from '../components/cards/review/SensaReviewAssessmentCard';
import { SensaReviewFeedbackCard } from '../components/cards/review/SensaReviewFeedbackCard';
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
  ReviewAssessmentSpec,
} from '../review/types';
import { lookupDictionaryEntry } from '../services/quickDict';
import type { Word, QuickDictEntry } from '../types';
import {
  BUILTIN_STEP_RENDERERS,
  StepRendererRegistry,
  stepRendererRegistry,
  type StepRendererHost,
  type StepRendererProps,
} from './stepRenderers';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const ALL_STAGES: readonly BuiltinLearningStepKind[] = [
  'introduction',
  'recognition',
  'recall',
  'transfer',
  'review_assessment',
  'review_feedback',
  'review_repair',
];

const ORDINAL = 3;

/* ============================================================
   材料：全部取自真实安装目录
   ============================================================ */

type PrototypePackage = (typeof PROTOTYPE_LEARNING_PACKAGES)[number];

interface FoundAction {
  readonly pkg: PrototypePackage;
  readonly action: ScheduledActionDefinition;
}

const findAction = (
  capability: LearningCapability,
  source: 'actions' | 'reviewActions',
): FoundAction | null => {
  for (const pkg of PROTOTYPE_LEARNING_PACKAGES) {
    const pool = source === 'actions' ? pkg.actions : pkg.reviewActions;
    const action = pool.find((candidate) =>
      candidate.capability === capability && candidate.taskKey);
    if (action) return { pkg, action };
  }
  return null;
};

const contextAction = findAction('contextual_recognition', 'actions');
const recallAction = findAction('meaning_to_form_recall', 'actions');
const transferAction = findAction('novel_context_transfer', 'actions');
const boundaryReviewAction = findAction('boundary_discrimination', 'reviewActions');

check('目录里三条学习能力的动作齐备（前置）',
  !!contextAction && !!recallAction && !!transferAction);
check('目录里有 boundary 复习任务（前置）', !!boundaryReviewAction);

const resourceOf = (found: FoundAction): AssessmentResource =>
  materializeAssessmentResource({
    packageIdentity: {
      packageKey: found.pkg.packageId,
      senseKey: found.pkg.senseId,
    },
    content: found.pkg.content,
    taskKey: found.action.taskKey,
    kind: assessmentKindForCapability(found.action.capability!),
  });

const contextResource = contextAction ? resourceOf(contextAction) : null;
const recallResource = recallAction ? resourceOf(recallAction) : null;
const transferResource = transferAction ? resourceOf(transferAction) : null;

/** 复习材料组：kind/spec/resource 在落地前的 memo 里同进同退。 */
interface ReviewMaterials {
  readonly kind: ReviewAssessmentKind;
  readonly spec: ReviewAssessmentSpec;
  readonly resource: AssessmentResource;
}

const reviewMaterialsOf = (found: FoundAction): ReviewMaterials => {
  const kind = assessmentKindForCapability(found.action.capability!);
  return {
    kind,
    spec: buildPrototypeReviewAssessment(found.pkg.content, kind, found.action.taskKey),
    resource: resourceOf(found),
  };
};

const contextReview = contextAction ? reviewMaterialsOf(contextAction) : null;
const boundaryReview = boundaryReviewAction ? reviewMaterialsOf(boundaryReviewAction) : null;

const feedbackResult = (kind: ReviewAssessmentKind): ReviewAssessmentResult => ({
  assessmentId: 'smoke-assessment',
  kind,
  focusDimension: '语境辨义',
  correct: true,
  responseId: null,
  memoryOutcome: {
    basis: 'independent_retrieval',
    grade: 'good',
    evidenceLevel: 'behavioral',
    evidenceIds: [],
  },
  evidenceEligible: true,
});

const baseContent: PrototypeIntroductionPackage = PROTOTYPE_LEARNING_PACKAGES[0].content;
const curWord: Word = toWordPresentation(baseContent);

const REPAIR_REF: RepairResourceReference = {
  role: 'experience_recap',
  key: 'smoke-recap',
  source: 'package_declared',
};

/* ============================================================
   宿主接线：记录式 host
   ============================================================ */

const describeWord = (word: Word | QuickDictEntry | string): string =>
  typeof word === 'string' ? word : ((word as Word).w ?? String(word));

const calls: string[] = [];
const recordingHost: StepRendererHost = {
  toast: (message) => calls.push(`toast:${message}`),
  openExample: (senseIdx, sentenceIdx) => calls.push(`example:${senseIdx}:${sentenceIdx ?? 0}`),
  openDict: (word, tab) => calls.push(`dict:${describeWord(word)}:${tab ?? ''}`),
  openNoteEditor: (word, senseId) => calls.push(`note:${describeWord(word)}:${senseId ?? ''}`),
  openSceneEditor: (content, anchorId) =>
    calls.push(`scene:${content.senseKey}:${anchorId ?? ''}`),
  lookupDictionary: lookupDictionaryEntry,
  completeIntroduction: () => calls.push('complete:introduction'),
  completeRecognition: (correct) => calls.push(`complete:recognition:${correct}`),
  completeMeaningToFormRecall: (outcome) => calls.push(`complete:recall:${outcome}`),
  completeNovelTransfer: (outcome) => calls.push(`complete:transfer:${outcome}`),
  completeReviewAssessment: (result) => calls.push(`complete:review:${result.assessmentId}`),
  continueReviewFeedback: () => calls.push('continue:feedback'),
};

/* ============================================================
   A. 闭合
   ============================================================ */

check('Structured 七种与 Lightweight Initial 两种 stepKind 全部登记',
  new Set(BUILTIN_STEP_RENDERERS.map((definition) => definition.stepKind)).size === 9
    && [
      ...ALL_STAGES,
      'lightweight_experience_recall',
      'lightweight_expression_reveal',
    ].every((stage) =>
      BUILTIN_STEP_RENDERERS.some((definition) => definition.stepKind === stage)));

check('未登记的 stepKind 直接抛，不静默渲染空白', (() => {
  try {
    stepRendererRegistry.get('spelling_production' as never);
    return false;
  } catch { return true; }
})());

check('空注册表也直接抛', (() => {
  try {
    new StepRendererRegistry([]).get('introduction');
    return false;
  } catch { return true; }
})());

check('重复登记直接抛', (() => {
  try {
    new StepRendererRegistry([
      { stepKind: 'introduction', render: () => null },
      { stepKind: 'introduction', render: () => null },
    ]);
    return false;
  } catch { return true; }
})());

/** 编排盖得出的每一种章都有卡可查——含讲解步、四条能力与修复步。 */
const QUEUE_ORCHESTRATIONS = [
  acquisitionOrchestration,
  retentionOrchestration,
] as const;
const CAPABILITIES: readonly LearningCapability[] = [
  'contextual_recognition',
  'meaning_to_form_recall',
  'novel_context_transfer',
  'boundary_discrimination',
];
const stampedKinds = new Set<string>();
for (const orchestration of QUEUE_ORCHESTRATIONS) {
  for (const pkg of PROTOTYPE_LEARNING_PACKAGES) {
    for (const action of [...pkg.actions, ...pkg.reviewActions]) {
      stampedKinds.add(orchestration.stepKindFor(action));
    }
  }
  for (const capability of CAPABILITIES) {
    stampedKinds.add(orchestration.stepKindFor({
      actionKey: 'smoke-repair',
      capability,
      taskKey: null,
      kind: 'acquisition_gate',
      intent: 'repair',
    }));
  }
}
check('两套队列编排对真实目录能盖出的每一种章都已登记',
  [...stampedKinds].every((kind) => {
    try {
      return stepRendererRegistry.get(kind as never) !== undefined;
    } catch { return false; }
  }));

/* ============================================================
   B. 查表与落地前的七个分支等价
   ============================================================ */

interface RendererInputs {
  readonly content: PrototypeIntroductionPackage | null;
  readonly repairContent: PrototypeIntroductionPackage | null;
  readonly assessmentResource: AssessmentResource | null;
  readonly review: ReviewMaterials | null;
  readonly result: ReviewAssessmentResult | null;
}

/**
 * 卡片组件的身份。只用于相等比较，props 形状在这里无关——参数位用 never
 * 让任何具体组件类型都可赋值（协变/逆变规则下 never 可赋给一切参数类型）。
 */
type CardComponent = (props: never) => ReactElement | null;

/** 落地前 LearnScreen 视口里的七个分支守卫，逐字搬来当基准。 */
const oldBranchCard = (
  stage: BuiltinLearningStepKind,
  i: RendererInputs,
): CardComponent | null => {
  const isIntroduction = stage === 'introduction' && !!i.content;
  const isRepair = stage === 'review_repair' && !!i.repairContent;
  const isRecognition = stage === 'recognition' && !!i.content;
  const isMeaningToFormRecall = stage === 'recall' && !!i.content;
  const isNovelTransfer = stage === 'transfer' && !!i.content;
  const isReviewAssessment = stage === 'review_assessment' && !!i.content && !!i.review?.kind;
  const isReviewFeedback = stage === 'review_feedback'
    && !!i.content
    && !!i.review?.kind
    && !!i.result;
  if (isIntroduction) return IntroductionCard;
  if (isRepair) return IntroductionCard;
  if (isRecognition && i.assessmentResource?.kind === 'context_recognition') return RecognitionCard;
  if (isMeaningToFormRecall && i.assessmentResource?.kind === 'meaning_to_form_recall') {
    return RecallCard;
  }
  if (isNovelTransfer && i.assessmentResource?.kind === 'novel_context_transfer') {
    return NovelTransferCard;
  }
  if (isReviewAssessment && i.review?.spec) return SensaReviewAssessmentCard;
  if (isReviewFeedback && i.review?.spec && i.result) return SensaReviewFeedbackCard;
  return null;
};

/**
 * 组装渲染输入。复习步喂复习材料组、学习步喂学习材料，与 LearnScreen
 * 落地前的 memo 同构——resource 的 kind 由步的种类决定，网格不制造
 * memo 产不出来的组合。
 */
const propsFor = (stage: BuiltinLearningStepKind, i: RendererInputs): StepRendererProps => ({
  stepKind: stage,
  ordinal: ORDINAL,
  curWord,
  content: i.content,
  repairContent: i.repairContent,
  repairResourceRef: REPAIR_REF,
  phase: 'reveal',
  onPhaseChange: () => calls.push('phase-change'),
  assessmentResource: stage === 'review_assessment' || stage === 'review_feedback'
    ? i.review?.resource ?? null
    : i.assessmentResource,
  reviewSpec: i.review?.spec ?? null,
  reviewAssessmentResult: i.result,
  purpose: 'retention',
  onCardViewChange: () => calls.push('view-change'),
  host: recordingHost,
});

const newBranchCard = (
  stage: BuiltinLearningStepKind,
  i: RendererInputs,
): CardComponent | null => {
  const element = stepRendererRegistry.get(stage)(propsFor(stage, i)) as ReactElement | null;
  return element ? (element.type as CardComponent) : null;
};

const GRID_CONTENTS: readonly (PrototypeIntroductionPackage | null)[] = [baseContent, null];
const GRID_REPAIRS: readonly (PrototypeIntroductionPackage | null)[] = [baseContent, null];
const GRID_RESOURCES: readonly (AssessmentResource | null)[] = [
  contextResource,
  recallResource,
  transferResource,
  null,
];
const GRID_REVIEWS: readonly (ReviewMaterials | null)[] = [contextReview, null];
const GRID_RESULTS: readonly (ReviewAssessmentResult | null)[] = [
  feedbackResult('context_recognition'),
  null,
];

for (const stage of ALL_STAGES) {
  let mismatch: string | null = null;
  for (const content of GRID_CONTENTS) {
    for (const repairContent of GRID_REPAIRS) {
      for (const assessmentResource of GRID_RESOURCES) {
        for (const review of GRID_REVIEWS) {
          for (const result of GRID_RESULTS) {
            const inputs: RendererInputs = {
              content,
              repairContent,
              assessmentResource,
              review,
              result,
            };
            const oldCard = oldBranchCard(stage, inputs);
            const newCard = newBranchCard(stage, inputs);
            if (oldCard !== newCard) {
              mismatch = `旧=${oldCard?.name ?? 'null'} 新=${newCard?.name ?? 'null'}`;
            }
          }
        }
      }
    }
  }
  check(`查表与落地前分支一致：${stage}${mismatch ? `（${mismatch}）` : ''}`, !mismatch);
}

/* ============================================================
   C. 选卡与 remount key 的格式
   ============================================================ */

const elementFor = (stage: BuiltinLearningStepKind, i: RendererInputs): ReactElement =>
  stepRendererRegistry.get(stage)(propsFor(stage, i)) as ReactElement;

const fullInputs = (review: ReviewMaterials | null): RendererInputs => ({
  content: baseContent,
  repairContent: baseContent,
  assessmentResource: contextResource,
  review,
  result: feedbackResult(review?.kind ?? 'context_recognition'),
});

check('introduction 渲染讲解卡，不带 key',
  (() => {
    const element = elementFor('introduction', fullInputs(null));
    return element.type === IntroductionCard && element.key === null;
  })());

check('recognition 渲染识别卡，key 沿用落地前格式',
  (() => {
    const element = elementFor('recognition', fullInputs(null));
    return element.type === RecognitionCard
      && element.key === `${baseContent.senseKey}:${contextResource!.taskKey}:${ORDINAL}`;
  })());

check('recall 渲染回想卡，key 沿用落地前格式',
  (() => {
    const inputs: RendererInputs = { ...fullInputs(null), assessmentResource: recallResource };
    const element = elementFor('recall', inputs);
    return element.type === RecallCard
      && element.key === `${baseContent.senseKey}:${recallResource!.taskKey}:${ORDINAL}`;
  })());

check('transfer 渲染迁移卡，key 沿用落地前格式',
  (() => {
    const inputs: RendererInputs = { ...fullInputs(null), assessmentResource: transferResource };
    const element = elementFor('transfer', inputs);
    return element.type === NovelTransferCard
      && element.key === `${baseContent.senseKey}:${transferResource!.taskKey}:${ORDINAL}`;
  })());

check('review_assessment 渲染复习评测卡，key 沿用落地前格式',
  (() => {
    const element = elementFor('review_assessment', fullInputs(contextReview));
    return element.type === SensaReviewAssessmentCard
      && element.key
        === `${baseContent.senseKey}:${contextReview!.spec.id}:${ORDINAL}:sensa`;
  })());

check('review_feedback 渲染复习反馈卡，key 沿用落地前格式',
  (() => {
    const element = elementFor('review_feedback', fullInputs(contextReview));
    return element.type === SensaReviewFeedbackCard
      && element.key
        === `${baseContent.senseKey}:${contextReview!.spec.id}:feedback:${ORDINAL}:sensa`;
  })());

check('review_repair 渲染修复回放卡，key 沿用落地前格式',
  (() => {
    const element = elementFor('review_repair', fullInputs(null));
    return element.type === IntroductionCard
      && element.key
        === `${baseContent.senseKey}:${REPAIR_REF.role}:${REPAIR_REF.key}`;
  })());

check('boundary 的复习材料同样渲染评测卡',
  (() => {
    if (!boundaryReview) return true;
    const element = elementFor('review_assessment', fullInputs(boundaryReview));
    return element.type === SensaReviewAssessmentCard;
  })());

/* ============================================================
   D. 宿主接线
   ============================================================ */

const lastCall = (): string => calls[calls.length - 1] ?? 'none';

check('讲解卡例句带 sentenceIndex，缺省落 0',
  (() => {
    const element = elementFor('introduction', fullInputs(null)) as ReactElement<{
      onOpenExample: (sentenceIndex?: number) => void;
    }>;
    element.props.onOpenExample(2);
    const withIndex = lastCall();
    element.props.onOpenExample();
    return withIndex === 'example:0:2' && lastCall() === 'example:0:0';
  })());

check('讲解卡字典缺省落回 curWord，并固定柯林斯页',
  (() => {
    const element = elementFor('introduction', fullInputs(null)) as ReactElement<{
      onOpenDictionary: (word?: string | QuickDictEntry) => void;
    }>;
    element.props.onOpenDictionary();
    const fallback = lastCall();
    element.props.onOpenDictionary('river');
    return fallback === `dict:${curWord.w}:柯林斯` && lastCall() === 'dict:river:柯林斯';
  })());

check('识别卡 onViewChange 接到宿主的滚动归零',
  (() => {
    const element = elementFor('recognition', fullInputs(null)) as ReactElement<{
      onViewChange: () => void;
    }>;
    element.props.onViewChange();
    return lastCall() === 'view-change';
  })());

check('回想卡例句固定 (0, 0)',
  (() => {
    const inputs: RendererInputs = { ...fullInputs(null), assessmentResource: recallResource };
    const element = elementFor('recall', inputs) as ReactElement<{
      onOpenExample: () => void;
    }>;
    element.props.onOpenExample();
    return lastCall() === 'example:0:0';
  })());

check('识别卡完成回调接 host.completeRecognition',
  (() => {
    const element = elementFor('recognition', fullInputs(null)) as ReactElement<{
      onComplete: (correct: boolean) => void;
    }>;
    element.props.onComplete(true);
    return lastCall() === 'complete:recognition:true';
  })());

check('回想卡完成回调接 host.completeMeaningToFormRecall',
  (() => {
    const inputs: RendererInputs = { ...fullInputs(null), assessmentResource: recallResource };
    const element = elementFor('recall', inputs) as ReactElement<{
      onComplete: (outcome: 'independent') => void;
    }>;
    element.props.onComplete('independent');
    return lastCall() === 'complete:recall:independent';
  })());

check('迁移卡完成回调接 host.completeNovelTransfer',
  (() => {
    const inputs: RendererInputs = { ...fullInputs(null), assessmentResource: transferResource };
    const element = elementFor('transfer', inputs) as ReactElement<{
      onComplete: (outcome: 'success') => void;
    }>;
    element.props.onComplete('success');
    return lastCall() === 'complete:transfer:success';
  })());

check('修复回放卡的完成走 host.completeIntroduction（与落地前一致）',
  (() => {
    const element = elementFor('review_repair', fullInputs(null)) as ReactElement<{
      onComplete: () => void;
    }>;
    element.props.onComplete();
    return lastCall() === 'complete:introduction';
  })());

check('复习评测卡提交接 host.completeReviewAssessment',
  (() => {
    const element = elementFor('review_assessment', fullInputs(contextReview)) as ReactElement<{
      onSubmit: (result: ReviewAssessmentResult) => void;
    }>;
    element.props.onSubmit(feedbackResult('context_recognition'));
    return lastCall() === 'complete:review:smoke-assessment';
  })());

check('复习反馈卡继续接 host.continueReviewFeedback',
  (() => {
    const element = elementFor('review_feedback', fullInputs(contextReview)) as ReactElement<{
      onContinue: () => void;
    }>;
    element.props.onContinue();
    return lastCall() === 'continue:feedback';
  })());

/* ---------- 结果 ---------- */

if (failures.length > 0) {
  console.error(`step-renderers smoke: ${failures.length}/${checks} 项失败`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`step-renderers smoke OK (${checks} checks)`);
