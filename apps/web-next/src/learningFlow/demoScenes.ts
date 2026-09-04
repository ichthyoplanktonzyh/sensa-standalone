/**
 * 演示场景目录：把侧边测试面板的"跳到第 N 屏"翻译成一份完整的演示负载。
 *
 * 这原本是 `showStage` 里一段一百三十行的 switch，每个 case 连着发四五个
 * setState、一次队列覆盖、一次 toast。混在组件里的后果是它无法被单独验证：
 * 想知道第 12 屏给的是不是边界对比包，只能把应用跑起来点一遍。
 *
 * 这里把它变成纯函数——输入一个屏号，输出"要展示什么、队列要覆盖成什么、
 * 提示说什么"，不碰任何状态。副作用留在调用点，目录本身可以被 smoke 逐条断言。
 *
 * `npm run smoke:flow` 会遍历九个屏号，检查每一条都自洽。
 */
import {
  toWordPresentation,
} from '../content/learningCatalog';
import { PROTOTYPE_RUNTIME_PACKAGES as PROTOTYPE_LEARNING_PACKAGES } from '../learningRuntime/prototypeRuntimeFixtures';
import { materializeAssessmentResource } from '../content/assessmentResources';
import type { LearningCapability } from '../engine/types';
import type { DemoPresentation } from './flowState';

type RuntimePackage = (typeof PROTOTYPE_LEARNING_PACKAGES)[number];

/** 队列覆盖参数，与 `useLearnQueue().overrideDemo` 的入参一一对应。 */
export interface DemoQueueOverride {
  readonly pkg: RuntimePackage;
  readonly capability: LearningCapability | null;
  readonly step: number;
  readonly total: number;
}

export interface DemoScene {
  readonly presentation: DemoPresentation;
  readonly queue: DemoQueueOverride;
  readonly toast: string;
}

/** 侧边面板实际会发出的屏号。目录之外的输入不构成一次跳转。 */
export const DEMO_STAGE_NUMBERS = [1, 2, 3, 4, 9, 10, 11, 12, 13] as const;

/**
 * 演示用的词卡呈现。演示里的 level / isMastered 是写死的展示参数，
 * 不来自真实记忆状态——它决定卡片上显示第几级、是否带"已掌握"。
 */
export const demoWordFor = (
  pkg: RuntimePackage,
  level: number,
  isMastered = false,
): DemoPresentation['word'] => ({
  ...toWordPresentation(pkg.content),
  level,
  badge: '',
  isMastered,
});

const presentationOf = (
  pkg: RuntimePackage,
  stage: DemoPresentation['stage'],
  level: number,
  isMastered: boolean,
  reviewKind: DemoPresentation['reviewKind'] = null,
  reviewResult: DemoPresentation['reviewResult'] = null,
): DemoPresentation => ({
  stage,
  pkg,
  word: demoWordFor(pkg, level, isMastered),
  reviewKind,
  reviewResult,
});

/**
 * 第 13 屏演示的是"答错之后的统一反馈/修复"，所以它需要一个真的错误选项，
 * 而不是编一个 id。这段从内容里现取，取不到就抛——原型内容缺资源属于
 * 数据错误，静默降级只会把问题推到界面上表现为一个空的反馈屏。
 */
const buildRepairFeedbackScene = (basePackage: RuntimePackage): DemoScene => {
  const recognitionAction = basePackage.actions.find((action) =>
    action.capability === 'contextual_recognition' && action.taskKey,
  );
  if (!recognitionAction?.taskKey) {
    throw new Error(`Package ${basePackage.packageId} has no Recognition demo resource.`);
  }
  const recognitionResource = materializeAssessmentResource({
    packageIdentity: {
      packageKey: basePackage.packageId,
      senseKey: basePackage.senseId,
    },
    content: basePackage.content,
    taskKey: recognitionAction.taskKey,
    kind: 'context_recognition',
    capability: 'contextual_recognition',
  });
  if (recognitionResource.kind !== 'context_recognition') {
    throw new Error('Recognition demo must materialize a Recognition resource.');
  }
  const incorrectOption = recognitionResource.options.find((option) => !option.isCorrect);
  if (!incorrectOption) {
    throw new Error(`Recognition task ${recognitionResource.taskKey} has no incorrect demo option.`);
  }
  return {
    presentation: presentationOf(basePackage, 'review_feedback', 4, true, 'context_recognition', {
      assessmentId: `${recognitionResource.taskKey}.action-assessment`,
      kind: 'context_recognition',
      focusDimension: '语境辨义',
      correct: false,
      responseId: incorrectOption.id,
      memoryOutcome: {
        basis: 'retrieval_failed',
        grade: 'again',
        evidenceLevel: 'behavioral',
        evidenceIds: [],
      },
      evidenceEligible: true,
    }),
    queue: { pkg: basePackage, capability: 'contextual_recognition', step: 1, total: 1 },
    toast: '已切换至：统一 Adaptive Feedback / Repair',
  };
};

/** 屏号 → 演示场景。未收录的屏号返回 null，调用点据此不做任何跳转。 */
export function demoSceneForStage(stageNum: number): DemoScene | null {
  const basePackage = PROTOTYPE_LEARNING_PACKAGES[0];
  if (!basePackage) return null;
  const boundaryPackage = PROTOTYPE_LEARNING_PACKAGES.find(
    (pkg) => pkg.content.boundaryContrast !== null,
  ) ?? basePackage;

  switch (stageNum) {
    case 1:
      return {
        presentation: presentationOf(basePackage, 'introduction', 0, false),
        queue: { pkg: basePackage, capability: null, step: 1, total: 4 },
        toast: '已切换至：① 第一次遇见',
      };
    case 2:
      return {
        presentation: presentationOf(basePackage, 'recognition', 1, false),
        queue: { pkg: basePackage, capability: 'contextual_recognition', step: 2, total: 4 },
        toast: '已切换至：② 语境判断',
      };
    case 3:
      return {
        presentation: presentationOf(basePackage, 'recall', 2, false),
        queue: { pkg: basePackage, capability: 'meaning_to_form_recall', step: 3, total: 4 },
        toast: '已切换至：③ 从意思想起表达',
      };
    case 4:
      return {
        presentation: presentationOf(basePackage, 'transfer', 3, false),
        queue: { pkg: basePackage, capability: 'novel_context_transfer', step: 4, total: 4 },
        toast: '已切换至：④ 新语境迁移',
      };
    case 9:
      return {
        presentation: presentationOf(basePackage, 'review_assessment', 4, true, 'context_recognition'),
        queue: { pkg: basePackage, capability: 'contextual_recognition', step: 1, total: 1 },
        toast: '已切换至：Review · 语境判断',
      };
    case 10:
      return {
        presentation: presentationOf(basePackage, 'review_assessment', 4, true, 'meaning_to_form_recall'),
        queue: { pkg: basePackage, capability: 'meaning_to_form_recall', step: 1, total: 1 },
        toast: '已切换至：Review · 意思到表达',
      };
    case 11:
      return {
        presentation: presentationOf(basePackage, 'review_assessment', 4, true, 'novel_context_transfer'),
        queue: { pkg: basePackage, capability: 'novel_context_transfer', step: 1, total: 1 },
        toast: '已切换至：Review · 新语境迁移',
      };
    case 12:
      return {
        presentation: presentationOf(boundaryPackage, 'review_assessment', 4, true, 'boundary_contrast'),
        queue: { pkg: boundaryPackage, capability: 'boundary_discrimination', step: 1, total: 1 },
        toast: '已切换至：Review · 真实边界对比',
      };
    case 13:
      return buildRepairFeedbackScene(basePackage);
    default:
      return null;
  }
}
