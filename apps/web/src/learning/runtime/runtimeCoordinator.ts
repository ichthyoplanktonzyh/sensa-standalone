import {fourStageLocalExecution} from '../protocols/fourStage';
import {localRunBinding,localTargetPolicy} from './localRuntimeBindings';
import { lightweightLocalExecution } from './lightweightInitialProtocol';
import { assuranceLocalExecution } from '../protocols/assurance';
import type {
  LocalLearningRun,
  LocalLearningResource,
  LocalCurriculumMembership,
  LocalLearningTarget,
  LocalProtocolExecutionBinding,
  LocalProtocolExecution,
  LocalProtocolPlugin,
  LocalProtocolPluginManifest,
} from './localProtocol';
import {assertLocalTargetMaterialIdentity,localLearningPurpose,localProtocolPluginContractVersion,validateLocalProtocolResources} from './localProtocol';
import {localExecutableTarget} from './localCurriculum';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {validateLightweightInitialMaterialization} from '../../contentSupply/provisioning/lightweightInitialContent';
export type {
  LocalLearningAction,
  LocalLearningRun,
  LocalLearningTarget,
  LocalProtocolExecution,
  LocalProtocolSettlementIntent,
  LocalProtocolTransition,
} from './localProtocol';
import { sameContentCapabilitySet } from './contentCapabilities';
import {
  LEARNING_PROTOCOL_PURPOSES,
  learningPolicyProfileRegistry,
  type LearningPolicyProfileRegistry,
  type LearningProtocolBinding,
  type LearningProtocolPurpose,
  type LearningPolicyId,
  type RuntimeAdapterId,
} from './policyProfiles';
import type { OrchestrationId } from './orchestrations';

/** 对扩展开放；可用 surface 由 Web composition root 的呈现注册表闭合。 */
export type RuntimeSurfaceId = string & {};

export interface RuntimePlanningCandidate<TargetId, ProfileId extends string> {
  targetId: TargetId;
  profileId: ProfileId;
  ready: boolean;
  executable: boolean;
}

export interface RuntimeLaunch<TargetId> {
  purpose: LearningProtocolPurpose;
  protocol: LearningProtocolBinding;
  adapterId: RuntimeAdapterId;
  surface: RuntimeSurfaceId;
  targetIds: readonly TargetId[];
}

export interface ProtocolRuntimeAdapter {
  localPlugin?: LocalProtocolPlugin;
  adapterId: RuntimeAdapterId;
  retentionPriority: number;
  surfaceFor(purpose: LearningProtocolPurpose): RuntimeSurfaceId;
}

export const LIGHTWEIGHT_LOCAL_PROTOCOL_BINDINGS=Object.freeze([
 {purpose:'initial_learning',protocolId:'lightweight-study',protocolVersion:'v4',localProtocolVersion:'sensa-lightweight-initial-v2'},
 {purpose:'retention_review',protocolId:'learner-rated-retention-review',protocolVersion:'v1',localProtocolVersion:'sensa-lightweight-review-v1'},
 {purpose:'relearning',protocolId:'lightweight-rebinding',protocolVersion:'v1',localProtocolVersion:'sensa-lightweight-relearning-v1'},
] as const satisfies readonly LocalProtocolExecutionBinding[]);

export const STRUCTURED_LOCAL_PROTOCOL_BINDINGS=Object.freeze([
 {purpose:'initial_learning',protocolId:'structured-acquisition',protocolVersion:'v1',localProtocolVersion:'sensa-high-assurance-v1'},
 {purpose:'retention_review',protocolId:'evidence-oriented-retention-review',protocolVersion:'v1',localProtocolVersion:'sensa-high-assurance-v1'},
 {purpose:'relearning',protocolId:'targeted-structured-relearning',protocolVersion:'v1',localProtocolVersion:'sensa-high-assurance-v1'},
] as const satisfies readonly LocalProtocolExecutionBinding[]);

export const FOUR_STAGE_LOCAL_PROTOCOL_BINDINGS=Object.freeze([
 {purpose:'initial_learning',protocolId:'interleaved-four-stage-acquisition',protocolVersion:'v1',localProtocolVersion:'sensa-four-stage-v1'},
 {purpose:'retention_review',protocolId:'interleaved-four-stage-retention',protocolVersion:'v1',localProtocolVersion:'sensa-four-stage-v1'},
 {purpose:'relearning',protocolId:'interleaved-four-stage-relearning',protocolVersion:'v1',localProtocolVersion:'sensa-four-stage-v1'},
] as const satisfies readonly LocalProtocolExecutionBinding[]);

const localPlugin=(pluginId:string,displayName:string,adapterId:RuntimeAdapterId,bindings:readonly LocalProtocolExecutionBinding[],execution:LocalProtocolExecution):LocalProtocolPlugin=>({
 manifest:{contractVersion:localProtocolPluginContractVersion,pluginId,pluginVersion:'v2',displayName,runtimeAdapterId:adapterId,bindings},
 execution,
});

const freezeLocalProtocolManifest=(manifest:LocalProtocolPluginManifest):LocalProtocolPluginManifest=>Object.freeze({
 ...structuredClone(manifest),
 bindings:Object.freeze(manifest.bindings.map(binding=>Object.freeze({...binding}))),
});

const lightweightRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'lightweight',
  localPlugin:localPlugin('sensa.protocol.lightweight','Sensa Lightweight Protocol','lightweight',LIGHTWEIGHT_LOCAL_PROTOCOL_BINDINGS,lightweightLocalExecution),
  retentionPriority: 0,
  surfaceFor: (purpose) => purpose === 'initial_learning'
    ? 'lightweight_initial'
    : 'lightweight_retention',
};

const structuredRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'structured',
  localPlugin:localPlugin('sensa.protocol.structured','Sensa Structured Protocol','structured',STRUCTURED_LOCAL_PROTOCOL_BINDINGS,assuranceLocalExecution),
  retentionPriority: 1,
  surfaceFor: () => 'structured_session',
};

const interleavedFourStageRuntimeAdapter: ProtocolRuntimeAdapter = {
  adapterId: 'interleaved_four_stage',
  localPlugin:localPlugin('sensa.protocol.interleaved-four-stage','Sensa Interleaved Four-stage Protocol','interleaved_four_stage',FOUR_STAGE_LOCAL_PROTOCOL_BINDINGS,fourStageLocalExecution),
  retentionPriority: 1,
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
  readonly #adapters: ReadonlyMap<RuntimeAdapterId, ProtocolRuntimeAdapter>;
  readonly #localPlugins:ReadonlyMap<string,LocalProtocolPlugin>;

  public constructor(
    policyProfiles: LearningPolicyProfileRegistry<ProfileId>,
    adapters: readonly ProtocolRuntimeAdapter[] = PROTOCOL_RUNTIME_ADAPTERS,
  ) {
    this.#policyProfiles = policyProfiles;
    const adapterIds = new Set<RuntimeAdapterId>();
    const pluginIds=new Set<string>(),localPlugins=new Map<string,LocalProtocolPlugin>();
    for (const adapter of adapters) {
      if (adapterIds.has(adapter.adapterId)) {
        throw new Error(`Duplicate Protocol Runtime Adapter identity: ${adapter.adapterId}`);
      }
      adapterIds.add(adapter.adapterId);
      const plugin=adapter.localPlugin;
      if(plugin){
        const manifest=freezeLocalProtocolManifest(plugin.manifest);
        if(manifest.contractVersion!==localProtocolPluginContractVersion||manifest.runtimeAdapterId!==adapter.adapterId||!manifest.pluginId.trim()||!manifest.pluginVersion.trim()||!manifest.bindings.length)throw new Error(`Invalid local Protocol plugin for ${adapter.adapterId}.`);
        const pluginId=JSON.stringify([manifest.pluginId,manifest.pluginVersion]);
        if(pluginIds.has(pluginId))throw new Error(`Duplicate local Protocol plugin: ${pluginId}`);
        pluginIds.add(pluginId);
        const admitted=Object.freeze({manifest,execution:plugin.execution}) satisfies LocalProtocolPlugin;
        for(const binding of manifest.bindings){
          if(!LEARNING_PROTOCOL_PURPOSES.includes(binding.purpose)||!binding.protocolId.trim()||!binding.protocolVersion.trim()||!binding.localProtocolVersion.trim())throw new Error(`Invalid local Protocol binding in ${pluginId}`);
          const key=localExecutionBindingKey(adapter.adapterId,binding);
          if(localPlugins.has(key))throw new Error(`Duplicate local Protocol execution binding: ${key}`);
          localPlugins.set(key,admitted);
        }
      }
    }
    this.#adapters = new Map(adapters.map((adapter) => [adapter.adapterId, adapter]));
    this.#localPlugins=localPlugins;
    for(const profile of this.#policyProfiles.listVersions())for(const purpose of LEARNING_PROTOCOL_PURPOSES){
      const binding=profile.protocols[purpose];
      if(binding.localProtocolVersion&&!this.#localPlugins.has(localExecutionBindingKey(binding.runtimeAdapterId,{purpose,protocolId:binding.protocolId,protocolVersion:binding.protocolVersion,localProtocolVersion:binding.localProtocolVersion})))throw new Error(`No exact local Protocol plugin binding: ${profile.profileId}/${purpose}`);
    }
  }

  public localExecutionFor(profileId: ProfileId, purpose: LearningProtocolPurpose): LocalProtocolExecution {
    return this.localExecutionForBinding(this.#policyProfiles.get(profileId).protocols[purpose],purpose);
  }

  public localExecutionForBinding(binding:LearningProtocolBinding,purpose:LearningProtocolPurpose):LocalProtocolExecution{
    if(!binding.localProtocolVersion)throw new Error('This Protocol has no local wire version.');
    const plugin=this.#localPlugins.get(localExecutionBindingKey(binding.runtimeAdapterId,{purpose,protocolId:binding.protocolId,protocolVersion:binding.protocolVersion,localProtocolVersion:binding.localProtocolVersion}));
    if(!plugin)throw new Error(`No exact local Protocol plugin binding: ${binding.protocolId}@${binding.protocolVersion}/${binding.localProtocolVersion}`);
    return plugin.execution;
  }

  public listAdapters(): readonly ProtocolRuntimeAdapter[] {
    return [...this.#adapters.values()];
  }

  /** Agent/tooling discovery surface; executable capabilities stay private. */
  public listLocalProtocolPlugins(): readonly LocalProtocolPluginManifest[] {
    const unique=new Map<string,LocalProtocolPluginManifest>();
    for(const plugin of this.#localPlugins.values()){
      const manifest=plugin.manifest;
      const key=JSON.stringify([manifest.pluginId,manifest.pluginVersion]);
      if(!unique.has(key))unique.set(key,structuredClone(manifest));
    }
    return Object.freeze([...unique.values()].map(manifest=>Object.freeze({...manifest,bindings:Object.freeze([...manifest.bindings])})));
  }

  public adapterFor(
    profileId: ProfileId,
    purpose: LearningProtocolPurpose,
  ): ProtocolRuntimeAdapter {
    return this.adapterForBinding(this.#policyProfiles.get(profileId).protocols[purpose]);
  }

  public adapterForBinding(binding: LearningProtocolBinding): ProtocolRuntimeAdapter {
    const adapter = this.#adapters.get(binding.runtimeAdapterId);
    if (!adapter) throw new Error(`Unknown Protocol Runtime Adapter: ${binding.runtimeAdapterId}`);
    return adapter;
  }

  public surfaceFor(
    profileId: ProfileId,
    purpose: LearningProtocolPurpose,
  ): RuntimeSurfaceId {
    return this.adapterFor(profileId, purpose).surfaceFor(purpose);
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
    return this.planOngoing('retention_review', candidates);
  }

  public planRelearning<TargetId>(
    candidates: readonly RuntimePlanningCandidate<TargetId, ProfileId>[],
  ): readonly RuntimeLaunch<TargetId>[] {
    return this.planOngoing('relearning', candidates);
  }

  private planOngoing<TargetId>(
    purpose: Extract<LearningProtocolPurpose, 'retention_review' | 'relearning'>,
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
          const protocol = this.#policyProfiles.get(candidate.profileId).protocols[purpose];
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
              purpose,
              protocol,
              adapterId: adapter.adapterId,
              surface: adapter.surfaceFor(purpose),
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
    && left.localProtocolVersion === right.localProtocolVersion
    && left.runtimeAdapterId === right.runtimeAdapterId
    && left.orchestrationId === right.orchestrationId
    && left.evaluationPolicyId === right.evaluationPolicyId
    && left.progressionPolicyId === right.progressionPolicyId
    && left.completionPolicyId === right.completionPolicyId
    && left.repairPolicyId === right.repairPolicyId
    && left.memoryOutcomePolicyId === right.memoryOutcomePolicyId
    && sameOrderedIdentities(left.checkpointDefinitionIds, right.checkpointDefinitionIds)
    && sameOrderedIdentities(
      left.contentDemands.map((demand) =>
        `${demand.contentDemandKey}@${demand.definitionVersion}`),
      right.contentDemands.map((demand) =>
        `${demand.contentDemandKey}@${demand.definitionVersion}`),
    )
    && sameContentCapabilitySet(left.contentRequirement, right.contentRequirement);
}

function sameOrderedIdentities(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((identity, index) => identity === right[index]);
}

export const learningRuntimeCoordinator = new LearningRuntimeCoordinator<LearningPolicyId>(
  learningPolicyProfileRegistry,
);

type LocalTargetExecutionReadinessBase=Readonly<{
  purpose:LearningProtocolPurpose;
  profileId:LearningPolicyId;
  profileVersion:string;
  materializationIds:readonly string[];
  reason:string|null;
}>;
export type LocalTargetExecutionReadiness=
 | LocalTargetExecutionReadinessBase&Readonly<{status:'ready';binding:LearningProtocolBinding;reason:null}>
 | LocalTargetExecutionReadinessBase&Readonly<{status:'blocked';binding:null}>;

/**
 * One authoritative admission probe for UI, planning and Run construction.
 * It checks immutable identity, validated bytes, exact Policy/Profile versions,
 * purpose-specific content requirements and the selected execution adapter.
 */
export function inspectLocalTargetReadiness(
  target:LocalLearningTarget,
  membership:LocalCurriculumMembership|undefined,
  resource:LocalLearningResource|undefined,
  purpose:LearningProtocolPurpose=localLearningPurpose(target),
):LocalTargetExecutionReadiness{
 const profileId=localTargetPolicy(target);
 try{
  if(!membership)throw new Error('route_membership_missing');
  const executable=localExecutableTarget(target,membership);
  assertLocalTargetMaterialIdentity(target,membership.material);
  validateLightweightInitialMaterialization(membership.material);
  if(
   membership.material.snapshot.validationStatus!=='validated'
   || membership.material.snapshot.contentDigest!==canonicalJsonDigest(membership.material.content)
  )throw new Error('material_validation_failed');
  const profile=learningPolicyProfileRegistry.get(profileId,target.committedPolicy?.profileVersion);
  const binding=profile.protocols[purpose];
  if(!binding.localProtocolVersion||!profile.lifecycle.schedulingPolicy)throw new Error('incomplete_binding');
  const structuredProvisioned=!!resource&&!!membership.assurancePackageKey;
  const resolved=learningPolicyProfileRegistry.resolve(profileId,capabilityId=>{
   const provisioned=capabilityId==='compact_learning_material'
    || capabilityId==='structured_learning_package'&&structuredProvisioned;
   return {view:{status:provisioned?'ready':'blocked',label:provisioned?'ready':'blocked',detail:provisioned?'content_validated':'content_unavailable'},provisioned,materializationId:provisioned?membership.material.snapshot.learningMaterializationId:null};
  },profile.profileVersion).purposes[purpose];
  if(!resolved.provisioned||resolved.readiness.status!=='ready')throw new Error('content_unavailable');
  validateLocalProtocolResources(learningRuntimeCoordinator.localExecutionForBinding(binding,purpose),executable,resource);
  return Object.freeze({status:'ready',purpose,profileId,profileVersion:profile.profileVersion,binding,materializationIds:Object.freeze([...resolved.materializationIds]),reason:null});
 }catch(error){
  return Object.freeze({status:'blocked',purpose,profileId,profileVersion:target.committedPolicy?.profileVersion??'',binding:null,materializationIds:Object.freeze([]),reason:error instanceof Error?error.message:'content_unavailable'});
 }
}

export function requireLocalTargetReadiness(
 target:LocalLearningTarget,
 membership:LocalCurriculumMembership|undefined,
 resource:LocalLearningResource|undefined,
 purpose:LearningProtocolPurpose=localLearningPurpose(target),
):Extract<LocalTargetExecutionReadiness,{status:'ready'}>{
 const readiness=inspectLocalTargetReadiness(target,membership,resource,purpose);
 if(readiness.status!=='ready'||!readiness.binding)throw new Error('localFlow.resourceInvalid');
 return readiness;
}

export function localExecutionForRun(run:LocalLearningRun) {
  if (
    run.protocolState.adapterId !== run.protocolBinding.runtimeAdapterId
    || run.protocolVersion !== run.protocolBinding.localProtocolVersion
  ) throw new Error('localFlow.resourceInvalid');
  return learningRuntimeCoordinator.localExecutionForBinding(localRunBinding(run),run.purpose);
}

function localExecutionBindingKey(adapterId:RuntimeAdapterId,binding:LocalProtocolExecutionBinding):string{
 return JSON.stringify([adapterId,binding.purpose,binding.protocolId,binding.protocolVersion,binding.localProtocolVersion]);
}
