import {
  sensaContentAgentToolDefinitionSchema,
  sensaContentContextArtifactSchema,
  sensaContentProvisioningTaskSnapshotSchema,
  sensaLearningContentContractVersion,
  sensaLightweightReferenceFactSchema,
  type ContentDemandCoverageIssue,
  type SensaContentAgentAttemptBudget,
  type SensaContentAgentAttemptSnapshot,
  type SensaContentAgentToolDefinition,
  type SensaContentProvisioningTaskSnapshot,
  type SensaLightweightReferenceFact,
  type SensaMaterialCandidateBundle,
} from '@sensa/contracts/sensa';
import { canonicalJsonDigest } from '@sensa/learning-kernel';

import {
  type ContentAgentPromptContract,
  type ContentAgentProvisioningModule,
  type ContentAgentToolAdapter,
} from './contentAgentProvisioning';
import {
  admitLightweightInitialCandidateBundle,
  prepareLightweightInitialAgentAttempt,
  type LightweightInitialContentInput,
  type LightweightInitialLearningMaterialization,
} from './lightweightInitialContent';

export const LIGHTWEIGHT_REFERENCE_FACT_LOOKUP_TOOL =
  sensaContentAgentToolDefinitionSchema.parse({
    toolKey: 'lookup_lightweight_reference_facts',
    toolVersion: 'v1',
    description: [
      'Look up available source-backed facts for the fixed target Expression and Sense.',
      'Request only fact kinds that would materially improve the Content Demand.',
      'The result artifacts are authoritative inputs; do not alter their facts.',
    ].join(' '),
    inputSchemaId: 'lightweight.reference-fact-lookup-input',
    inputSchemaVersion: 'v1',
    inputJsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['factKinds'],
      properties: {
        factKinds: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: {
            type: 'string',
            enum: ['pronunciation', 'language_structure', 'usage_example'],
          },
        },
      },
    },
    outputContextKinds: ['reference_fact'],
    outputMaterialRoleKeys: [],
    maxCalls: 1,
  });

const LIGHTWEIGHT_MODEL_MATERIAL_ROLES = Object.freeze([
  'experience_recall_cue',
  'recall_support',
  'language_structure',
  'usage_guidance',
  'scene_bridge',
] as const);

export const lightweightContentAgentPrompt = (
  requireReferenceLookup = false,
): ContentAgentPromptContract => Object.freeze({
  promptPolicyId: 'lightweight.content-agent',
  promptPolicyVersion: 'v1',
  modelMaterialRoleKeys: LIGHTWEIGHT_MODEL_MATERIAL_ROLES,
  instructions: [
    'Produce concise Chinese learning material for a Chinese-speaking learner of English.',
    'experience_recall_cue requires {scene, senseFocus}; it must evoke the original experience or a concrete equivalent scene without exposing the target Expression.',
    'recall_support is optional and uses {text}; at most four, each short, and never exposes the target Expression.',
    'language_structure is optional and uses {expressionKind, expressionTypeLabel, partOfSpeech}; objective labels require a reference-fact artifact when available.',
    'usage_guidance is optional and uses {example}; it must naturally realize the fixed Sense and may use the target Expression because it appears after reveal.',
    'scene_bridge is optional and uses {text}; it reconnects the revealed Expression to the learner scene.',
    'Do not generate target_expression, sense_confirmation or pronunciation. The system owns authoritative passthrough and objective derivation.',
    'Every generated Candidate must cite the fixed Sense artifact and every supporting artifact it actually uses.',
    requireReferenceLookup
      ? 'Live-smoke requirement: call lookup_lightweight_reference_facts once before submission.'
      : 'Call lookup_lightweight_reference_facts only when source-backed facts would improve a useful optional role.',
  ].join('\n'),
});

export interface LightweightReferenceFactRecord {
  readonly source: 'dictionary' | 'corpus' | 'pronunciation_lexicon' | 'other_authoritative_source';
  readonly sourceVersion: string;
  readonly fact: SensaLightweightReferenceFact;
}

export const createLightweightReferenceFactLookupTool = (input: Readonly<{
  facts: readonly LightweightReferenceFactRecord[];
}>): ContentAgentToolAdapter => {
  const facts = input.facts.map((record) => Object.freeze({
    ...record,
    fact: sensaLightweightReferenceFactSchema.parse(record.fact),
  }));
  const adapter: ContentAgentToolAdapter = {
    definition: LIGHTWEIGHT_REFERENCE_FACT_LOOKUP_TOOL,
    execute: async (execution) => {
      const {
        arguments: rawArguments,
        toolCallId,
        request,
        signal,
      } = execution;
      if (signal.aborted) throw new Error('reference_fact_lookup_aborted');
      if (!Array.isArray(rawArguments.factKinds) || rawArguments.factKinds.length === 0) {
        throw new Error('reference_fact_kinds_required');
      }
      const requestedKinds = new Set(rawArguments.factKinds.map((kind) => {
        if (
          kind !== 'pronunciation'
          && kind !== 'language_structure'
          && kind !== 'usage_example'
        ) {
          throw new Error('reference_fact_kind_unsupported');
        }
        return kind;
      }));
      const selected = facts.filter((record) => requestedKinds.has(record.fact.factKind));
      const supportingContextArtifacts = selected.map((record, index) => {
        const payload = record.fact;
        return sensaContentContextArtifactSchema.parse({
          artifactId: `lightweight:${request.contentProvisioningTaskId}:tool:${canonicalJsonDigest({
            toolCallId,
            index,
            payload,
          })}`,
          contextKind: 'reference_fact',
          source: record.source,
          sourceVersion: record.sourceVersion,
          contentSchemaId: 'lightweight.reference-fact',
          contentSchemaVersion: 'v1',
          payload,
          contentDigest: canonicalJsonDigest(payload),
          personalAnchorUseGrantId: null,
          producerToolCallId: toolCallId,
          mediaReference: null,
        });
      });
      return Object.freeze({
        modelPayload: Object.freeze({
          status: 'succeeded',
          facts: supportingContextArtifacts.map((artifact) => ({
            artifactId: artifact.artifactId,
            fact: artifact.payload,
          })),
          unavailableFactKinds: [...requestedKinds].filter((kind) =>
            !selected.some((record) => record.fact.factKind === kind)),
        }),
        supportingContextArtifacts: Object.freeze(supportingContextArtifacts),
        materialCandidates: Object.freeze([]),
      });
    },
  };
  return Object.freeze(adapter);
};

export type LightweightAgenticProvisioningResult =
  | Readonly<{
      status: 'ready';
      task: SensaContentProvisioningTaskSnapshot;
      attempt: SensaContentAgentAttemptSnapshot;
      bundle: SensaMaterialCandidateBundle;
      materialization: LightweightInitialLearningMaterialization;
      issues: readonly [];
    }>
  | Readonly<{
      status: 'blocked';
      task: SensaContentProvisioningTaskSnapshot;
      attempt: SensaContentAgentAttemptSnapshot;
      bundle: SensaMaterialCandidateBundle | null;
      materialization: null;
      issues: readonly ContentDemandCoverageIssue[];
    }>;

export const provisionLightweightInitialContentWithAgent = async (input: Readonly<{
  contentInput: LightweightInitialContentInput;
  agentModule: ContentAgentProvisioningModule;
  approvedTools: readonly SensaContentAgentToolDefinition[];
  attemptSequence?: number;
  priorTask?: SensaContentProvisioningTaskSnapshot;
  attemptBudget?: SensaContentAgentAttemptBudget;
  requireReferenceLookup?: boolean;
  now?: () => string;
}>): Promise<LightweightAgenticProvisioningResult> => {
  const priorTask = input.priorTask
    ? sensaContentProvisioningTaskSnapshotSchema.parse(input.priorTask)
    : null;
  const attemptSequence = input.attemptSequence ?? ((priorTask?.attemptIds.length ?? 0) + 1);
  const preparation = prepareLightweightInitialAgentAttempt(input.contentInput, {
    attemptSequence,
    approvedTools: input.approvedTools,
    attemptBudget: input.attemptBudget ?? {
      maxModelTurns: 6,
      maxToolCalls: 4,
      timeoutMs: 90_000,
    },
  });
  if (priorTask) {
    if (
      priorTask.contentProvisioningTaskId !== preparation.request.contentProvisioningTaskId
      || priorTask.learningTargetId !== preparation.request.learningTargetId
      || priorTask.resolvedLearningPlanRevisionId
        !== preparation.request.resolvedLearningPlanRevisionId
      || priorTask.protocolPurpose !== preparation.request.protocolPurpose
      || priorTask.protocolId !== preparation.request.protocolId
      || priorTask.protocolVersion !== preparation.request.protocolVersion
      || priorTask.demandReference.contentDemandKey
        !== preparation.request.demandReference.contentDemandKey
      || priorTask.demandReference.definitionVersion
        !== preparation.request.demandReference.definitionVersion
    ) {
      throw new Error('A retry must preserve the fixed Content Provisioning Task identity.');
    }
    if (priorTask.status !== 'blocked') {
      throw new Error('Only a blocked Content Provisioning Task can create a retry Attempt.');
    }
    if (attemptSequence !== priorTask.attemptIds.length + 1) {
      throw new Error('A retry Attempt sequence must follow the Task Attempt history.');
    }
  }
  const agentResult = await input.agentModule.run({
    request: preparation.request,
    attemptSequence,
    baseCandidates: preparation.baseCandidates,
    prompt: lightweightContentAgentPrompt(input.requireReferenceLookup),
  });
  const taskWithAttemptHistory = (
    task: SensaContentProvisioningTaskSnapshot,
  ): SensaContentProvisioningTaskSnapshot => sensaContentProvisioningTaskSnapshotSchema.parse({
    ...task,
    attemptIds: [
      ...(priorTask?.attemptIds ?? []),
      ...task.attemptIds,
    ],
    createdAt: priorTask?.createdAt ?? task.createdAt,
  });
  if (agentResult.status === 'blocked') {
    return Object.freeze({
      status: 'blocked',
      task: taskWithAttemptHistory(agentResult.task),
      attempt: agentResult.attempt,
      bundle: null,
      materialization: null,
      issues: Object.freeze([]),
    });
  }
  const admission = admitLightweightInitialCandidateBundle(
    preparation.request,
    agentResult.bundle,
  );
  const updatedAt = input.now?.() ?? new Date().toISOString();
  if (admission.status !== 'ready') {
    const task = sensaContentProvisioningTaskSnapshotSchema.parse({
      ...taskWithAttemptHistory(agentResult.task),
      status: 'blocked',
      blockedReasonCode: `candidate_bundle_${admission.status}`,
      updatedAt,
    });
    return Object.freeze({
      status: 'blocked',
      task,
      attempt: agentResult.attempt,
      bundle: agentResult.bundle,
      materialization: null,
      issues: admission.issues,
    });
  }
  const task = sensaContentProvisioningTaskSnapshotSchema.parse({
    ...taskWithAttemptHistory(agentResult.task),
    status: 'ready',
    learningMaterializationId: admission.materialization.snapshot.learningMaterializationId,
    blockedReasonCode: null,
    updatedAt,
  });
  return Object.freeze({
    status: 'ready',
    task,
    attempt: agentResult.attempt,
    bundle: agentResult.bundle,
    materialization: admission.materialization,
    issues: Object.freeze([] as const),
  });
};

export const lightweightAgenticProvisioningContractVersion =
  `${sensaLearningContentContractVersion}:lightweight-agentic-v1` as const;
