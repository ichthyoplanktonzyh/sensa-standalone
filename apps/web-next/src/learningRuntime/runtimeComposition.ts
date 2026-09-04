import { prototypeContentProvisioning } from '../learningJourney/prototypeLearning';
import {
  orchestrationRegistry,
  type OrchestrationDefinition,
} from './orchestrations';
import {
  learningPolicyProfileRegistry,
  type LearningPolicyProfileDefinition,
  type PrototypeLearningPolicy,
} from './policyProfiles';
import {
  retentionStoreRegistry,
  type RetentionStoreDefinition,
} from './retentionStores';
import {
  retentionScopeRegistry,
  type RetentionScopeDefinition,
} from './retentionScopes';
import { learningRuntimeCoordinator } from './runtimeCoordinator';
import type { ProtocolRuntimeAdapter } from './runtimeCoordinator';
import {
  runtimeSurfaceRegistry,
  type RuntimeSurfaceDefinition,
} from './runtimeSurfaces';
import { stepRendererRegistry } from './stepRenderers';
import {
  protocolPolicyRegistry,
  type ProtocolPolicyRegistry,
} from './protocolPolicies';
import type { ContentCapabilityId } from './contentCapabilities';
import type { LearningStepKind } from '../engine/types';

export interface RuntimeCompositionSummary {
  readonly profileCount: number;
  readonly adapterCount: number;
  readonly orchestrationCount: number;
  readonly surfaceCount: number;
  readonly retentionStoreCount: number;
  readonly contentCapabilityCount: number;
  readonly stepRendererCount: number;
  readonly retentionScopeCount: number;
  readonly protocolPolicyCount: number;
}

export interface LearningRuntimeCompositionGraph<ProfileId extends string> {
  readonly profiles: readonly LearningPolicyProfileDefinition<ProfileId>[];
  readonly adapters: readonly ProtocolRuntimeAdapter[];
  readonly orchestrations: readonly OrchestrationDefinition[];
  readonly surfaces: readonly RuntimeSurfaceDefinition[];
  readonly retentionStores: readonly RetentionStoreDefinition[];
  readonly contentCapabilityIds: readonly ContentCapabilityId[];
  readonly stepKinds: readonly LearningStepKind[];
  readonly retentionScopes: readonly RetentionScopeDefinition[];
  readonly protocolPolicies: ProtocolPolicyRegistry;
}

const requireReference = (
  available: ReadonlySet<string>,
  identity: string,
  message: string,
): void => {
  if (!available.has(identity)) throw new Error(message);
};

/** Pure graph validation, separately testable from the singleton composition root. */
export const validateLearningRuntimeComposition = <ProfileId extends string>(
  graph: LearningRuntimeCompositionGraph<ProfileId>,
): RuntimeCompositionSummary => {
  const componentCounts = {
    profiles: graph.profiles.length,
    adapters: graph.adapters.length,
    orchestrations: graph.orchestrations.length,
    surfaces: graph.surfaces.length,
    retentionStores: graph.retentionStores.length,
    contentCapabilities: graph.contentCapabilityIds.length,
    stepRenderers: graph.stepKinds.length,
    retentionScopes: graph.retentionScopes.length,
    protocolPolicies:
      graph.protocolPolicies.inventory.evaluationPolicyIds.length
      + graph.protocolPolicies.inventory.progressionPolicies.length
      + graph.protocolPolicies.inventory.completionPolicies.length
      + graph.protocolPolicies.inventory.repairPolicyIds.length
      + graph.protocolPolicies.inventory.memoryOutcomePolicyIds.length,
  };
  const emptyComponent = Object.entries(componentCounts).find(([, count]) => count === 0);
  if (emptyComponent) {
    throw new Error(`Learning Runtime composition requires at least one ${emptyComponent[0]}.`);
  }
  const adapterIds = new Set(graph.adapters.map((adapter) => adapter.adapterId));
  const orchestrationIds = new Set(
    graph.orchestrations.map((orchestration) => orchestration.orchestrationId),
  );
  const orchestrationById = new Map(
    graph.orchestrations.map((orchestration) => [orchestration.orchestrationId, orchestration]),
  );
  const surfaceIds = new Set(graph.surfaces.map((surface) => surface.surface));
  const retentionStoreIds = new Set(graph.retentionStores.map((store) => store.storeId));
  const contentCapabilityIds = new Set(graph.contentCapabilityIds);
  const stepKinds = new Set(graph.stepKinds);
  const profileIds = new Set(graph.profiles.map((profile) => profile.profileId));

  for (const profile of graph.profiles) {
    const fallback = profile.lifecycle.provisioningFallback;
    if (fallback.behavior === 'learner_explicit_downgrade') {
      requireReference(
        profileIds,
        fallback.targetProfileId,
        `Profile ${profile.profileId} references unknown fallback ${fallback.targetProfileId}.`,
      );
    }
    for (const purpose of ['initial_learning', 'retention_review', 'relearning'] as const) {
      const binding = profile.protocols[purpose];
      if (!graph.protocolPolicies.hasEvaluation(binding.evaluationPolicyId)) {
        throw new Error(
          `Profile ${profile.profileId}/${purpose} references unknown Evaluation Policy ${binding.evaluationPolicyId}.`,
        );
      }
      graph.protocolPolicies.getProgression(binding.progressionPolicyId);
      const completionPolicy = graph.protocolPolicies.getCompletion(binding.completionPolicyId);
      if (!graph.protocolPolicies.hasRepair(binding.repairPolicyId)) {
        throw new Error(
          `Profile ${profile.profileId}/${purpose} references unknown Repair Policy ${binding.repairPolicyId}.`,
        );
      }
      if (
        binding.memoryOutcomePolicyId !== null
        && !graph.protocolPolicies.hasMemoryOutcome(binding.memoryOutcomePolicyId)
      ) {
        throw new Error(
          `Profile ${profile.profileId}/${purpose} references unknown Memory Outcome Policy ${binding.memoryOutcomePolicyId}.`,
        );
      }
      const checkpointIds = new Set(binding.checkpointDefinitionIds);
      if (checkpointIds.size !== binding.checkpointDefinitionIds.length) {
        throw new Error(`Profile ${profile.profileId}/${purpose} declares duplicate Checkpoints.`);
      }
      if (
        completionPolicy.kind === 'all_required_checkpoints'
        && binding.checkpointDefinitionIds.length === 0
      ) {
        throw new Error(
          `Profile ${profile.profileId}/${purpose} requires Checkpoint completion without Checkpoints.`,
        );
      }
      requireReference(
        adapterIds,
        binding.runtimeAdapterId,
        `Profile ${profile.profileId}/${purpose} references unknown adapter ${binding.runtimeAdapterId}.`,
      );
      requireReference(
        orchestrationIds,
        binding.orchestrationId,
        `Profile ${profile.profileId}/${purpose} references unknown orchestration ${binding.orchestrationId}.`,
      );
      const orchestration = orchestrationById.get(binding.orchestrationId)!;
      if (purpose === 'initial_learning' && !orchestration.initialCompletion) {
        throw new Error(
          `Profile ${profile.profileId}/initial_learning lacks an Initial Completion contract.`,
        );
      }
      for (const stepKind of orchestration.requiredStepKinds) {
        requireReference(
          stepKinds,
          stepKind,
          `Orchestration ${orchestration.orchestrationId} requires unknown Step renderer ${stepKind}.`,
        );
      }
      for (const capabilityId of binding.contentRequirement) {
        requireReference(
          contentCapabilityIds,
          capabilityId,
          `Profile ${profile.profileId}/${purpose} references unknown content capability ${capabilityId}.`,
        );
      }
    }
  }

  for (const adapter of graph.adapters) {
    requireReference(
      retentionStoreIds,
      adapter.retentionStoreId,
      `Adapter ${adapter.adapterId} references unknown Retention Store ${adapter.retentionStoreId}.`,
    );
    for (const purpose of ['initial_learning', 'retention_review', 'relearning'] as const) {
      const surface = adapter.surfaceFor(purpose);
      requireReference(
        surfaceIds,
        surface,
        `Adapter ${adapter.adapterId}/${purpose} references unknown Runtime Surface ${surface}.`,
      );
    }
  }

  for (const scope of graph.retentionScopes) {
    for (const capabilityId of scope.contentRequirement) {
      requireReference(
        contentCapabilityIds,
        capabilityId,
        `Retention Scope ${scope.scopeId} references unknown content capability ${capabilityId}.`,
      );
    }
  }

  return Object.freeze({
    profileCount: graph.profiles.length,
    adapterCount: graph.adapters.length,
    orchestrationCount: graph.orchestrations.length,
    surfaceCount: graph.surfaces.length,
    retentionStoreCount: graph.retentionStores.length,
    contentCapabilityCount: graph.contentCapabilityIds.length,
    stepRendererCount: graph.stepKinds.length,
    retentionScopeCount: graph.retentionScopes.length,
    protocolPolicyCount: componentCounts.protocolPolicies,
  });
};

/**
 * Composition root：所有开放 ID 在这里重新闭合。任何悬空引用都在应用启动时失败，
 * 而不是等学习者进入某条 Target 后才静默降级。
 */
export const prototypeLearningRuntimeCompositionGraph:
LearningRuntimeCompositionGraph<PrototypeLearningPolicy> = Object.freeze({
  profiles: learningPolicyProfileRegistry.list(),
  adapters: learningRuntimeCoordinator.listAdapters(),
  orchestrations: orchestrationRegistry.list(),
  surfaces: runtimeSurfaceRegistry.list(),
  retentionStores: retentionStoreRegistry.list(),
  contentCapabilityIds: prototypeContentProvisioning.list().map(
    (adapter) => adapter.capabilityId,
  ),
  stepKinds: stepRendererRegistry.listStepKinds(),
  retentionScopes: retentionScopeRegistry.list(),
  protocolPolicies: protocolPolicyRegistry,
});

export const validatePrototypeLearningRuntimeComposition = (): RuntimeCompositionSummary =>
  validateLearningRuntimeComposition(prototypeLearningRuntimeCompositionGraph);

export const prototypeLearningRuntimeComposition =
  validatePrototypeLearningRuntimeComposition();
