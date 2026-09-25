import {resourcePlanFromArtifacts,roleAllowedByResourcePlan,completedRevealResourcePlan} from '@sensa/contracts/sensa';
import {
  LEARNING_RESOURCE_DEFINITIONS,
  LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY,
  LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION,
  LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,
  SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,
  assembleContentDemandMaterialization,
  lightweightInitialRolePayloadSchema,
  sensaContentContextArtifactSchema,
  sensaContentGenerationRequestSchema,
  sensaLearningConnectionContractVersion,
  sensaLearningContentContractVersion,
  sensaLearningMaterializationSnapshotSchema,
  sensaLightweightExpressionSnapshotSchema,
  sensaLightweightInitialMaterializationContentSchema,
  sensaLightweightOriginExperienceSchema,
  sensaLightweightReferenceFactSchema,
  sensaLightweightSenseSnapshotSchema,
  sensaMaterialCandidateBundleSchema,
  sensaMaterialCandidateSchema,
  sensaMaterialCandidateValidationSchema,
  type ContentDemandCoverageIssue,
  type SensaContentAgentAttemptBudget,
  type SensaContentAgentToolDefinition,
  type SensaContentContextArtifact,
  type SensaContentContextSource,
  type SensaContentGenerationRequest,
  type SensaContentProductionMethod,
  type SensaLearningMaterializationSnapshot,
  type SensaLightweightExpressionSnapshot,
  type SensaLightweightInitialMaterializationContent,
  type SensaLightweightInitialMaterialRole,
  type SensaLightweightOriginExperience,
  type SensaLightweightReferenceFact,
  type SensaLightweightSenseSnapshot,
  type SensaMaterialCandidate,
  type SensaMaterialCandidateBundle,
  type SensaMaterialCandidateValidation,
  type SensaMaterializedResource,
} from '@sensa/contracts/sensa';
import { canonicalJsonDigest, stableUuid } from '@sensa/learning-kernel';

export interface LightweightInitialReferenceFactInput {
  readonly source: Extract<
    SensaContentContextSource,
    'dictionary' | 'corpus' | 'pronunciation_lexicon' | 'other_authoritative_source'
  >;
  readonly sourceVersion: string;
  readonly fact: SensaLightweightReferenceFact;
}

export interface LightweightInitialOriginExperienceInput {
  readonly source: Extract<
    SensaContentContextSource,
    'personal_anchor' | 'other_authoritative_source'
  >;
  readonly sourceVersion: string;
  readonly personalAnchorUseGrantId: string | null;
  readonly experience: SensaLightweightOriginExperience;
}

/** Authority-owned values accepted by the provisioning module. No UI model crosses this seam. */
export interface LightweightInitialContentInput {
  readonly learnerUserId: string;
  readonly learningTargetId: string;
  readonly senseId: string;
  readonly senseVersionId: string;
  readonly senseExpressionBindingId: string;
  readonly resolvedLearningPlanRevisionId: string;
  readonly expressionSourceVersion: string;
  readonly senseSourceVersion: string;
  readonly expression: SensaLightweightExpressionSnapshot;
  readonly sense: SensaLightweightSenseSnapshot;
  readonly originExperience: LightweightInitialOriginExperienceInput | null;
  readonly referenceFacts: readonly LightweightInitialReferenceFactInput[];
  readonly requestedAt: string;
}

export interface LightweightInitialLearningMaterialization {
  readonly snapshot: SensaLearningMaterializationSnapshot;
  readonly content: SensaLightweightInitialMaterializationContent;
}

export type LightweightInitialProvisioningResult =
  | Readonly<{
      status: 'ready';
      materialization: LightweightInitialLearningMaterialization;
      issues: readonly [];
    }>
  | Readonly<{
      status: 'incomplete' | 'invalid';
      materialization: null;
      issues: readonly ContentDemandCoverageIssue[];
    }>;

type FrozenContext = Readonly<{
  request: SensaContentGenerationRequest;
  expressionArtifact: SensaContentContextArtifact;
  senseArtifact: SensaContentContextArtifact;
  experienceArtifact: SensaContentContextArtifact | null;
  referenceArtifacts: readonly SensaContentContextArtifact[];
}>;

export interface LightweightInitialAgentAttemptPreparation {
  readonly request: SensaContentGenerationRequest;
  readonly baseCandidates: readonly SensaMaterialCandidate[];
}

type CandidateDraft = Readonly<{
  materialRoleKey: SensaLightweightInitialMaterialRole;
  ordinal: number;
  contentPayload: Record<string, unknown>;
  sourceArtifactIds: readonly string[];
  sourceMaterialCandidateIds?: readonly string[];
  productionMethod: SensaContentProductionMethod;
  producerProvider: string;
  producerModel: string | null;
  producerPolicyId: string;
}>;

interface CandidateProducer {
  readonly produce: (
    context: FrozenContext,
    acceptedCandidates: readonly SensaMaterialCandidate[],
  ) => readonly CandidateDraft[];
}

const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(objectValue)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const artifact = (input: Readonly<{
  requestSeed: string;
  ordinal: number;
  contextKind: string;
  source: SensaContentContextSource;
  sourceVersion: string;
  contentSchemaId: string;
  payload: Record<string, unknown>;
  personalAnchorUseGrantId: string | null;
}>): SensaContentContextArtifact => ({
  artifactId: `lightweight:${input.requestSeed}:artifact:${input.ordinal}`,
  contextKind: input.contextKind,
  source: input.source,
  sourceVersion: input.sourceVersion,
  contentSchemaId: input.contentSchemaId,
  contentSchemaVersion: 'v1',
  payload: input.payload,
  contentDigest: canonicalJsonDigest(input.payload),
  personalAnchorUseGrantId: input.personalAnchorUseGrantId,
  producerToolCallId: null,
  mediaReference: null,
});

const freezeContext = (input: LightweightInitialContentInput): FrozenContext => {
  const expression = sensaLightweightExpressionSnapshotSchema.parse(input.expression);
  const sense = sensaLightweightSenseSnapshotSchema.parse(input.sense);
  const originExperience = input.originExperience
    ? {
        ...input.originExperience,
        experience: sensaLightweightOriginExperienceSchema.parse(
          input.originExperience.experience,
        ),
      }
    : null;
  const referenceFacts = input.referenceFacts.map((reference) => ({
    ...reference,
    fact: sensaLightweightReferenceFactSchema.parse(reference.fact),
  }));
  const requestSeed = canonicalJsonDigest({
    learningTargetId: input.learningTargetId,
    demand: `${LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY}@${LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION}`,
    expression,
    sense,
    originExperience,
    referenceFacts,
  });
  const expressionArtifact = artifact({
    requestSeed,
    ordinal: 0,
    contextKind: 'expression_snapshot',
    source: 'target_expression',
    sourceVersion: input.expressionSourceVersion,
    contentSchemaId: 'lightweight.expression-snapshot',
    payload: expression,
    personalAnchorUseGrantId: null,
  });
  const senseArtifact = artifact({
    requestSeed,
    ordinal: 1,
    contextKind: 'sense_snapshot',
    source: 'confirmed_sense',
    sourceVersion: input.senseSourceVersion,
    contentSchemaId: 'lightweight.sense-snapshot',
    payload: sense,
    personalAnchorUseGrantId: null,
  });
  const experienceArtifact = originExperience
    ? artifact({
        requestSeed,
        ordinal: 2,
        contextKind: 'origin_experience',
        source: originExperience.source,
        sourceVersion: originExperience.sourceVersion,
        contentSchemaId: 'lightweight.origin-experience',
        payload: originExperience.experience,
        personalAnchorUseGrantId: originExperience.personalAnchorUseGrantId,
      })
    : null;
  const referenceArtifacts = referenceFacts.map((reference, index) => artifact({
    requestSeed,
    ordinal: index + 3,
    contextKind: 'reference_fact',
    source: reference.source,
    sourceVersion: reference.sourceVersion,
    contentSchemaId: 'lightweight.reference-fact',
    payload: reference.fact,
    personalAnchorUseGrantId: null,
  }));
  const request = sensaContentGenerationRequestSchema.parse({
    contractVersion: sensaLearningContentContractVersion,
    contentProvisioningTaskId: stableUuid(`lightweight:task:${requestSeed}`),
    contentAgentAttemptId: stableUuid(`lightweight:attempt:${requestSeed}:1`),
    contentGenerationRequestId: stableUuid(
      `lightweight:request:${requestSeed}:${input.requestedAt}`,
    ),
    idempotencyKey: `lightweight-initial:${requestSeed}`,
    learnerUserId: input.learnerUserId,
    learningTargetId: input.learningTargetId,
    senseId: input.senseId,
    senseVersionId: input.senseVersionId,
    senseExpressionBindingId: input.senseExpressionBindingId,
    resolvedLearningPlanRevisionId: input.resolvedLearningPlanRevisionId,
    profileId: 'lightweight',
    profileVersion: 'lightweight-profile-v3',
    protocolPurpose: 'initial_learning',
    protocolId: 'lightweight-study',
    protocolVersion: 'v3',
    provisioningPath: 'on_demand',
    demandReference: {
      contentDemandKey: LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY,
      definitionVersion: LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION,
    },
    demand: SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,
    contextArtifacts: [
      expressionArtifact,
      senseArtifact,
      ...(experienceArtifact ? [experienceArtifact] : []),
      ...referenceArtifacts,
    ],
    approvedTools: [],
    attemptBudget: {
      maxModelTurns: 1,
      maxToolCalls: 0,
      timeoutMs: 30_000,
    },
    generatorPolicyId: 'lightweight.content-orchestration',
    generatorPolicyVersion: 'v1',
    requestedAt: input.requestedAt,
  });
  return contextFromRequest(request);
};

const contextFromRequest = (
  rawRequest: SensaContentGenerationRequest,
  supportingContextArtifacts: readonly SensaContentContextArtifact[] = [],
): FrozenContext => {
  const request = sensaContentGenerationRequestSchema.parse(rawRequest);
  const artifacts = [
    ...request.contextArtifacts,
    ...supportingContextArtifacts.map((candidate) =>
      sensaContentContextArtifactSchema.parse(candidate)),
  ];
  const expressionArtifacts = artifacts.filter((candidate) =>
    candidate.contextKind === 'expression_snapshot');
  const senseArtifacts = artifacts.filter((candidate) =>
    candidate.contextKind === 'sense_snapshot');
  const experienceArtifacts = artifacts.filter((candidate) =>
    candidate.contextKind === 'origin_experience');
  if (expressionArtifacts.length !== 1 || senseArtifacts.length !== 1) {
    throw new Error('Lightweight Initial requires exactly one Expression and Sense artifact.');
  }
  if (experienceArtifacts.length > 1) {
    throw new Error('Lightweight Initial accepts at most one origin Experience artifact.');
  }
  return deepFreeze({
    request,
    expressionArtifact: expressionArtifacts[0]!,
    senseArtifact: senseArtifacts[0]!,
    experienceArtifact: experienceArtifacts[0] ?? null,
    referenceArtifacts: artifacts.filter((candidate) =>
      candidate.contextKind === 'reference_fact'),
  });
};

/** Standalone payload available to a future model adapter without application-code access. */
export const createLightweightInitialGenerationRequest = (
  input: LightweightInitialContentInput,
): SensaContentGenerationRequest => freezeContext(input).request;

export const prepareLightweightInitialAgentAttempt = (
  input: LightweightInitialContentInput,
  options: Readonly<{
    attemptSequence: number;
    approvedTools: readonly SensaContentAgentToolDefinition[];
    attemptBudget: SensaContentAgentAttemptBudget;
  }>,
): LightweightInitialAgentAttemptPreparation => {
  if (!Number.isInteger(options.attemptSequence) || options.attemptSequence < 1) {
    throw new Error('Lightweight Content Agent Attempt sequence must be a positive integer.');
  }
  const baseContext = freezeContext(input);
  const request = sensaContentGenerationRequestSchema.parse({
    ...baseContext.request,
    contentAgentAttemptId: stableUuid(
      `lightweight:attempt:${baseContext.request.contentProvisioningTaskId}:${options.attemptSequence}`,
    ),
    contentGenerationRequestId: stableUuid(
      `lightweight:request:${baseContext.request.contentProvisioningTaskId}:${options.attemptSequence}`,
    ),
    idempotencyKey: `${baseContext.request.idempotencyKey}:attempt:${options.attemptSequence}`,
    approvedTools: options.approvedTools,
    attemptBudget: options.attemptBudget,
    generatorPolicyId: 'lightweight.agentic-content-orchestration',
    generatorPolicyVersion: 'v1',
  });
  const context = contextFromRequest(request);
  const baseCandidates = authoritativeProducer.produce(context, []).map((draft) =>
    candidateFromDraft(context, draft));
  return deepFreeze({ request, baseCandidates });
};

const authoritativeProducer: CandidateProducer = {
  produce: (context) => [
    {
      materialRoleKey: 'target_expression',
      ordinal: 0,
      contentPayload: {
        ...sensaLightweightExpressionSnapshotSchema.parse(context.expressionArtifact.payload),
      },
      sourceArtifactIds: [context.expressionArtifact.artifactId],
      productionMethod: 'deterministic_transform',
      producerProvider: 'sensa-authority',
      producerModel: null,
      producerPolicyId: 'lightweight.authoritative-passthrough',
    },
    {
      materialRoleKey: 'sense_confirmation',
      ordinal: 0,
      contentPayload: {
        meaning: sensaLightweightSenseSnapshotSchema.parse(
          context.senseArtifact.payload,
        ).meaning,
      },
      sourceArtifactIds: [context.senseArtifact.artifactId],
      productionMethod: 'deterministic_transform',
      producerProvider: 'sensa-authority',
      producerModel: null,
      producerPolicyId: 'lightweight.authoritative-passthrough',
    },
  ],
};

const pedagogicalProducer: CandidateProducer = {
  produce: (context) => {
    const expression = sensaLightweightExpressionSnapshotSchema.parse(
      context.expressionArtifact.payload,
    );
    const sense = sensaLightweightSenseSnapshotSchema.parse(context.senseArtifact.payload);
    const experience = context.experienceArtifact
      ? sensaLightweightOriginExperienceSchema.parse(context.experienceArtifact.payload)
      : null;
    const sourceArtifactIds = experience
      ? [context.senseArtifact.artifactId, context.experienceArtifact!.artifactId]
      : [context.senseArtifact.artifactId];
    const candidates: CandidateDraft[] = [{
      materialRoleKey: 'experience_recall_cue',
      ordinal: 0,
      contentPayload: experience
        ? {
            scene: experience.scene,
            senseFocus: experience.senseFocus,
            ...(experience.images?.length ? { images: experience.images } : {}),
          }
        : {
            scene: `想象一个与你有关的具体时刻：${sense.meaning}`,
            senseFocus: sense.meaning,
          },
      sourceArtifactIds,
      productionMethod: 'deterministic_transform',
      producerProvider: 'sensa-prototype-deterministic',
      producerModel: null,
      producerPolicyId: 'lightweight.pedagogical-provisioning',
    }];
    const recallSupport = experience?.featureLabels.length
      ? experience.featureLabels
      : ['具体场景', '意义焦点'];
    recallSupport.forEach((text, ordinal) => candidates.push({
      materialRoleKey: 'recall_support',
      ordinal,
      contentPayload: { text },
      sourceArtifactIds,
      productionMethod: 'deterministic_transform',
      producerProvider: 'sensa-prototype-deterministic',
      producerModel: null,
      producerPolicyId: 'lightweight.pedagogical-provisioning',
    }));

    const structureArtifact = context.referenceArtifacts.find((candidate) =>
      candidate.payload.factKind === 'language_structure');
    if (structureArtifact) {
      const fact = sensaLightweightReferenceFactSchema.parse(structureArtifact.payload);
      if (fact.factKind === 'language_structure') {
        candidates.push({
          materialRoleKey: 'language_structure',
          ordinal: 0,
          contentPayload: {
            expressionKind: expression.expressionKind,
            expressionTypeLabel: fact.expressionTypeLabel,
            partOfSpeech: fact.partOfSpeech,
            usagePattern: fact.usagePattern ?? null,
            contrastNote: fact.contrastNote ?? null,
          },
          sourceArtifactIds: [context.senseArtifact.artifactId, structureArtifact.artifactId],
          productionMethod: 'deterministic_transform',
          producerProvider: 'sensa-prototype-deterministic',
          producerModel: null,
          producerPolicyId: 'lightweight.pedagogical-provisioning',
        });
      }
    }
    const usageArtifacts = context.referenceArtifacts.filter((candidate) =>
      candidate.payload.factKind === 'usage_example');
    usageArtifacts.forEach((usageArtifact, ordinal) => {
      const fact = sensaLightweightReferenceFactSchema.parse(usageArtifact.payload);
      if (fact.factKind === 'usage_example') {
        candidates.push({
          materialRoleKey: 'usage_guidance',
          ordinal,
          contentPayload: {
            example: fact.example,
            translation: fact.translation ?? null,
            audioUrl: fact.audioUrl ?? null,
          },
          sourceArtifactIds: [context.senseArtifact.artifactId, usageArtifact.artifactId],
          productionMethod: 'deterministic_transform',
          producerProvider: 'sensa-prototype-deterministic',
          producerModel: null,
          producerPolicyId: 'lightweight.pedagogical-provisioning',
        });
      }
    });
    if (experience?.sceneBridge) {
      candidates.push({
        materialRoleKey: 'scene_bridge',
        ordinal: 0,
        contentPayload: { text: experience.sceneBridge },
        sourceArtifactIds: [context.senseArtifact.artifactId, context.experienceArtifact!.artifactId],
        productionMethod: 'deterministic_transform',
        producerProvider: 'sensa-prototype-deterministic',
        producerModel: null,
        producerPolicyId: 'lightweight.pedagogical-provisioning',
      });
    }
    if (experience?.sceneRealization) candidates.push({
      materialRoleKey:'scene_realization', ordinal:0,
      contentPayload:{...experience.sceneRealization,experienceResourceKey:'experience_recall_cue:0'},
      sourceArtifactIds, productionMethod:'deterministic_transform',producerProvider:'sensa-published-resource',producerModel:null,producerPolicyId:'lightweight.pedagogical-provisioning',
    });
    const mnemonic=context.referenceArtifacts.find(a=>a.payload.factKind==='mnemonic');
    if(mnemonic){const {factKind,...payload}=mnemonic.payload;candidates.push({materialRoleKey:'mnemonic',ordinal:0,contentPayload:payload,sourceArtifactIds:[context.senseArtifact.artifactId,mnemonic.artifactId],productionMethod:'published_reuse',producerProvider:'sensa-editorial',producerModel:null,producerPolicyId:'lightweight.pedagogical-provisioning'});}
    return candidates;
  },
};

/** No TTS is performed here. Only an already sourced pronunciation fact may pass this adapter. */
const objectiveResourceProducer: CandidateProducer = {
  produce: (context, acceptedCandidates) => context.referenceArtifacts.flatMap(reference => {
    const fact = sensaLightweightReferenceFactSchema.parse(reference.payload);
    const key = fact.factKind as SensaLightweightInitialMaterialRole;
    if (!Object.hasOwn(LEARNING_RESOURCE_DEFINITIONS,key) || LEARNING_RESOURCE_DEFINITIONS[key].generation !== 'source') return [];
    const {factKind,...payload}=fact;
    return [{materialRoleKey:key,ordinal:0,contentPayload:payload,sourceArtifactIds:[reference.artifactId],sourceMaterialCandidateIds:acceptedCandidates.filter(c=>c.materialRoleKey==='target_expression').map(c=>c.materialCandidateId),productionMethod:'external_tool' as const,producerProvider:'sensa-reference-fact-adapter',producerModel:null,producerPolicyId:'lightweight.objective-derivation'}];
  }),
};

const materialRoleDefinition = (role: SensaLightweightInitialMaterialRole) => {
  const definition = SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles.find(
    (candidate) => candidate.materialRoleKey === role,
  );
  if (!definition) throw new Error(`Unknown Lightweight Initial material role: ${role}`);
  return definition;
};

const candidateFromDraft = (
  context: FrozenContext,
  draft: CandidateDraft,
): SensaMaterialCandidate => {
  const role = materialRoleDefinition(draft.materialRoleKey);
  const identitySeed = canonicalJsonDigest({
    requestId: context.request.contentGenerationRequestId,
    role: draft.materialRoleKey,
    ordinal: draft.ordinal,
    payload: draft.contentPayload,
  });
  return sensaMaterialCandidateSchema.parse({
    contractVersion: sensaLearningContentContractVersion,
    materialCandidateId: stableUuid(`lightweight:candidate:${identitySeed}`),
    contentGenerationRequestId: context.request.contentGenerationRequestId,
    materialRoleKey: draft.materialRoleKey,
    ordinal: draft.ordinal,
    contentSchemaId: role.contentSchemaId,
    contentSchemaVersion: role.contentSchemaVersion,
    contentPayload: draft.contentPayload,
    contentDigest: canonicalJsonDigest(draft.contentPayload),
    sourceArtifactIds: draft.sourceArtifactIds,
    sourceMaterialCandidateIds: draft.sourceMaterialCandidateIds ?? [],
    productionMethod: draft.productionMethod,
    producerProvider: draft.producerProvider,
    producerModel: draft.producerModel,
    producerPolicyId: draft.producerPolicyId,
    producerPolicyVersion: 'v1',
    producedAt: context.request.requestedAt,
  });
};

const payloadStrings = (value: unknown): readonly string[] => {
  if (typeof value === 'string') {
    // Encoded media is opaque binary data. Scanning its base64 characters as
    // learner-facing prose can randomly "find" a short target form and reject
    // an otherwise valid recall cue; names and alt text remain ordinary fields
    // and are still checked.
    return /^data:[^;,]+;base64,/u.test(value) ? [] : [value];
  }
  if (Array.isArray(value)) return value.flatMap(payloadStrings);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(payloadStrings);
  }
  return [];
};

const containsExpression = (value: string, expression: string): boolean => {
  const normalize = (text: string): string => text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
  const normalizedExpression = normalize(expression);
  return normalizedExpression.length > 0 && normalize(value).includes(normalizedExpression);
};

const authoritativeBindingPasses = (
  context: FrozenContext,
  candidate: SensaMaterialCandidate,
): boolean => {
  if (candidate.materialRoleKey === 'target_expression') {
    const source = sensaLightweightExpressionSnapshotSchema.parse(
      context.expressionArtifact.payload,
    );
    return candidate.sourceArtifactIds.length === 1
      && candidate.sourceArtifactIds[0] === context.expressionArtifact.artifactId
      && canonicalJsonDigest(candidate.contentPayload) === canonicalJsonDigest(source);
  }
  if (candidate.materialRoleKey === 'sense_confirmation') {
    const source = sensaLightweightSenseSnapshotSchema.parse(context.senseArtifact.payload);
    return candidate.sourceArtifactIds.length === 1
      && candidate.sourceArtifactIds[0] === context.senseArtifact.artifactId
      && candidate.contentPayload.meaning === source.meaning;
  }
  return false;
};

const objectiveDerivationBindingPasses = (
  context: FrozenContext, candidate: SensaMaterialCandidate, candidates: readonly SensaMaterialCandidate[],
): boolean => {
  if (candidate.productionMethod === 'model_generation') return false;
  return context.referenceArtifacts.some(reference => {
    const {factKind,...payload}=reference.payload;
    return factKind === candidate.materialRoleKey && candidate.sourceArtifactIds.includes(reference.artifactId)
      && canonicalJsonDigest(candidate.contentPayload) === canonicalJsonDigest(payload);
  });
};

const validatorPasses = (
  validatorPolicyId: string,
  context: FrozenContext,
  candidate: SensaMaterialCandidate,
  candidates: readonly SensaMaterialCandidate[],
): boolean => {
  if (validatorPolicyId === 'lightweight.schema') {
    return lightweightInitialRolePayloadSchema(
      candidate.materialRoleKey as SensaLightweightInitialMaterialRole,
    ).safeParse(candidate.contentPayload).success
      && candidate.contentDigest === canonicalJsonDigest(candidate.contentPayload);
  }
  if (validatorPolicyId === 'lightweight.authoritative-binding') {
    return authoritativeBindingPasses(context, candidate);
  }
  if (validatorPolicyId === 'lightweight.sense-alignment') {
    return candidate.sourceArtifactIds.includes(context.senseArtifact.artifactId);
  }
  if (validatorPolicyId === 'lightweight.pre-reveal-non-disclosure') {
    const expression = sensaLightweightExpressionSnapshotSchema.parse(
      context.expressionArtifact.payload,
    ).surface;
    return !payloadStrings(candidate.contentPayload).some((value) =>
      containsExpression(value, expression));
  }
  if (validatorPolicyId === 'lightweight.objective-derivation-binding') {
    return objectiveDerivationBindingPasses(context, candidate, candidates);
  }
  return false;
};

const validateCandidate = (
  context: FrozenContext,
  candidate: SensaMaterialCandidate,
  candidates: readonly SensaMaterialCandidate[],
): SensaMaterialCandidateValidation => {
  const role = materialRoleDefinition(
    candidate.materialRoleKey as SensaLightweightInitialMaterialRole,
  );
  const validatorResults = role.validatorPolicies.map((validator) => {
    const passed = validatorPasses(
      validator.validatorPolicyId,
      context,
      candidate,
      candidates,
    );
    return {
      validatorPolicyId: validator.validatorPolicyId,
      validatorVersion: validator.validatorVersion,
      status: passed ? 'passed' as const : 'failed' as const,
      issueCodes: passed ? [] : [`${validator.validatorPolicyId}.failed`],
    };
  });
  return sensaMaterialCandidateValidationSchema.parse({
    contractVersion: sensaLearningContentContractVersion,
    materialCandidateValidationId: stableUuid(
      `lightweight:validation:${candidate.materialCandidateId}`,
    ),
    materialCandidateId: candidate.materialCandidateId,
    status: validatorResults.every((result) => result.status === 'passed')
      ? 'accepted'
      : 'rejected',
    validatorResults,
    validatedAt: context.request.requestedAt,
  });
};

const produceCandidates = (context: FrozenContext): readonly SensaMaterialCandidate[] => {
  const accepted: SensaMaterialCandidate[] = [];
  for (const producer of [
    authoritativeProducer,
    pedagogicalProducer,
    objectiveResourceProducer,
  ]) {
    const drafts = producer.produce(context, accepted).filter(draft=>roleAllowedByResourcePlan(resourcePlanFromArtifacts(context.request.contextArtifacts),draft.materialRoleKey));
    accepted.push(...drafts.map((draft) => candidateFromDraft(context, draft)));
  }
  return Object.freeze(accepted);
};

const materializeLightweightInitialCandidates = (
  context: FrozenContext,
  candidates: readonly SensaMaterialCandidate[],
  supportingContextArtifacts: readonly SensaContentContextArtifact[],
  materialCandidateBundleId: string | null,
): LightweightInitialProvisioningResult => {
  const validations = candidates.map((candidate) =>
    validateCandidate(context, candidate, candidates));
  const assembly = assembleContentDemandMaterialization({
    request: context.request,
    supportingContextArtifacts,
    candidates,
    validations,
  });
  if (assembly.status !== 'satisfied') {
    return deepFreeze({
      status: assembly.status,
      materialization: null,
      issues: assembly.issues,
    });
  }
  const content = deepFreeze(
    sensaLightweightInitialMaterializationContentSchema.parse({...assembly.content,resourcePlan:completedRevealResourcePlan(resourcePlanFromArtifacts(context.request.contextArtifacts),assembly.content.resources)}),
  );
  const materializationIdentitySeed = canonicalJsonDigest({
    learningTargetId: context.request.learningTargetId,
    demandReference: {
      contentDemandKey: content.contentDemandKey,
      definitionVersion: content.definitionVersion,
    },
    content,
  });
  const personalAnchorUseGrantIds = [
    ...context.request.contextArtifacts,
    ...supportingContextArtifacts,
  ].flatMap((contextArtifact) => contextArtifact.personalAnchorUseGrantId
    ? [contextArtifact.personalAnchorUseGrantId]
    : []);
  const snapshot = sensaLearningMaterializationSnapshotSchema.parse({
    contractVersion: sensaLearningConnectionContractVersion,
    learningMaterializationId: stableUuid(
      `lightweight:materialization:${materializationIdentitySeed}`,
    ),
    learnerUserId: context.request.learnerUserId,
    learningTargetId: context.request.learningTargetId,
    protocolPurpose: 'initial_learning',
    provisioningPath: context.request.provisioningPath,
    contentSchemaVersion: LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,
    contentPayload: content,
    contentDigest: canonicalJsonDigest(content),
    validationStatus: 'validated',
    validatorVersion: 'lightweight.materialization-admission-v1',
    provenance: {
      contentProvisioningTaskId: context.request.contentProvisioningTaskId,
      contentAgentAttemptId: context.request.contentAgentAttemptId,
      materialCandidateBundleId,
      demandReference: context.request.demandReference,
      contentGenerationRequestId: context.request.contentGenerationRequestId,
      profileId: context.request.profileId,
      profileVersion: context.request.profileVersion,
      protocolId: context.request.protocolId,
      protocolVersion: context.request.protocolVersion,
      generatorPolicyId: context.request.generatorPolicyId,
      generatorPolicyVersion: context.request.generatorPolicyVersion,
      supportingContextArtifactIds: supportingContextArtifacts.map((artifact) =>
        artifact.artifactId),
      candidateIds: candidates.map((candidate) => candidate.materialCandidateId),
      validationIds: validations.map((validation) =>
        validation.materialCandidateValidationId),
      assemblyPolicyId: SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.assemblyPolicyId,
      assemblyPolicyVersion: SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.assemblyPolicyVersion,
    },
    personalAnchorUseGrantIds,
    createdAt: context.request.requestedAt,
  });
  return deepFreeze({
    status: 'ready',
    issues: [],
    materialization: { snapshot, content },
  });
};

export const admitLightweightInitialCandidateBundle = (
  rawRequest: SensaContentGenerationRequest,
  rawBundle: SensaMaterialCandidateBundle,
): LightweightInitialProvisioningResult => {
  const request = sensaContentGenerationRequestSchema.parse(rawRequest);
  const bundle = sensaMaterialCandidateBundleSchema.parse(rawBundle);
  if (
    bundle.contentProvisioningTaskId !== request.contentProvisioningTaskId
    || bundle.contentAgentAttemptId !== request.contentAgentAttemptId
    || bundle.contentGenerationRequestId !== request.contentGenerationRequestId
    || bundle.inputSnapshotDigest !== canonicalJsonDigest(request)
  ) {
    throw new Error('Material Candidate Bundle does not belong to the fixed provisioning Attempt.');
  }
  const countByRole = new Map<string, number>();
  bundle.candidates.forEach((candidate) => countByRole.set(
    candidate.materialRoleKey,
    (countByRole.get(candidate.materialRoleKey) ?? 0) + 1,
  ));
  const omissionByRole = new Map(bundle.omissions.map((omission) => [
    omission.materialRoleKey,
    omission,
  ]));
  const omissionIssues: ContentDemandCoverageIssue[] = [];
  for (const role of request.demand.materialRoles) {
    const count = countByRole.get(role.materialRoleKey) ?? 0;
    const omitted = omissionByRole.has(role.materialRoleKey);
    if (!role.required && count === 0 && !omitted) {
      omissionIssues.push({
        code: 'material_role_omission_missing',
        materialRoleKey: role.materialRoleKey,
        materialCandidateId: null,
      });
    }
    if ((role.required && omitted) || (count > 0 && omitted)) {
      omissionIssues.push({
        code: 'material_role_omission_invalid',
        materialRoleKey: role.materialRoleKey,
        materialCandidateId: null,
      });
    }
  }
  if (omissionIssues.length > 0) {
    return deepFreeze({ status: 'invalid', materialization: null, issues: omissionIssues });
  }
  const context = contextFromRequest(request, bundle.supportingContextArtifacts);
  return materializeLightweightInitialCandidates(
    context,
    bundle.candidates,
    bundle.supportingContextArtifacts,
    bundle.materialCandidateBundleId,
  );
};

/**
 * Context freeze → candidate producers → validators → Demand admission → immutable Materialization.
 * A future AI adapter replaces only the pedagogical producer behind the same pinned contract.
 */
export const provisionLightweightInitialContent = (
  input: LightweightInitialContentInput,
): LightweightInitialProvisioningResult => {
  const context = freezeContext(input);
  const candidates = produceCandidates(context);
  return materializeLightweightInitialCandidates(context, candidates, [], null);
};

export const validateLightweightInitialMaterialization = (
  materialization: LightweightInitialLearningMaterialization,
): void => {
  const snapshot = sensaLearningMaterializationSnapshotSchema.parse(materialization.snapshot);
  const content = sensaLightweightInitialMaterializationContentSchema.parse(
    materialization.content,
  );
  if (
    snapshot.validationStatus !== 'validated'
    || snapshot.contentSchemaVersion !== LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION
  ) {
    throw new Error('Learning Materialization is not validated for Lightweight Initial v1.');
  }
  if (
    snapshot.contentDigest !== canonicalJsonDigest(content)
    || canonicalJsonDigest(snapshot.contentPayload) !== canonicalJsonDigest(content)
    || content.resources.some((resource) =>
      resource.contentDigest !== canonicalJsonDigest(resource.contentPayload))
  ) {
    throw new Error('Learning Materialization content does not match its immutable snapshot.');
  }
};

export const lightweightMaterializedResourcesForRole = (
  materialization: LightweightInitialLearningMaterialization,
  role: SensaLightweightInitialMaterialRole,
): readonly SensaMaterializedResource[] => Object.freeze(
  materialization.content.resources.filter((resource) => resource.materialRoleKey === role),
);
