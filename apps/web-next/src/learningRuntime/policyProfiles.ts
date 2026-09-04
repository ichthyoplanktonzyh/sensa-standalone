import {
  conjoinContentCapabilities,
  type ContentCapabilityReadinessProvider,
  type ContentCapabilitySet,
  type PrototypeLearningReadinessView,
} from './contentCapabilities';
import type { OrchestrationId } from './orchestrations';
import type {
  CompletionPolicyId,
  EvaluationPolicyId,
  MemoryOutcomePolicyId,
  ProgressionPolicyId,
  RepairPolicyId,
} from './protocolPolicies';

export type {
  ContentCapabilityId,
  ContentCapabilityReadiness,
  ContentCapabilityReadinessProvider,
  ContentCapabilitySet,
  PrototypeLearningReadiness,
  PrototypeLearningReadinessView,
} from './contentCapabilities';

export const LEARNING_PROTOCOL_PURPOSES = [
  'initial_learning',
  'retention_review',
  'relearning',
] as const;

export type LearningProtocolPurpose = (typeof LEARNING_PROTOCOL_PURPOSES)[number];

/** 对扩展开放；可用 adapter 由 LearningRuntimeCoordinator 在 composition root 闭合。 */
export type PrototypeRuntimeAdapterId = string & {};

export interface LearningProtocolBinding {
  protocolId: string;
  protocolVersion: string;
  runtimeAdapterId: PrototypeRuntimeAdapterId;
  /**
   * 这条 Binding 的 Step 由哪套编排产出。见 orchestrations.ts。
   *
   * `relearning` 与 `retention_review` 声明同一套：§4 裁定 relearning 复用
   * 既有编排机制，插件作者只实现 `fresh` 与 `repair` 两个入口。
   */
  orchestrationId: OrchestrationId;
  /** 交互结果如何被解释为一次不可变 Observation。 */
  evaluationPolicyId: EvaluationPolicyId;
  /** Observation 如何推进、回退或重置这次 Protocol Run。 */
  progressionPolicyId: ProgressionPolicyId;
  /** 什么条件允许这次 Protocol Run 完成。 */
  completionPolicyId: CompletionPolicyId;
  /** 失败之后使用哪种修复语义。 */
  repairPolicyId: RepairPolicyId;
  /** 是否、以及如何产出交给长期保持层的分级 Outcome。 */
  memoryOutcomePolicyId: MemoryOutcomePolicyId | null;
  /** Protocol-local 检查点；不是全局 Capability，也不是 UI Card。 */
  checkpointDefinitionIds: readonly string[];
  /** 这条 Binding 需要的内容能力集合；readiness 是它们的合取。 */
  contentRequirement: ContentCapabilitySet;
}

export interface LearningPolicyPresentation {
  label: string;
  shortBadge: string;
  description: string;
  lifecycleLabel: string;
  optionClassName: string;
}

export interface LearningPolicyLifecycleContract<ProfileId extends string = string> {
  readonly evidencePolicyId: string;
  readonly schedulingPolicyId: string;
  readonly learnerVisibleClaimBoundary: string;
  readonly provisioningFallback:
    | { readonly behavior: 'blocked' }
    | { readonly behavior: 'learner_explicit_downgrade'; readonly targetProfileId: ProfileId };
  /** 已开始的运行固定旧版本；只有新 assignment 解析到更新后的 Profile。 */
  readonly migrationPolicy: 'pin_existing_runs';
}

export interface LearningPolicyProfileDefinition<ProfileId extends string = string> {
  profileId: ProfileId;
  profileVersion: string;
  presentation: LearningPolicyPresentation;
  lifecycle: LearningPolicyLifecycleContract<ProfileId>;
  protocols: Record<LearningProtocolPurpose, LearningProtocolBinding>;
}

export interface ResolvedProtocolPlan {
  purpose: LearningProtocolPurpose;
  binding: LearningProtocolBinding;
  /** 声明状态的合取：驱动界面与排期。 */
  readiness: PrototypeLearningReadinessView;
  /** 供给事实的合取：决定这次运行建不建得起来，不受声明状态覆盖影响。 */
  provisioned: boolean;
  /** 这次 plan 实际解析到的冻结内容；Protocol Run 必须按这些 identity 留 provenance。 */
  materializationIds: readonly string[];
}

export interface ResolvedLearningPlan<ProfileId extends string = string> {
  profileId: ProfileId;
  profileVersion: string;
  purposes: Record<LearningProtocolPurpose, ResolvedProtocolPlan>;
}

export class LearningPolicyProfileRegistry<ProfileId extends string> {
  readonly #profiles: readonly LearningPolicyProfileDefinition<ProfileId>[];
  readonly #profilesById: ReadonlyMap<ProfileId, LearningPolicyProfileDefinition<ProfileId>>;

  public constructor(profiles: readonly LearningPolicyProfileDefinition<ProfileId>[]) {
    const profileIds = new Set<ProfileId>();
    for (const profile of profiles) {
      if (profileIds.has(profile.profileId)) {
        throw new Error(`Duplicate Learning Policy Profile identity: ${profile.profileId}`);
      }
      profileIds.add(profile.profileId);
    }
    this.#profiles = profiles;
    this.#profilesById = new Map(profiles.map((profile) => [profile.profileId, profile]));
  }

  public list(): readonly LearningPolicyProfileDefinition<ProfileId>[] {
    return this.#profiles;
  }

  public get(profileId: ProfileId): LearningPolicyProfileDefinition<ProfileId> {
    const profile = this.#profilesById.get(profileId);
    if (!profile) throw new Error(`Unknown Learning Policy Profile: ${profileId}`);
    return profile;
  }

  /**
   * 按 Target 的内容供给方解析这条 Profile。
   *
   * 传进来的是 provider 而不是一张按需求枚举的表：readiness 是 Target 级的事实，
   * 每个用途只对自己声明的那个子集求合取。
   */
  public resolve(
    profileId: ProfileId,
    contentReadiness: ContentCapabilityReadinessProvider,
  ): ResolvedLearningPlan<ProfileId> {
    const profile = this.get(profileId);
    const purposes = Object.fromEntries(
      LEARNING_PROTOCOL_PURPOSES.map((purpose) => {
        const binding = profile.protocols[purpose];
        const conjoined = conjoinContentCapabilities(binding.contentRequirement, contentReadiness);
        return [purpose, {
          purpose,
          binding,
          readiness: conjoined.view,
          provisioned: conjoined.provisioned,
          materializationIds: conjoined.materializationIds,
        } satisfies ResolvedProtocolPlan];
      }),
    ) as unknown as Record<LearningProtocolPurpose, ResolvedProtocolPlan>;

    return {
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      purposes,
    };
  }
}

export const PROTOTYPE_LEARNING_POLICY_PROFILES = [
  {
    profileId: 'lightweight',
    profileVersion: 'lightweight-profile-v1',
    presentation: {
      label: '轻量学习',
      shortBadge: '更快开始',
      description: '使用紧凑场景、目标表达、例句和简单回想，完成后交给系统安排长期复习。',
      lifecycleLabel: '首次轻量学习 · 简单复习 · 轻量再学',
      optionClassName: '',
    },
    lifecycle: {
      evidencePolicyId: 'lightweight-non-evidentiary-v1',
      schedulingPolicyId: 'fixed-ladder-v1',
      learnerVisibleClaimBoundary: '只声称已完成学习并安排复习，不声称独立回忆或掌握。',
      provisioningFallback: { behavior: 'blocked' },
      migrationPolicy: 'pin_existing_runs',
    },
    protocols: {
      initial_learning: {
        protocolId: 'lightweight-study',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
        orchestrationId: 'lightweight_study',
        evaluationPolicyId: 'lightweight-practice-observation-v1',
        progressionPolicyId: 'completion-only-v1',
        completionPolicyId: 'study-completion-v1',
        repairPolicyId: 'lightweight-retry-v1',
        memoryOutcomePolicyId: null,
        checkpointDefinitionIds: [],
        contentRequirement: ['compact_learning_material'],
      },
      retention_review: {
        protocolId: 'learner-rated-retention-review',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
        orchestrationId: 'lightweight_retention',
        evaluationPolicyId: 'learner-rating-v1',
        progressionPolicyId: 'completion-only-v1',
        completionPolicyId: 'one-review-one-outcome-v1',
        repairPolicyId: 'lightweight-rebinding-v1',
        memoryOutcomePolicyId: 'learner-rated-graded-v1',
        checkpointDefinitionIds: [],
        contentRequirement: ['compact_learning_material'],
      },
      relearning: {
        protocolId: 'lightweight-rebinding',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
        orchestrationId: 'lightweight_retention',
        evaluationPolicyId: 'learner-rating-v1',
        progressionPolicyId: 'completion-only-v1',
        completionPolicyId: 'relearning-completion-v1',
        repairPolicyId: 'lightweight-rebinding-v1',
        memoryOutcomePolicyId: null,
        checkpointDefinitionIds: [],
        contentRequirement: ['compact_learning_material'],
      },
    },
  },
  {
    profileId: 'high_assurance',
    profileVersion: 'high-assurance-profile-v1',
    presentation: {
      label: '高保证学习',
      shortBadge: '可选择',
      description: '通过识别、主动回想、新语境迁移和必要的边界辨析，更充分地检验连接。',
      lifecycleLabel: '深度首次学习 · 证据型复习 · 针对性再学',
      optionClassName: 'is-assurance',
    },
    lifecycle: {
      evidencePolicyId: 'behavioral-acquisition-evidence-v1',
      schedulingPolicyId: 'fsrs-retention-v1',
      learnerVisibleClaimBoundary: '只声称满足当前协议的独立行为要求，不声称永久掌握。',
      provisioningFallback: {
        behavior: 'learner_explicit_downgrade',
        targetProfileId: 'lightweight',
      },
      migrationPolicy: 'pin_existing_runs',
    },
    protocols: {
      initial_learning: {
        protocolId: 'structured-acquisition',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
        orchestrationId: 'structured_acquisition',
        evaluationPolicyId: 'structured-behavioral-v1',
        progressionPolicyId: 'structured-current-checkpoint-reset-v1',
        completionPolicyId: 'all-required-current-epoch-v1',
        repairPolicyId: 'structured-targeted-repair-v1',
        memoryOutcomePolicyId: null,
        checkpointDefinitionIds: [
          'structured-acquisition:contextual_recognition',
          'structured-acquisition:meaning_to_form_recall',
          'structured-acquisition:novel_context_transfer',
          'structured-acquisition:boundary_discrimination',
        ],
        contentRequirement: ['structured_learning_package'],
      },
      retention_review: {
        protocolId: 'evidence-oriented-retention-review',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
        orchestrationId: 'structured_retention',
        evaluationPolicyId: 'structured-behavioral-v1',
        progressionPolicyId: 'completion-only-v1',
        completionPolicyId: 'one-review-one-outcome-v1',
        repairPolicyId: 'structured-targeted-repair-v1',
        memoryOutcomePolicyId: 'behavioral-binary-graded-v1',
        checkpointDefinitionIds: [],
        contentRequirement: ['structured_learning_package'],
      },
      relearning: {
        protocolId: 'targeted-structured-relearning',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
        orchestrationId: 'structured_retention',
        evaluationPolicyId: 'structured-behavioral-v1',
        progressionPolicyId: 'structured-current-checkpoint-reset-v1',
        completionPolicyId: 'relearning-completion-v1',
        repairPolicyId: 'structured-targeted-repair-v1',
        memoryOutcomePolicyId: null,
        checkpointDefinitionIds: [],
        contentRequirement: ['structured_learning_package'],
      },
    },
  },
  {
    profileId: 'interleaved_four_stage',
    profileVersion: 'interleaved-four-stage-profile-v1',
    presentation: {
      label: '四阶段穿插',
      shortBadge: '连续四关',
      description: '词义选择、语境回想、听音辨义和终关回想组内穿插；任一失败从第一阶段重来。',
      lifecycleLabel: '四阶段首次学习 · 三向自评复习 · 当日重学',
      optionClassName: 'is-interleaved',
    },
    lifecycle: {
      evidencePolicyId: 'mixed-self-report-and-behavior-v1',
      schedulingPolicyId: 'fsrs-retention-v1',
      learnerVisibleClaimBoundary: '只声称完成本协议四阶段连续通过，不借用高保证能力结论。',
      provisioningFallback: { behavior: 'blocked' },
      migrationPolicy: 'pin_existing_runs',
    },
    protocols: {
      initial_learning: {
        protocolId: 'interleaved-four-stage-acquisition',
        protocolVersion: 'v1',
        runtimeAdapterId: 'interleaved_four_stage',
        orchestrationId: 'interleaved_four_stage_acquisition',
        evaluationPolicyId: 'four-stage-mixed-evaluation-v1',
        progressionPolicyId: 'run-reset-v1',
        completionPolicyId: 'all-required-current-epoch-v1',
        repairPolicyId: 'four-stage-detail-repair-v1',
        memoryOutcomePolicyId: null,
        checkpointDefinitionIds: [
          'four-stage:meaning-choice',
          'four-stage:context-recall',
          'four-stage:sound-choice',
          'four-stage:final-recall',
        ],
        contentRequirement: ['structured_learning_package'],
      },
      retention_review: {
        protocolId: 'interleaved-four-stage-retention',
        protocolVersion: 'v1',
        runtimeAdapterId: 'interleaved_four_stage',
        orchestrationId: 'interleaved_four_stage_retention',
        evaluationPolicyId: 'learner-rating-v1',
        progressionPolicyId: 'completion-only-v1',
        completionPolicyId: 'one-review-one-outcome-v1',
        repairPolicyId: 'four-stage-rebinding-v1',
        memoryOutcomePolicyId: 'learner-rated-graded-v1',
        checkpointDefinitionIds: [],
        contentRequirement: ['structured_learning_package'],
      },
      relearning: {
        protocolId: 'interleaved-four-stage-relearning',
        protocolVersion: 'v1',
        runtimeAdapterId: 'interleaved_four_stage',
        orchestrationId: 'interleaved_four_stage_retention',
        evaluationPolicyId: 'learner-rating-v1',
        progressionPolicyId: 'completion-only-v1',
        completionPolicyId: 'relearning-completion-v1',
        repairPolicyId: 'four-stage-rebinding-v1',
        memoryOutcomePolicyId: null,
        checkpointDefinitionIds: [],
        contentRequirement: ['structured_learning_package'],
      },
    },
  },
] as const satisfies readonly LearningPolicyProfileDefinition[];

export type PrototypeLearningPolicy =
  (typeof PROTOTYPE_LEARNING_POLICY_PROFILES)[number]['profileId'];

export const learningPolicyProfileRegistry = new LearningPolicyProfileRegistry<PrototypeLearningPolicy>(
  PROTOTYPE_LEARNING_POLICY_PROFILES,
);
