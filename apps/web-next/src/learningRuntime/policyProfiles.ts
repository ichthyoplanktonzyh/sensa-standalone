export const LEARNING_PROTOCOL_PURPOSES = [
  'initial_learning',
  'retention_review',
  'relearning',
] as const;

export type LearningProtocolPurpose = (typeof LEARNING_PROTOCOL_PURPOSES)[number];

export type PrototypeRuntimeAdapterId = 'lightweight' | 'structured';

export type PrototypeContentRequirement =
  | 'compact_learning_material'
  | 'structured_learning_package';

export type PrototypeLearningReadiness = 'ready' | 'preparing' | 'blocked';

export interface PrototypeLearningReadinessView {
  status: PrototypeLearningReadiness;
  label: string;
  detail: string;
}

export interface LearningProtocolBinding {
  protocolId: string;
  protocolVersion: string;
  runtimeAdapterId: PrototypeRuntimeAdapterId;
  contentRequirement: PrototypeContentRequirement;
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
  readiness: PrototypeLearningReadinessView;
}

export interface ResolvedLearningPlan<ProfileId extends string = string> {
  profileId: ProfileId;
  profileVersion: string;
  purposes: Record<LearningProtocolPurpose, ResolvedProtocolPlan>;
}

export type LearningCapabilityReadiness = Record<
  PrototypeContentRequirement,
  PrototypeLearningReadinessView
>;

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

  public resolve(
    profileId: ProfileId,
    readiness: LearningCapabilityReadiness,
  ): ResolvedLearningPlan<ProfileId> {
    const profile = this.get(profileId);
    const purposes = Object.fromEntries(
      LEARNING_PROTOCOL_PURPOSES.map((purpose) => {
        const binding = profile.protocols[purpose];
        return [purpose, {
          purpose,
          binding,
          readiness: readiness[binding.contentRequirement],
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
        contentRequirement: 'compact_learning_material',
      },
      retention_review: {
        protocolId: 'learner-rated-retention-review',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
        contentRequirement: 'compact_learning_material',
      },
      relearning: {
        protocolId: 'lightweight-rebinding',
        protocolVersion: 'v1',
        runtimeAdapterId: 'lightweight',
        contentRequirement: 'compact_learning_material',
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
        contentRequirement: 'structured_learning_package',
      },
      retention_review: {
        protocolId: 'evidence-oriented-retention-review',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
        contentRequirement: 'structured_learning_package',
      },
      relearning: {
        protocolId: 'targeted-structured-relearning',
        protocolVersion: 'v1',
        runtimeAdapterId: 'structured',
        contentRequirement: 'structured_learning_package',
      },
    },
  },
] as const satisfies readonly LearningPolicyProfileDefinition[];

export type PrototypeLearningPolicy =
  (typeof PROTOTYPE_LEARNING_POLICY_PROFILES)[number]['profileId'];

export const learningPolicyProfileRegistry = new LearningPolicyProfileRegistry<PrototypeLearningPolicy>(
  PROTOTYPE_LEARNING_POLICY_PROFILES,
);

