import { sameContentCapabilitySet } from './contentCapabilities';
import {
  learningPolicyProfileRegistry,
  type LearningPolicyProfileRegistry,
  type LearningProtocolBinding,
  type LearningProtocolPurpose,
  type PrototypeLearningPolicy,
  type PrototypeRuntimeAdapterId,
} from './policyProfiles';
import type { OrchestrationId } from './orchestrations';
import type { RetentionStoreId } from './retentionStores';

/** 对扩展开放；可用 surface 由 RuntimeSurfaceRegistry 在 composition root 闭合。 */
export type PrototypeRuntimeSurface = string & {};

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
}

const lightweightRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'lightweight',
  retentionPriority: 0,
  retentionStoreId: 'fixed_ladder',
  surfaceFor: (purpose) => purpose === 'initial_learning'
    ? 'lightweight_initial'
    : 'lightweight_retention',
};

const structuredRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'structured',
  retentionPriority: 1,
  retentionStoreId: 'scheduler_memory',
  surfaceFor: () => 'structured_session',
};

const interleavedFourStageRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'interleaved_four_stage',
  retentionPriority: 1,
  retentionStoreId: 'scheduler_memory',
  surfaceFor: (purpose) => purpose === 'initial_learning'
    ? 'interleaved_four_stage'
    : 'interleaved_four_stage_review',
};

export const PROTOCOL_RUNTIME_ADAPTERS = [
  lightweightRuntimeAdapter,
  structuredRuntimeAdapter,
  interleavedFourStageRuntimeAdapter,
] as const;

export class LearningRuntimeCoordinator<ProfileId extends string> {
  readonly #policyProfiles: LearningPolicyProfileRegistry<ProfileId>;
  readonly #adapters: ReadonlyMap<PrototypeRuntimeAdapterId, ProtocolRuntimeAdapter>;

  public constructor(
    policyProfiles: LearningPolicyProfileRegistry<ProfileId>,
    adapters: readonly ProtocolRuntimeAdapter[] = PROTOCOL_RUNTIME_ADAPTERS,
  ) {
    this.#policyProfiles = policyProfiles;
    const adapterIds = new Set<PrototypeRuntimeAdapterId>();
    for (const adapter of adapters) {
      if (adapterIds.has(adapter.adapterId)) {
        throw new Error(`Duplicate Protocol Runtime Adapter identity: ${adapter.adapterId}`);
      }
      adapterIds.add(adapter.adapterId);
    }
    this.#adapters = new Map(adapters.map((adapter) => [adapter.adapterId, adapter]));
  }

  public listAdapters(): readonly ProtocolRuntimeAdapter[] {
    return [...this.#adapters.values()];
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

  /**
   * 这条 Policy 在该用途下的 Step 由哪套编排产出。
   *
   * 调用点问编排而不是问 surface：出口交出什么依据、产不产 Evidence，是编排
   * 的性质，与用哪块屏跑无关。见 orchestrations.ts。
   */
  public orchestrationFor(
    profileId: ProfileId,
    purpose: LearningProtocolPurpose,
  ): OrchestrationId {
    return this.#policyProfiles.get(profileId).protocols[purpose].orchestrationId;
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
    if (!eligibleTargetIds.includes(requestedTargetId)) return null;

    return {
      purpose: 'initial_learning',
      protocol,
      adapterId: adapter.adapterId,
      surface: adapter.surfaceFor('initial_learning'),
      // Candidate 数量已经由 Planner 按 Study Plan 的每日新学设置裁定。
      // Adapter/Protocol 只能编排这组 Target，不能再施加自己的批量或窗口上限。
      targetIds: eligibleTargetIds,
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
    && left.orchestrationId === right.orchestrationId
    && left.evaluationPolicyId === right.evaluationPolicyId
    && left.progressionPolicyId === right.progressionPolicyId
    && left.completionPolicyId === right.completionPolicyId
    && left.repairPolicyId === right.repairPolicyId
    && left.memoryOutcomePolicyId === right.memoryOutcomePolicyId
    && sameOrderedIdentities(left.checkpointDefinitionIds, right.checkpointDefinitionIds)
    && sameContentCapabilitySet(left.contentRequirement, right.contentRequirement);
}

function sameOrderedIdentities(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((identity, index) => identity === right[index]);
}

export const learningRuntimeCoordinator = new LearningRuntimeCoordinator<PrototypeLearningPolicy>(
  learningPolicyProfileRegistry,
);
