import {orchestrationRegistry} from '../../learning/runtime/orchestrations';
import {
  LEARNING_PROTOCOL_PURPOSES,
  learningPolicyProfileRegistry,
  type LearningPolicyProfileRegistry,
} from '../../learning/runtime/policyProfiles';
import {protocolPolicyRegistry,type ProtocolPolicyRegistry} from '../../learning/runtime/protocolPolicies';
import {
  learningRuntimeCoordinator,
  type LearningRuntimeCoordinator,
} from '../../learning/runtime/runtimeCoordinator';
import type {
  LocalRuntimePresentationBinding,
  LocalRuntimePresentationManifest,
} from './localRuntimePresentations';
import {stepRendererRegistry} from './stepRenderers';

const LOCAL_CONTENT_CAPABILITY_IDS=Object.freeze([
  'compact_learning_material',
  'structured_learning_package',
]);

interface LocalRuntimePresentationCatalog {
  resolve(request:LocalRuntimePresentationBinding):unknown;
  list():readonly LocalRuntimePresentationManifest[];
}

export interface LocalLearningRuntimeCompositionGraph<ProfileId extends string> {
  readonly profiles:LearningPolicyProfileRegistry<ProfileId>;
  readonly coordinator:LearningRuntimeCoordinator<ProfileId>;
  readonly presentations:LocalRuntimePresentationCatalog;
  readonly protocolPolicies:ProtocolPolicyRegistry;
  readonly contentCapabilityIds:readonly string[];
  readonly orchestrationIds:readonly string[];
  readonly stepKinds:readonly string[];
}

export interface LocalLearningRuntimeCompositionSummary {
  readonly profileVersionCount:number;
  readonly protocolPluginCount:number;
  readonly presentationPluginCount:number;
  readonly bindingCount:number;
  readonly orchestrationCount:number;
  readonly stepRendererCount:number;
}

/**
 * Close every open plugin identity used by the production local Runtime.
 * New versions fail application startup until execution and presentation
 * plugins both admit their exact version tuple.
 */
export function validateLocalLearningRuntimeComposition<ProfileId extends string>(
  graph:LocalLearningRuntimeCompositionGraph<ProfileId>,
):LocalLearningRuntimeCompositionSummary{
  const profileVersions=graph.profiles.listVersions();
  const contentCapabilities=new Set(graph.contentCapabilityIds);
  const orchestrations=new Set(graph.orchestrationIds);
  const stepKinds=new Set(graph.stepKinds);
  const currentProfileIds=new Set(graph.profiles.list().map(profile=>profile.profileId));
  let bindingCount=0;

  if(!profileVersions.length)throw new Error('Local Learning Runtime requires at least one Policy Profile.');
  for(const profile of profileVersions){
    const fallback=profile.lifecycle.provisioningFallback;
    if(fallback.behavior==='learner_explicit_downgrade'&&!currentProfileIds.has(fallback.targetProfileId)){
      throw new Error(`Profile ${profile.profileId} references unknown fallback ${fallback.targetProfileId}.`);
    }
    if(!profile.lifecycle.schedulingPolicy)throw new Error(`Profile ${profile.profileId} has no local Scheduling Policy.`);
    for(const purpose of LEARNING_PROTOCOL_PURPOSES){
      bindingCount++;
      const binding=profile.protocols[purpose];
      if(!binding.localProtocolVersion)throw new Error(`Profile ${profile.profileId}/${purpose} has no local wire version.`);
      if(!graph.protocolPolicies.hasEvaluation(binding.evaluationPolicyId))throw new Error(`Profile ${profile.profileId}/${purpose} references unknown Evaluation Policy ${binding.evaluationPolicyId}.`);
      graph.protocolPolicies.getProgression(binding.progressionPolicyId);
      const completionPolicy=graph.protocolPolicies.getCompletion(binding.completionPolicyId);
      if(!graph.protocolPolicies.hasRepair(binding.repairPolicyId))throw new Error(`Profile ${profile.profileId}/${purpose} references unknown Repair Policy ${binding.repairPolicyId}.`);
      if(binding.memoryOutcomePolicyId&&!graph.protocolPolicies.hasMemoryOutcome(binding.memoryOutcomePolicyId))throw new Error(`Profile ${profile.profileId}/${purpose} references unknown Memory Outcome Policy ${binding.memoryOutcomePolicyId}.`);
      if(new Set(binding.checkpointDefinitionIds).size!==binding.checkpointDefinitionIds.length)throw new Error(`Profile ${profile.profileId}/${purpose} declares duplicate Checkpoints.`);
      if(completionPolicy.kind==='all_required_checkpoints'&&!binding.checkpointDefinitionIds.length)throw new Error(`Profile ${profile.profileId}/${purpose} requires Checkpoint completion without Checkpoints.`);
      for(const capabilityId of binding.contentRequirement)if(!contentCapabilities.has(capabilityId))throw new Error(`Profile ${profile.profileId}/${purpose} references unknown Content Capability ${capabilityId}.`);
      if(!orchestrations.has(binding.orchestrationId))throw new Error(`Profile ${profile.profileId}/${purpose} references unknown Orchestration ${binding.orchestrationId}.`);
      const orchestration=orchestrationRegistry.get(binding.orchestrationId);
      if(purpose==='initial_learning'&&!orchestration.initialCompletion)throw new Error(`Profile ${profile.profileId}/initial_learning lacks an Initial Completion contract.`);
      for(const stepKind of orchestration.requiredStepKinds)if(!stepKinds.has(stepKind))throw new Error(`Orchestration ${orchestration.orchestrationId} requires unknown Step renderer ${stepKind}.`);

      graph.coordinator.localExecutionForBinding(binding,purpose);
      const adapter=graph.coordinator.adapterForBinding(binding);
      graph.presentations.resolve({
        surface:adapter.surfaceFor(purpose),
        runtimeAdapterId:binding.runtimeAdapterId,
        purpose,
        protocolId:binding.protocolId,
        protocolVersion:binding.protocolVersion,
        localProtocolVersion:binding.localProtocolVersion,
      });
    }
  }

  const protocolPluginCount=graph.coordinator.listLocalProtocolPlugins().length;
  const presentationPluginCount=graph.presentations.list().length;
  if(!protocolPluginCount||!presentationPluginCount)throw new Error('Local Learning Runtime requires executable and presentation plugins.');
  return Object.freeze({
    profileVersionCount:profileVersions.length,
    protocolPluginCount,
    presentationPluginCount,
    bindingCount,
    orchestrationCount:graph.orchestrationIds.length,
    stepRendererCount:graph.stepKinds.length,
  });
}

export const localLearningRuntimeCompositionGraph=(
  presentations:LocalRuntimePresentationCatalog,
):LocalLearningRuntimeCompositionGraph<string>=>Object.freeze({
  profiles:learningPolicyProfileRegistry,
  coordinator:learningRuntimeCoordinator,
  presentations,
  protocolPolicies:protocolPolicyRegistry,
  contentCapabilityIds:LOCAL_CONTENT_CAPABILITY_IDS,
  orchestrationIds:orchestrationRegistry.list().map(orchestration=>orchestration.orchestrationId),
  stepKinds:stepRendererRegistry.listStepKinds(),
});

/** Explicit production composition root invoked by App with its presentation plugins. */
export const composeLocalLearningRuntime=(presentations:LocalRuntimePresentationCatalog)=>
  validateLocalLearningRuntimeComposition(localLearningRuntimeCompositionGraph(presentations));
