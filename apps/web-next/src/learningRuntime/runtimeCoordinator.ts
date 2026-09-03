import {
  learningPolicyProfileRegistry,
  type LearningPolicyProfileRegistry,
  type LearningProtocolBinding,
  type LearningProtocolPurpose,
  type PrototypeLearningPolicy,
  type PrototypeRuntimeAdapterId,
} from './policyProfiles';
import type { RetentionStoreId } from './retentionStores';

export type PrototypeRuntimeSurface =
  | 'lightweight_initial'
  | 'lightweight_retention'
  | 'structured_session';

export interface RuntimePlanningCandidate<TargetId, ProfileId extends string> {
  targetId: TargetId;
  profileId: ProfileId;
  ready: boolean;
  executable: boolean;
}

export interface RuntimeLaunch<TargetId> {
  purpose: LearningProtocolPurpose;
  protocol: LearningProtocolBinding;
  adapterId: PrototypeRuntimeAdapterId;
  surface: PrototypeRuntimeSurface;
  targetIds: readonly TargetId[];
}

export interface ProtocolRuntimeAdapter {
  adapterId: PrototypeRuntimeAdapterId;
  retentionPriority: number;
  /** 本 Adapter 的长期保持事实存在哪。见 retentionStores.ts。 */
  retentionStoreId: RetentionStoreId;
  surfaceFor(purpose: LearningProtocolPurpose): PrototypeRuntimeSurface;
  selectInitialTargets<TargetId>(
    requestedTargetId: TargetId,
    eligibleTargets: readonly TargetId[],
  ): readonly TargetId[];
}

const lightweightRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'lightweight',
  retentionPriority: 0,
  retentionStoreId: 'fixed_ladder',
  surfaceFor: (purpose) => purpose === 'initial_learning'
    ? 'lightweight_initial'
    : 'lightweight_retention',
  selectInitialTargets: (requestedTargetId, eligibleTargets) =>
    eligibleTargets.includes(requestedTargetId) ? [requestedTargetId] : [],
};

const structuredRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'structured',
  retentionPriority: 1,
  retentionStoreId: 'scheduler_memory',
  surfaceFor: () => 'structured_session',
  selectInitialTargets: (requestedTargetId, eligibleTargets) => {
    if (!eligibleTargets.includes(requestedTargetId)) return [];
    return [requestedTargetId, ...eligibleTargets.filter((targetId) => targetId !== requestedTargetId)];
  },
};

export const PROTOCOL_RUNTIME_ADAPTERS = [
  lightweightRuntimeAdapter,
  structuredRuntimeAdapter,
] as const;

export class LearningRuntimeCoordinator<ProfileId extends string> {
  readonly #policyProfiles: LearningPolicyProfileRegistry<ProfileId>;
  readonly #adapters: ReadonlyMap<PrototypeRuntimeAdapterId, ProtocolRuntimeAdapter>;

  public constructor(
    policyProfiles: LearningPolicyProfileRegistry<ProfileId>,
    adapters: readonly ProtocolRuntimeAdapter[] = PROTOCOL_RUNTIME_ADAPTERS,
  ) {
    this.#policyProfiles = policyProfiles;
    this.#adapters = new Map(adapters.map((adapter) => [adapter.adapterId, adapter]));
  }

  public adapterFor(
    profileId: ProfileId,
    purpose: LearningProtocolPurpose,
  ): ProtocolRuntimeAdapter {
    const binding = this.#policyProfiles.get(profileId).protocols[purpose];
    const adapter = this.#adapters.get(binding.runtimeAdapterId);
    if (!adapter) throw new Error(`Unknown Protocol Runtime Adapter: ${binding.runtimeAdapterId}`);
    return adapter;
  }

  public surfaceFor(
    profileId: ProfileId,
    purpose: LearningProtocolPurpose,
  ): PrototypeRuntimeSurface {
    return this.adapterFor(profileId, purpose).surfaceFor(purpose);
  }

  /**
   * 这条 Policy 在该用途下的长期保持事实存在哪。
   *
   * 调用点问 store 而不是问 surface：新增一个复用同一 store 的 surface 时，
   * 所有读写长期状态的地方都不用改。
   */
  public retentionStoreFor(
    profileId: ProfileId,
    purpose: LearningProtocolPurpose,
  ): RetentionStoreId {
    return this.adapterFor(profileId, purpose).retentionStoreId;
  }

  /** 同上，但从已经算好的 launch 出发（launch 带的是 adapterId，不是 profileId）。 */
  public retentionStoreOfAdapter(adapterId: PrototypeRuntimeAdapterId): RetentionStoreId {
    const adapter = this.#adapters.get(adapterId);
    if (!adapter) throw new Error(`Unknown Protocol Runtime Adapter: ${adapterId}`);
    return adapter.retentionStoreId;
  }

  public planInitial<TargetId>(
    requestedTargetId: TargetId,
    candidates: readonly RuntimePlanningCandidate<TargetId, ProfileId>[],
  ): RuntimeLaunch<TargetId> | null {
    const requested = candidates.find((candidate) => candidate.targetId === requestedTargetId);
    if (!requested || !requested.ready || !requested.executable) return null;

    const protocol = this.#policyProfiles.get(requested.profileId).protocols.initial_learning;
    const adapter = this.adapterFor(requested.profileId, 'initial_learning');
    const eligibleTargetIds = candidates.flatMap((candidate) => {
      if (!candidate.ready || !candidate.executable) return [];
      const candidateProtocol = this.#policyProfiles.get(candidate.profileId).protocols.initial_learning;
      return sameProtocolBinding(candidateProtocol, protocol)
        ? [candidate.targetId]
        : [];
    });
    const targetIds = adapter.selectInitialTargets(requestedTargetId, eligibleTargetIds);
    if (targetIds.length === 0) return null;

    return {
      purpose: 'initial_learning',
      protocol,
      adapterId: adapter.adapterId,
      surface: adapter.surfaceFor('initial_learning'),
      targetIds,
    };
  }

  public planRetention<TargetId>(
    candidates: readonly RuntimePlanningCandidate<TargetId, ProfileId>[],
  ): readonly RuntimeLaunch<TargetId>[] {
    const launches = [...this.#adapters.values()]
      .sort((left, right) => left.retentionPriority - right.retentionPriority)
      .flatMap((adapter) => {
        const protocolGroups: Array<{
          protocol: LearningProtocolBinding;
          targetIds: TargetId[];
        }> = [];
        candidates.forEach((candidate) => {
          if (!candidate.ready || !candidate.executable) return;
          const protocol = this.#policyProfiles.get(candidate.profileId).protocols.retention_review;
          if (protocol.runtimeAdapterId !== adapter.adapterId) return;
          const group = protocolGroups.find((candidateGroup) =>
            sameProtocolBinding(candidateGroup.protocol, protocol));
          if (group) {
            group.targetIds.push(candidate.targetId);
            return;
          }
          protocolGroups.push({ protocol, targetIds: [candidate.targetId] });
        });
        return protocolGroups.map(({ protocol, targetIds }) => ({
              purpose: 'retention_review',
              protocol,
              adapterId: adapter.adapterId,
              surface: adapter.surfaceFor('retention_review'),
              targetIds,
            } satisfies RuntimeLaunch<TargetId>));
      });
    return launches;
  }
}

function sameProtocolBinding(
  left: LearningProtocolBinding,
  right: LearningProtocolBinding,
): boolean {
  return left.protocolId === right.protocolId
    && left.protocolVersion === right.protocolVersion
    && left.runtimeAdapterId === right.runtimeAdapterId
    && left.contentRequirement === right.contentRequirement;
}

export const learningRuntimeCoordinator = new LearningRuntimeCoordinator<PrototypeLearningPolicy>(
  learningPolicyProfileRegistry,
);
