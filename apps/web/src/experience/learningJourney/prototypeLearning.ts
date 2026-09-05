import {
  PROTOTYPE_PACKAGE_BY_SENSE,
  type PrototypeExperience,
  type PrototypeIntroductionPackage,
} from '../content/learningCatalog';
import {
  bindPackageToRetentionTarget,
  type SchedulablePackage,
} from '../engine/types';
import { worseReadinessView } from '../learningRuntime/contentCapabilities';
import {
  ContentProvisioningRegistry,
  type ContentProvisioningAdapter,
} from '../learningRuntime/contentProvisioning';
import {
  provisionLightweightInitialContent,
  type LightweightInitialContentInput,
  type LightweightInitialLearningMaterialization,
} from '../learningRuntime/lightweightInitialContent';
import { LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION } from '@sensa/contracts/sensa';
import { stableUuid } from '@sensa/learning-kernel';
import { retentionScopeRegistry } from '../learningRuntime/retentionScopes';
import {
  learningPolicyProfileRegistry,
  type ContentCapabilityReadinessProvider,
  type LearningProtocolPurpose,
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

/**
 * Target ids reach the app from the URL, so they arrive as arbitrary strings.
 * Narrowing them here keeps a hand-typed or stale link from indexing
 * `PROTOTYPE_LEARNING_TARGETS` with something that isn't there.
 */
export const isPrototypeLearningTargetId = (
  value: unknown,
): value is PrototypeLearningTargetId =>
  typeof value === 'string'
  && (PROTOTYPE_LEARNING_TARGET_ORDER as readonly string[]).includes(value);

export const policyLabel = (policy: PrototypeLearningPolicy): string =>
  learningPolicyProfileRegistry.get(policy).presentation.label;

export const readinessTone = (
  readiness: PrototypeLearningReadiness,
): 'ready' | 'preparing' | 'blocked' => readiness;

/**
 * 这条方式整体的准备状态：三个用途之间同样取合取，报最坏的那条。
 * 并列时保留首学那条——它是学习者接下来要跑的那个。
 */
export const readinessForPolicy = (
  target: PrototypeLearningTargetView,
  policy: PrototypeLearningPolicy,
): PrototypeLearningReadinessView => {
  const plan = resolvedLearningPlanForTarget(target, policy);
  return Object.values(plan.purposes)
    .map((purpose) => purpose.readiness)
    .reduce(worseReadinessView, plan.purposes.initial_learning.readiness);
};

/**
 * 这条 Target 在该方式 / 用途下的内容能力是不是都已供给。
 *
 * 与 readiness 分开问：journey 的"刷新准备状态"能把声明状态推成 ready，
 * 但推不出一个不存在的学习包。要不要建这次运行，问的是这个。
 */
export const provisionedForPolicy = (
  target: PrototypeLearningTargetView,
  policy: PrototypeLearningPolicy,
  purpose: LearningProtocolPurpose = 'initial_learning',
): boolean => resolvedLearningPlanForTarget(target, policy).purposes[purpose].provisioned;

/**
 * 这条 Target 的内容供给方。内容属于 Target，所以 provider 按 Target 建；
 * 每个用途只对自己声明的那个能力子集求合取。
 */
const requireMaterializationIdentity = (materializationId: string, capabilityId: string): void => {
  if (materializationId.trim().length === 0) {
    throw new Error(`${capabilityId} produced an empty Materialization identity.`);
  }
};

/** Catalog Package + learner Retention Target binding, still owned by the provisioner. */
const boundPackageDraftForTarget = (
  target: PrototypeLearningTargetView,
): SchedulablePackage<PrototypeIntroductionPackage> | null => {
  const packageTemplate = target.runtimeSenseId
    ? PROTOTYPE_PACKAGE_BY_SENSE.get(target.runtimeSenseId) ?? null
    : null;
  return packageTemplate
    ? bindPackageToRetentionTarget(packageTemplate, defaultRetentionTargetIdFor(target))
    : null;
};

const expressionKindFor = (
  target: PrototypeLearningTargetView,
): LightweightInitialContentInput['expression']['expressionKind'] => {
  if (target.expressionTypeLabel === '单词') return 'word';
  if (target.expressionTypeLabel === '短语') return 'phrase';
  if (target.expressionTypeLabel === '构式') return 'construction';
  if (target.expressionTypeLabel === '句子') return 'utterance';
  return 'unspecified';
};

export const lightweightContentInputForTarget = (
  target: PrototypeLearningTargetView,
): LightweightInitialContentInput => {
  const grounding = experienceGroundingForTarget(target);
  const hasAuthoritativeGrounding = grounding.source !== 'generated';
  return {
    learnerUserId: 'prototype-learner',
    learningTargetId: stableUuid(`prototype:learning-target:${target.targetId}`),
    senseId: stableUuid(`prototype:sense:${target.targetId}`),
    senseVersionId: stableUuid(`prototype:sense-version:${target.targetId}:v1`),
    senseExpressionBindingId: stableUuid(`prototype:sense-expression-binding:${target.targetId}`),
    resolvedLearningPlanRevisionId: `prototype-plan:${target.targetId}:v1`,
    expressionSourceVersion: 'prototype-expression-v1',
    senseSourceVersion: 'prototype-sense-v1',
    expression: {
      surface: target.expression,
      languageTag: 'en',
      expressionKind: expressionKindFor(target),
    },
    sense: {
      meaning: target.meaning,
      familiarLanguageTag: 'zh-CN',
    },
    originExperience: hasAuthoritativeGrounding
      ? {
          source: grounding.source === 'personal_semantic_world'
            ? 'personal_anchor'
            : 'other_authoritative_source',
          sourceVersion: grounding.source === 'personal_semantic_world'
            ? 'prototype-personal-anchor-v1'
            : 'prototype-learning-package-v1',
          personalAnchorUseGrantId: grounding.source === 'personal_semantic_world'
            ? stableUuid(`prototype:personal-anchor-use-grant:${target.targetId}`)
            : null,
          experience: {
            scene: grounding.scene,
            senseFocus: grounding.focus,
            featureLabels: [...grounding.featureLabels].slice(0, 4),
          },
        }
      : null,
    referenceFacts: [
      ...(target.expressionTypeLabel.trim() || target.partOfSpeech.trim()
        ? [{
            source: 'other_authoritative_source' as const,
            sourceVersion: 'prototype-target-metadata-v1',
            fact: {
              factKind: 'language_structure' as const,
              expressionTypeLabel: target.expressionTypeLabel.trim() || null,
              partOfSpeech: target.partOfSpeech.trim() || null,
            },
          }]
        : []),
      ...(target.example.trim()
        ? [{
            source: 'other_authoritative_source' as const,
            sourceVersion: 'prototype-target-example-v1',
            fact: {
              factKind: 'usage_example' as const,
              example: target.example,
            },
          }]
        : []),
    ],
    requestedAt: '2026-09-04T00:00:00.000Z',
  };
};

const compactContentProvisioner: ContentProvisioningAdapter<PrototypeLearningTargetView> = {
  capabilityId: 'compact_learning_material',
  readinessFor: (target) => target.lightweightReadiness,
  prepare: (target) => {
    const result = provisionLightweightInitialContent(lightweightContentInputForTarget(target));
    if (result.status !== 'ready') return null;
    return {
      materializationId: result.materialization.snapshot.learningMaterializationId,
      materializationVersion: LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,
      content: result.materialization,
    };
  },
  validate: (target, draft) => {
    requireMaterializationIdentity(draft.materializationId, 'compact_learning_material');
    const materialization = draft.content as LightweightInitialLearningMaterialization;
    if (
      materialization.snapshot.learningTargetId
      !== stableUuid(`prototype:learning-target:${target.targetId}`)
    ) {
      throw new Error(`Compact Materialization is bound to another Target: ${target.targetId}`);
    }
  },
};

const structuredPackageProvisioner: ContentProvisioningAdapter<PrototypeLearningTargetView> = {
  capabilityId: 'structured_learning_package',
  readinessFor: (target) => boundPackageDraftForTarget(target)
    ? HIGH_ASSURANCE_READY
    : HIGH_ASSURANCE_BLOCKED,
  prepare: (target) => {
    const runtimePackage = boundPackageDraftForTarget(target);
    return runtimePackage
      ? {
          materializationId: `prototype-package:${runtimePackage.packageId}`,
          materializationVersion: 'v1',
          content: runtimePackage,
        }
      : null;
  },
  validate: (target, draft) => {
    requireMaterializationIdentity(draft.materializationId, 'structured_learning_package');
    if (!target.runtimeSenseId) {
      throw new Error(`Structured package for ${target.targetId} lacks a stable Sense identity.`);
    }
  },
};

export const prototypeContentProvisioning = new ContentProvisioningRegistry([
  compactContentProvisioner,
  structuredPackageProvisioner,
]);

export const lightweightInitialMaterializationForTarget = (
  target: PrototypeLearningTargetView,
): LightweightInitialLearningMaterialization | null => {
  const result = prototypeContentProvisioning.resolve(target, 'compact_learning_material');
  return result.materialization
    ? result.materialization.content as LightweightInitialLearningMaterialization
    : null;
};

const contentReadinessForTarget = (
  target: PrototypeLearningTargetView,
): ContentCapabilityReadinessProvider => prototypeContentProvisioning.readinessProvider(target);

export const resolvedLearningPlanForTarget = (
  target: PrototypeLearningTargetView,
  policy: PrototypeLearningPolicy,
) => learningPolicyProfileRegistry.resolve(policy, contentReadinessForTarget(target));

export const defaultRetentionTargetIdFor = (
  target: PrototypeLearningTargetView,
): string => retentionScopeRegistry.resolveTargets(target.targetId)[0]!.retentionTargetId;

export const runtimePackageForTarget = (
  target: PrototypeLearningTargetView,
): SchedulablePackage<PrototypeIntroductionPackage> | null => {
  const result = prototypeContentProvisioning.resolve(
    target,
    'structured_learning_package',
  );
  return result.materialization
    ? result.materialization.content as SchedulablePackage<PrototypeIntroductionPackage>
    : null;
};

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
