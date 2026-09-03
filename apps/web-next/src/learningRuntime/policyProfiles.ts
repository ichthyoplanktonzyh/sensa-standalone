import {
  conjoinContentCapabilities,
  type ContentCapabilityReadinessProvider,
  type ContentCapabilitySet,
  type PrototypeLearningReadinessView,
} from './contentCapabilities';

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

export type PrototypeRuntimeAdapterId = 'lightweight' | 'structured';

export interface LearningProtocolBinding {
  protocolId: string;
  protocolVersion: string;
  runtimeAdapterId: PrototypeRuntimeAdapterId;
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

export interface LearningPolicyProfileDefinition<ProfileId extends string = string> {
  profileId: ProfileId;
  profileVersion: string;
  presentation: LearningPolicyPresentation;
  protocols: Record<LearningProtocolPurpose, LearningProtocolBinding>;
}

export interface ResolvedProtocolPlan {
  purpose: LearningProtocolPurpose;
  binding: LearningProtocolBinding;
  /** 声明状态的合取：驱动界面与排期。 */
  readiness: PrototypeLearningReadinessView;
  /** 供给事实的合取：决定这次运行建不建得起来，不受声明状态覆盖影响。 */
  provisioned: boolean;
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
    protocols: {
      initial_learning: {
        protocolId: 'lightweight-study',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
        contentRequirement: ['compact_learning_material'],
      },
      retention_review: {
        protocolId: 'learner-rated-retention-review',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
        contentRequirement: ['compact_learning_material'],
      },
      relearning: {
        protocolId: 'lightweight-rebinding',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
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
    protocols: {
      initial_learning: {
        protocolId: 'structured-acquisition',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
        contentRequirement: ['structured_learning_package'],
      },
      retention_review: {
        protocolId: 'evidence-oriented-retention-review',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
        contentRequirement: ['structured_learning_package'],
      },
      relearning: {
        protocolId: 'targeted-structured-relearning',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
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

