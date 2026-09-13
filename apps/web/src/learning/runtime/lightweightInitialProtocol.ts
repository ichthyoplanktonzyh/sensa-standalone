import {z} from 'zod';
import {lightweightProtocolStepId,transitionLightweightProtocol} from '@sensa/learning-kernel';
import {
  createLocalProtocolState,
  readLocalProtocolState,
  type LocalLearningMaterialization,
  type LocalLearningRun,
  type LocalLearningTarget,
  type LocalProtocolExecution,
} from './localProtocol';
import {initialCompletionContractOf,orchestrationRegistry} from './orchestrations';
import {localRunBinding} from './localRuntimeBindings';
/**
 * Executable Lightweight Initial Learning protocol.
 *
 * The protocol owns the two-Step graph and uses the shared progression kernel.
 * React renderers receive the current Step Instance but do not own its phase or
 * decide whether the run repeats or completes.
 */
import {
  sensaLearningConnectionContractVersion,
  sensaProtocolStepDefinitionSchema,
  type SensaProtocolStepMaterialBinding,
  type SensaProtocolStepDefinition,
  type SensaProtocolStepTransitionRule,
} from '@sensa/contracts/sensa';
import {
  createProtocolProgressState,
  decideAndApplyProtocolTransition,
  type LearningObservation,
  type ProtocolProgressDefinition,
  type ProtocolProgressState,
  type ProtocolTransitionDecision,
} from '@sensa/learning-kernel';
import { protocolPolicyRegistry } from './protocolPolicies';

export const LIGHTWEIGHT_STUDY_PROTOCOL_ID = 'lightweight-study' as const;
export const LIGHTWEIGHT_STUDY_PROTOCOL_VERSION = 'v2' as const;

export const LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_ID =
  'lightweight-study.experience-recall' as const;
export const LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_ID =
  'lightweight-study.expression-reveal' as const;

export const LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND =
  'lightweight_experience_recall' as const;
export const LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND =
  'lightweight_expression_reveal' as const;

export type LightweightInitialRating = 'again' | 'hard' | 'good';
export type LightweightInitialOutcomeKey = 'reveal_requested' | LightweightInitialRating;

const parseStep = (definition: unknown): SensaProtocolStepDefinition =>
  Object.freeze(sensaProtocolStepDefinitionSchema.parse(definition));

export const LIGHTWEIGHT_EXPERIENCE_RECALL_STEP = parseStep({
  contractVersion: sensaLearningConnectionContractVersion,
  protocolStepDefinitionId: LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_ID,
  protocolId: LIGHTWEIGHT_STUDY_PROTOCOL_ID,
  protocolVersion: LIGHTWEIGHT_STUDY_PROTOCOL_VERSION,
  purpose: 'initial_learning',
  intent: 'practice',
  stepKind: LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  materialRequirements: [
    { materialRoleKey: 'experience_recall_cue', use: 'prompt', required: true },
    { materialRoleKey: 'recall_support', use: 'support', required: false },
  ],
  presentation: {
    presentationKey: 'lightweight-experience-recall-card',
    presentationVersion: 'v1',
  },
  interactionContractId: 'request-expression-reveal',
  interactionContractVersion: 'v1',
  resultEligibility: {
    attempt: true,
    observation: true,
    evidence: false,
    memoryOutcome: false,
  },
  transitions: [{
    outcomeKey: 'reveal_requested',
    observationKind: 'practice_completed',
    effect: 'advance',
    nextProtocolStepDefinitionId: LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_ID,
  }],
});

export const LIGHTWEIGHT_EXPRESSION_REVEAL_STEP = parseStep({
  contractVersion: sensaLearningConnectionContractVersion,
  protocolStepDefinitionId: LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_ID,
  protocolId: LIGHTWEIGHT_STUDY_PROTOCOL_ID,
  protocolVersion: LIGHTWEIGHT_STUDY_PROTOCOL_VERSION,
  purpose: 'initial_learning',
  intent: 'instruction',
  stepKind: LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND,
  materialRequirements: [
    { materialRoleKey: 'target_expression', use: 'reveal', required: true },
    { materialRoleKey: 'sense_confirmation', use: 'feedback', required: true },
    { materialRoleKey: 'pronunciation', use: 'support', required: false },
    { materialRoleKey: 'language_structure', use: 'support', required: false },
    { materialRoleKey: 'usage_guidance', use: 'support', required: false },
    { materialRoleKey: 'scene_bridge', use: 'support', required: false },
  ],
  presentation: {
    presentationKey: 'lightweight-expression-reveal-card',
    presentationVersion: 'v1',
  },
  interactionContractId: 'lightweight-initial-rating',
  interactionContractVersion: 'v1',
  resultEligibility: {
    attempt: true,
    observation: true,
    evidence: false,
    memoryOutcome: false,
  },
  transitions: [
    {
      outcomeKey: 'again',
      observationKind: 'practice_completed',
      effect: 'repeat',
      nextProtocolStepDefinitionId: LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_ID,
    },
    {
      outcomeKey: 'hard',
      observationKind: 'protocol_completed',
      effect: 'complete',
      nextProtocolStepDefinitionId: null,
    },
    {
      outcomeKey: 'good',
      observationKind: 'protocol_completed',
      effect: 'complete',
      nextProtocolStepDefinitionId: null,
    },
  ],
});

export const LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS = Object.freeze([
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP,
  LIGHTWEIGHT_EXPRESSION_REVEAL_STEP,
]);

const stepById = new Map(LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS.map((step) => [
  step.protocolStepDefinitionId,
  step,
]));

const LIGHTWEIGHT_PROGRESS_DEFINITION: ProtocolProgressDefinition = Object.freeze({
  protocolId: LIGHTWEIGHT_STUDY_PROTOCOL_ID,
  protocolVersion: LIGHTWEIGHT_STUDY_PROTOCOL_VERSION,
  checkpoints: Object.freeze([]),
  completionPolicy: protocolPolicyRegistry.getCompletion('study-completion-v1'),
});

const progressionPolicy = protocolPolicyRegistry.getProgression('completion-only-v1');

export interface LightweightProtocolStepInstance {
  readonly protocolStepInstanceId: string;
  readonly protocolRunId: string;
  readonly retentionTargetId: string;
  readonly ordinal: number;
  readonly definition: SensaProtocolStepDefinition;
  readonly materialBindings: readonly SensaProtocolStepMaterialBinding[];
}

export interface LightweightCompletedStep {
  readonly instance: LightweightProtocolStepInstance;
  readonly outcomeKey: LightweightInitialOutcomeKey;
  readonly observation: LearningObservation;
  readonly transitionDecision: ProtocolTransitionDecision;
}

export interface LightweightInitialProtocolRunState {
  readonly protocolRunId: string;
  readonly retentionTargetId: string;
  readonly learningMaterializationId: string;
  readonly materialBindings: readonly SensaProtocolStepMaterialBinding[];
  readonly currentStepDefinitionId: string | null;
  readonly currentStepOrdinal: number;
  readonly eventOrdinal: number;
  readonly retryCount: number;
  readonly completionRating: Exclude<LightweightInitialRating, 'again'> | null;
  readonly progress: ProtocolProgressState;
  readonly completedSteps: readonly LightweightCompletedStep[];
}

export interface LightweightInitialTransitionResult {
  readonly state: LightweightInitialProtocolRunState;
  readonly completedStep: LightweightCompletedStep;
}

const definitionFor = (definitionId: string): SensaProtocolStepDefinition => {
  const definition = stepById.get(definitionId);
  if (!definition) throw new Error(`Unknown Lightweight Initial Step: ${definitionId}`);
  return definition;
};

const transitionFor = (
  definition: SensaProtocolStepDefinition,
  outcomeKey: LightweightInitialOutcomeKey,
): SensaProtocolStepTransitionRule => {
  const transition = definition.transitions.find((candidate) => candidate.outcomeKey === outcomeKey);
  if (!transition) {
    throw new Error(
      `Step ${definition.protocolStepDefinitionId} does not accept outcome ${outcomeKey}.`,
    );
  }
  return transition;
};

export const validateLightweightInitialProtocol = (): void => {
  if (stepById.size !== LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS.length) {
    throw new Error('Duplicate Lightweight Initial Step definition identity.');
  }
  for (const definition of LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS) {
    if (
      definition.protocolId !== LIGHTWEIGHT_STUDY_PROTOCOL_ID
      || definition.protocolVersion !== LIGHTWEIGHT_STUDY_PROTOCOL_VERSION
      || definition.purpose !== 'initial_learning'
    ) {
      throw new Error(`Step ${definition.protocolStepDefinitionId} is pinned to another Protocol.`);
    }
    for (const transition of definition.transitions) {
      if (
        transition.nextProtocolStepDefinitionId !== null
        && !stepById.has(transition.nextProtocolStepDefinitionId)
      ) {
        throw new Error(
          `Step ${definition.protocolStepDefinitionId} references unknown next Step ${transition.nextProtocolStepDefinitionId}.`,
        );
      }
    }
  }
};

validateLightweightInitialProtocol();

export const createLightweightInitialProtocolRun = (input: Readonly<{
  protocolRunId: string;
  retentionTargetId: string;
  learningMaterializationId: string;
  materialResources: readonly Readonly<{
    materialRoleKey: string;
    resourceKey: string;
  }>[];
}>): LightweightInitialProtocolRunState => {
  if (input.protocolRunId.trim().length === 0) throw new Error('Protocol Run identity is required.');
  if (input.retentionTargetId.trim().length === 0) throw new Error('Retention Target identity is required.');
  if (input.learningMaterializationId.trim().length === 0) {
    throw new Error('Learning Materialization identity is required.');
  }
  const bindingKeys = new Set<string>();
  const materialBindings = input.materialResources.map((resource) => {
    const bindingKey = `${resource.materialRoleKey}:${resource.resourceKey}`;
    if (bindingKeys.has(bindingKey)) {
      throw new Error(`Duplicate Lightweight material binding: ${bindingKey}`);
    }
    bindingKeys.add(bindingKey);
    return Object.freeze({
      materialRoleKey: resource.materialRoleKey,
      learningMaterializationId: input.learningMaterializationId,
      resourceKey: resource.resourceKey,
    });
  });
  for (const definition of LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS) {
    for (const requirement of definition.materialRequirements.filter((candidate) =>
      candidate.required)) {
      if (!materialBindings.some((binding) =>
        binding.materialRoleKey === requirement.materialRoleKey)) {
        throw new Error(
          `Learning Materialization lacks required role ${requirement.materialRoleKey} for ${definition.protocolStepDefinitionId}.`,
        );
      }
    }
  }
  return Object.freeze({
    protocolRunId: input.protocolRunId,
    retentionTargetId: input.retentionTargetId,
    learningMaterializationId: input.learningMaterializationId,
    materialBindings: Object.freeze(materialBindings),
    currentStepDefinitionId: LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_ID,
    currentStepOrdinal: 1,
    eventOrdinal: 0,
    retryCount: 0,
    completionRating: null,
    progress: createProtocolProgressState(input.protocolRunId, LIGHTWEIGHT_PROGRESS_DEFINITION),
    completedSteps: Object.freeze([]),
  });
};

export const currentLightweightInitialStep = (
  state: LightweightInitialProtocolRunState,
): LightweightProtocolStepInstance | null => {
  if (state.currentStepDefinitionId === null) return null;
  const definition = definitionFor(state.currentStepDefinitionId);
  const admittedRoles = new Set(definition.materialRequirements.map((requirement) =>
    requirement.materialRoleKey));
  return Object.freeze({
    protocolStepInstanceId: `${state.protocolRunId}:step:${state.currentStepOrdinal}`,
    protocolRunId: state.protocolRunId,
    retentionTargetId: state.retentionTargetId,
    ordinal: state.currentStepOrdinal,
    definition,
    materialBindings: Object.freeze(state.materialBindings.filter((binding) =>
      admittedRoles.has(binding.materialRoleKey))),
  });
};

export const transitionLightweightInitialProtocol = (
  state: LightweightInitialProtocolRunState,
  outcomeKey: LightweightInitialOutcomeKey,
): LightweightInitialTransitionResult => {
  if (state.progress.completed || state.currentStepDefinitionId === null) {
    throw new Error(`Lightweight Initial Run ${state.protocolRunId} is already complete.`);
  }
  const instance = currentLightweightInitialStep(state)!;
  const transition = transitionFor(instance.definition, outcomeKey);
  const eventOrdinal = state.eventOrdinal + 1;
  const observation: LearningObservation = Object.freeze({
    observationId: `${state.protocolRunId}:observation:${eventOrdinal}`,
    attemptId: `${state.protocolRunId}:attempt:${eventOrdinal}`,
    actionId: instance.protocolStepInstanceId,
    kind: transition.observationKind,
    checkpointId: null,
    evidenceIds: Object.freeze([]),
  });
  const transitionResult = decideAndApplyProtocolTransition({
    definition: LIGHTWEIGHT_PROGRESS_DEFINITION,
    policy: progressionPolicy,
    state: state.progress,
    observation,
    decisionId: `${state.protocolRunId}:decision:${eventOrdinal}`,
  });
  const completes = transitionResult.decision.effects.some((effect) => effect.kind === 'complete');
  const advances = transitionResult.decision.effects.some((effect) => effect.kind === 'advance');
  if ((transition.effect === 'complete') !== completes) {
    throw new Error(`Progression Policy disagrees with ${transition.effect} transition ${outcomeKey}.`);
  }
  if (transition.effect !== 'complete' && (!advances || completes)) {
    throw new Error(`Progression Policy cannot advance transition ${outcomeKey}.`);
  }

  const completedStep: LightweightCompletedStep = Object.freeze({
    instance,
    outcomeKey,
    observation,
    transitionDecision: transitionResult.decision,
  });
  const completionRating = outcomeKey === 'hard' || outcomeKey === 'good'
    ? outcomeKey
    : state.completionRating;
  const nextState: LightweightInitialProtocolRunState = Object.freeze({
    ...state,
    currentStepDefinitionId: transition.nextProtocolStepDefinitionId,
    currentStepOrdinal: state.currentStepOrdinal + 1,
    eventOrdinal,
    retryCount: transition.effect === 'repeat' ? state.retryCount + 1 : state.retryCount,
    completionRating,
    progress: transitionResult.state,
    completedSteps: Object.freeze([...state.completedSteps, completedStep]),
  });
  return Object.freeze({ state: nextState, completedStep });
};

const localActionSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('reveal')}).strict(),z.object({kind:z.literal('rate'),rating:z.enum(['again','hard','good'])}).strict()]);
type LocalLightweightProtocolState={phase:'recall'|'reveal';initial:LightweightInitialProtocolRunState|null};
const localState=(run:LocalLearningRun)=>readLocalProtocolState<LocalLightweightProtocolState>(run,'lightweight');
export const localLightweightPhase=(run:LocalLearningRun)=>localState(run).phase;

/** Persistence adapter. Protocols emit settlement intent; only the library settlement module writes memory. */
export const lightweightLocalExecution: LocalProtocolExecution = {
 initialize:(target,_pack,purpose,run)=>createLocalProtocolState('lightweight',{phase:'recall',initial:purpose==='initial_learning'?localInitialState(run,target):null} satisfies LocalLightweightProtocolState),
 stepId:run=>lightweightProtocolStepId(run.id,run.ordinal,localState(run).phase,run.protocolVersion),
 replayState:(target,_pack,saved)=>createLocalProtocolState('lightweight',{phase:'recall',initial:saved.purpose==='initial_learning'?localInitialState(saved,target):null} satisfies LocalLightweightProtocolState),
 unsafeTransition:(target,run,_pack,action,at)=>{
  localActionSchema.parse(action);
  if(action.kind!=='reveal'&&action.kind!=='rate')throw new Error('localFlow.stepChanged');
  const state=localState(run);
  let next: 'recall'|'reveal'|'completed'|'waiting';
  let evaluation:ReturnType<LocalProtocolExecution['unsafeTransition']>['evaluation']=null;
  if(run.purpose==='initial_learning'){
   if(!state.initial)throw new Error('localFlow.resourceInvalid');
   const result=transitionLightweightInitialProtocol(state.initial,action.kind==='reveal'?'reveal_requested':action.rating);
   state.initial=result.state;
   next=result.state.currentStepDefinitionId===null?'completed':phaseForDefinition(result.state.currentStepDefinitionId);
   if(action.kind==='rate')evaluation={actionIntent:'instruction',observation:{kind:result.completedStep.observation.kind,checkpointId:result.completedStep.observation.checkpointId,valid:true,result:{rating:action.rating}},evidenceCandidates:[]};
  }else next=transitionLightweightProtocol(run.protocolVersion,state.phase,action);
  let settlement:ReturnType<LocalProtocolExecution['unsafeTransition']>['settlement']=null;
  let sessionCompletion:ReturnType<LocalProtocolExecution['unsafeTransition']>['sessionCompletion']=null;
  if(action.kind==='rate'){
   if(run.purpose==='initial_learning'&&next==='completed'){
    const completion=initialCompletionContractOf(orchestrationRegistry.get(localRunBinding(run).orchestrationId));
    settlement={kind:'initial_learning_completion',completion};
   }else if(run.purpose==='retention_review'){
    const nextEligibleAt=action.rating==='again'?new Date(new Date(at).getTime()+10*60*1000).toISOString():null;
    settlement={kind:'memory_outcome',schedulerEligibility:'due_review',outcome:{basis:'learner_rated',grade:action.rating,evidenceLevel:'self_report'},relearning:nextEligibleAt?{nextEligibleAt,state:null}:null};
   }else if(next==='waiting'){
    settlement={kind:'relearning_progress',nextEligibleAt:new Date(new Date(at).getTime()+10*60*1000).toISOString(),state:null};
   }else{
    settlement={kind:'relearning_completion',protocolOutcome:'lightweight_rebinding_completed',evidenceLevel:'non_evidentiary'};
   }
   if(run.purpose!=='initial_learning')evaluation={actionIntent:'assessment',observation:{kind:next==='waiting'?'practice_completed':'protocol_completed',checkpointId:null,valid:true,result:{learnerRating:action.rating}},evidenceCandidates:[]};
  }
  if(next==='completed'||next==='waiting'){
   sessionCompletion=next==='completed'?'complete':'pause_for_relearning';
  }else state.phase=next;
  run.protocolState.value=state;
  return {protocolEffects:[],evaluation,settlement,sessionCompletion};
 },
};

const localPhaseDefinitions = {recall:LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_ID,reveal:LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_ID};
const phaseForDefinition=(id:string):'recall'|'reveal'=>{
 const entry=Object.entries(localPhaseDefinitions).find(([,definitionId])=>definitionId===id);
 if(!entry)throw new Error('Unknown persisted lightweight step');
 return entry[0] as 'recall'|'reveal';
};
function localInitialState(run:LocalLearningRun,target:LocalLearningTarget,material?:LocalLearningMaterialization){
 const participant=run.participants[target.id];
 if(!participant)throw new Error('localFlow.resourceInvalid');
 const selected=material??participant.material;
 return createLightweightInitialProtocolRun({protocolRunId:participant.protocolRunId,retentionTargetId:target.retentionId,learningMaterializationId:selected.snapshot.learningMaterializationId,materialResources:selected.content.resources});
}
export function localLightweightStep(run:LocalLearningRun,target:LocalLearningTarget,material?:LocalLearningMaterialization):LightweightProtocolStepInstance|null{
 if(run.completedAt)return null;
 const state=localState(run);
 const selected=localInitialState(run,target,material),initial=state.initial?{...state.initial,learningMaterializationId:selected.learningMaterializationId,materialBindings:selected.materialBindings}:{...selected,currentStepDefinitionId:localPhaseDefinitions[state.phase],currentStepOrdinal:run.ordinal};
 return currentLightweightInitialStep(initial);
}
