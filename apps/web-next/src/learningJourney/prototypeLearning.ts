import {
  PROTOTYPE_PACKAGE_BY_SENSE,
  type PrototypeExperience,
  type PrototypeSchedulablePackage,
} from '../content/learningCatalog';
import {
  learningPolicyProfileRegistry,
  type LearningCapabilityReadiness,
  type PrototypeLearningPolicy,
  type PrototypeLearningReadiness,
  type PrototypeLearningReadinessView,
} from '../learningRuntime/policyProfiles';

export type {
  PrototypeLearningPolicy,
  PrototypeLearningReadiness,
  PrototypeLearningReadinessView,
} from '../learningRuntime/policyProfiles';

export type PrototypeLearningSourceKind = 'book' | 'direct' | 'personal_semantic_world';

export type PrototypeLearningTargetId = 'borrow-receive' | 'tactful-expression' | 'lend-give';

export type PrototypeLightweightRating = 'again' | 'hard' | 'good';

export type PrototypeExperienceGroundingView = {
  source: 'personal_semantic_world' | 'learning_package' | 'generated';
  sourceLabel: string;
  scene: string;
  focus: string;
  featureLabels: readonly string[];
  packageExperience: PrototypeExperience | null;
};

export interface PrototypeLearningTargetView {
  targetId: PrototypeLearningTargetId;
  expression: string;
  expressionTypeLabel: string;
  partOfSpeech: string;
  meaning: string;
  example: string;
  sourceKind: PrototypeLearningSourceKind;
  sourceLabel: string;
  runtimeSenseId: string | null;
  personalExperienceGrounding: Omit<
    PrototypeExperienceGroundingView,
    'source' | 'sourceLabel' | 'packageExperience'
  > | null;
  policy: PrototypeLearningPolicy;
  lightweightReadiness: PrototypeLearningReadinessView;
}

const HIGH_ASSURANCE_READY: PrototypeLearningReadinessView = {
  status: 'ready',
  label: '高保证内容已准备好',
  detail: '识别、主动回想、新语境迁移和必要的边界辨析内容已经完成校验。',
};

const HIGH_ASSURANCE_BLOCKED: PrototypeLearningReadinessView = {
  status: 'blocked',
  label: '高保证内容不完整',
  detail: '当前没有可执行的高保证学习包，系统不会自动降级。',
};

export const PROTOTYPE_LEARNING_TARGETS: Record<
  PrototypeLearningTargetId,
  PrototypeLearningTargetView
> = {
  'borrow-receive': {
    targetId: 'borrow-receive',
    expression: 'borrow',
    expressionTypeLabel: '单词',
    partOfSpeech: 'verb',
    meaning: '临时取得他人的某物供自己使用，并预期归还。',
    example: 'Can I borrow your umbrella for a minute?',
    sourceKind: 'direct',
    sourceLabel: '直接搜索已有意思',
    runtimeSenseId: 'borrow.verb.receive-temporarily',
    personalExperienceGrounding: null,
    policy: 'lightweight',
    lightweightReadiness: {
      status: 'ready',
      label: '内容已准备好',
      detail: '紧凑场景、目标表达、例句与简单回想材料已经固定。',
    },
  },
  'tactful-expression': {
    targetId: 'tactful-expression',
    expression: 'tactful',
    expressionTypeLabel: '单词',
    partOfSpeech: 'adjective',
    meaning: '表达真实意见，同时照顾对方感受，避免不必要的难堪。',
    example: 'She gave a tactful answer without hiding the problem.',
    sourceKind: 'personal_semantic_world',
    sourceLabel: '从我的词义世界加入',
    runtimeSenseId: null,
    personalExperienceGrounding: {
      scene: '同事的方案有明显问题，我指出了问题，但没有让他在会上难堪。',
      focus: '既传达真实意见，也通过措辞照顾对方感受。',
      featureLabels: ['真实意见', '得体措辞', '避免难堪'],
    },
    policy: 'lightweight',
    lightweightReadiness: {
      status: 'preparing',
      label: '正在准备内容',
      detail: '正在生成并校验本次轻量学习需要的紧凑内容。',
    },
  },
  'lend-give': {
    targetId: 'lend-give',
    expression: 'lend',
    expressionTypeLabel: '单词',
    partOfSpeech: 'verb',
    meaning: '把自己的某物暂时交给他人使用，并期待之后归还。',
    example: 'Could you lend me your umbrella?',
    sourceKind: 'book',
    sourceLabel: '日常英语核心意思 · Unit 4',
    runtimeSenseId: 'lend.verb.give-temporarily',
    personalExperienceGrounding: null,
    policy: 'high_assurance',
    lightweightReadiness: {
      status: 'ready',
      label: '轻量内容已准备好',
      detail: '紧凑场景、目标表达、例句与简单回想材料已经固定。',
    },
  },
};

export const PROTOTYPE_LEARNING_TARGET_ORDER: readonly PrototypeLearningTargetId[] = [
  'borrow-receive',
  'tactful-expression',
  'lend-give',
];

export const policyLabel = (policy: PrototypeLearningPolicy): string =>
  learningPolicyProfileRegistry.get(policy).presentation.label;

export const readinessTone = (
  readiness: PrototypeLearningReadiness,
): 'ready' | 'preparing' | 'blocked' => readiness;

export const readinessForPolicy = (
  target: PrototypeLearningTargetView,
  policy: PrototypeLearningPolicy,
): PrototypeLearningReadinessView => {
  const plan = resolvedLearningPlanForTarget(target, policy);
  const purposePlans = Object.values(plan.purposes);
  return purposePlans.find((purpose) => purpose.readiness.status === 'blocked')?.readiness
    ?? purposePlans.find((purpose) => purpose.readiness.status === 'preparing')?.readiness
    ?? plan.purposes.initial_learning.readiness;
};

export const resolvedLearningPlanForTarget = (
  target: PrototypeLearningTargetView,
  policy: PrototypeLearningPolicy,
) => {
  const readiness: LearningCapabilityReadiness = {
    compact_learning_material: target.lightweightReadiness,
    structured_learning_package: runtimePackageForTarget(target)
      ? HIGH_ASSURANCE_READY
      : HIGH_ASSURANCE_BLOCKED,
  };
  return learningPolicyProfileRegistry.resolve(policy, readiness);
};

export const runtimePackageForTarget = (
  target: PrototypeLearningTargetView,
): PrototypeSchedulablePackage | null => target.runtimeSenseId
  ? PROTOTYPE_PACKAGE_BY_SENSE.get(target.runtimeSenseId) ?? null
  : null;

export const experienceGroundingForTarget = (
  target: PrototypeLearningTargetView,
): PrototypeExperienceGroundingView => {
  if (target.personalExperienceGrounding) {
    return {
      source: 'personal_semantic_world',
      sourceLabel: '来自创建这个 Target 的个人经历',
      ...target.personalExperienceGrounding,
      packageExperience: null,
    };
  }

  const runtimePackage = runtimePackageForTarget(target);
  if (runtimePackage) {
    return {
      source: 'learning_package',
      sourceLabel: '来自已校验的 Learning Package',
      scene: runtimePackage.content.experienceSketch.bodyL1,
      focus: target.meaning,
      featureLabels: runtimePackage.content.experienceSketch.labelsL1,
      packageExperience: runtimePackage.content.experience,
    };
  }

  return {
    source: 'generated',
    sourceLabel: '由内容准备阶段生成',
    scene: `想象一个与你有关的具体时刻：${target.meaning}`,
    focus: target.meaning,
    featureLabels: ['具体场景', '意义焦点', '目标表达'],
    packageExperience: null,
  };
};

export const isPolicyAvailableForTarget = (
  target: PrototypeLearningTargetView,
  policy: PrototypeLearningPolicy,
): boolean => readinessForPolicy(target, policy).status !== 'blocked';
