/**
 * Pure intake engine for the ubiquitous multimodal intake flow.
 *
 * Every function here is a deterministic state transformation called only by
 * the gateway inside a single command transaction: no IO, no receipts, no
 * persistence. The gateway stays the sole fact writer — it validates the
 * command, hands the engine the current aggregate plus id/clock ports, applies
 * the returned state, records the CommandReceipt and persists.
 *
 * Dual-track routing:
 * - Fast track: context + expression + a learner-confirmed sense materialize
 *   into a complete PersonalMeaning (Anchor + Expression + Focus + Sense
 *   Alignment + Binding) in one atomic step, with no AI interview.
 * - Slow track: anything missing goes to the Inbox as a draft item, either
 *   `pending_sense` or `pending_expression`.
 */

import type {
  SensaConfirmSenseProposalFact,
  SensaExpressionType,
  SensaIntakeItem,
  SensaIntakeItemStatus,
  SensaIntakePayload,
  SensaIntakeSense,
  SensaPersonalExpressionAnchorRevisionSnapshot,
  SensaPersonalMeaningAlignmentEvent,
  SensaPersonalMeaningAlignmentSnapshot,
  SensaPersonalMeaningRevisionSnapshot,
  SensaSenseSemanticSpec,
} from '@sensa/contracts/sensa';
import { digestOf } from './digest';
import type { JourneyState, MeaningJourneyRecord } from './store';

export const LOCAL_SEMANTIC_POLICY_VERSION = 'sensa-semantic-policy-local-v1';

const PSW = 'sensa-personal-semantic-world-v1' as const;
const REG = 'sensa-semantic-registry-v1' as const;
const SPEC_SCHEMA = 'sensa-sense-semantic-spec-v1' as const;
const LEARNER_USER_ID = 'sensa-local-learner';
const FAMILIAR_LANG = 'zh-CN';
const TARGET_LANG = 'en';
const INTAKE_GENERATOR_PROVIDER = 'local';
const INTAKE_GENERATOR_MODEL = 'sensa-intake-fast-track';
const INTAKE_GENERATOR_PROMPT_VERSION = 'sensa-intake-fast-track-v1';

type PersonalProvenanceKind =
  SensaPersonalMeaningRevisionSnapshot['provenance']['kind'];

export interface IntakeEnginePorts {
  newId(): string;
  nowIso(): string;
}

export type IntakeRouteDecision =
  | { route: 'fast_track' }
  | { route: 'inbox'; status: SensaIntakeItemStatus }
  | { route: 'rejected'; reason: string };

export interface FastTrackOutcome {
  nextState: JourneyState;
  record: MeaningJourneyRecord;
  personalMeaningId: string;
  alignment: SensaPersonalMeaningAlignmentSnapshot;
  senseProposalVersionId: string;
  bindingCandidate: {
    candidateId: string;
    expressionType: SensaExpressionType;
    languageTag: string;
    surfaceForm: string;
  };
  bindingInput: {
    senseVersionId: string;
    surfaceForm: string;
    languageTag: string;
    expressionType: SensaExpressionType;
    relation: 'realizes';
    semanticCoverage: 'exact';
  };
}

const truncateWithEllipsis = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const normalizedForm = (surfaceForm: string): string =>
  surfaceForm.trim().toLocaleLowerCase();

/**
 * Mechanical route decision. Fast track needs all three elements with an
 * explicitly learner-confirmed sense and a text context (the captured sentence
 * becomes the display label and the only prototype scene). Pure-audio payloads
 * are rejected for this milestone: the contract keeps the enum, the local
 * media store has no audio support yet.
 */
export const evaluateIntakeRoute = (
  payload: SensaIntakePayload,
): IntakeRouteDecision => {
  if (payload.context.modality === 'audio') {
    return { route: 'rejected', reason: '本地原型暂不支持纯音频材料。' };
  }
  const text = payload.context.textSegment?.trim() ?? '';
  if (!text && payload.context.mediaReferenceIds.length === 0) {
    return { route: 'rejected', reason: '摄取材料缺少可用的上下文内容。' };
  }
  const hasText = text.length > 0;
  const hasExpression =
    payload.expression != null
    && payload.expression.surfaceForm.trim().length > 0;
  const hasConfirmedSense =
    payload.sense != null
    && payload.sense.confirmationStatus === 'user_confirmed'
    && payload.sense.definitionSummary.trim().length > 0;
  if (hasText && hasExpression && hasConfirmedSense) {
    return { route: 'fast_track' };
  }
  // Missing the target word is the shallower gap for triage: the learner can
  // pick a word later more easily than they can reconstruct a meaning.
  return {
    route: 'inbox',
    status: hasExpression ? 'pending_sense' : 'pending_expression',
  };
};

/** One-line list summary for the Inbox card. */
export const summarizeIntakeContext = (payload: SensaIntakePayload): string => {
  const text = payload.context.textSegment?.trim() ?? '';
  if (text) return truncateWithEllipsis(text, 42);
  if (payload.context.mediaReferenceIds.length > 0) return '（图片材料）';
  return '（空白材料）';
};

/** Pure factory for a slow-track Inbox draft item. */
export const createInboxItem = (
  payload: SensaIntakePayload,
  intakeId: string,
  nowIso: string,
): SensaIntakeItem => {
  const decision = evaluateIntakeRoute(payload);
  if (decision.route !== 'inbox') {
    throw new Error('这条摄取材料不应该进入待处理材料盒。');
  }
  return {
    contractVersion: 'sensa-intake-v1',
    intakeId,
    status: decision.status,
    summaryView: summarizeIntakeContext(payload),
    payload,
    createdAt: nowIso,
  };
};

/** Pure removal of one Inbox item; throws when the item is unknown. */
export const dismissInboxItem = (
  state: JourneyState,
  intakeId: string,
): JourneyState => {
  const remaining = state.inboxItems.filter((item) => item.intakeId !== intakeId);
  if (remaining.length === state.inboxItems.length) {
    throw new Error('找不到这条待处理材料。');
  }
  return { ...state, inboxItems: remaining };
};

/**
 * Slow-track promotion: fill the confirmed sense into the stored payload and
 * run the same atomic fast-track materialization, then drop the item from the
 * Inbox. Reuses `executeFastTrack`, so the promoted meaning is indistinguishable
 * from a directly fast-tracked one.
 */
export const resolveInboxItemWithSense = (
  state: JourneyState,
  input: {
    intakeId: string;
    sense: SensaIntakeSense;
    operationId: string;
  },
  ports: IntakeEnginePorts,
): FastTrackOutcome => {
  const item = state.inboxItems.find(
    (candidate) => candidate.intakeId === input.intakeId,
  );
  if (!item) throw new Error('找不到这条待处理材料。');
  const payload: SensaIntakePayload = {
    ...item.payload,
    sense: { ...input.sense, confirmationStatus: 'user_confirmed' },
  };
  const outcome = executeFastTrack(
    state,
    { payload, operationId: input.operationId },
    ports,
  );
  return {
    ...outcome,
    nextState: {
      ...outcome.nextState,
      inboxItems: outcome.nextState.inboxItems.filter(
        (candidate) => candidate.intakeId !== input.intakeId,
      ),
    },
  };
};

/**
 * Atomic fast-track materialization. Returns a brand-new aggregate; the input
 * state is never mutated. The returned `bindingInput`/`bindingCandidate` pair
 * is meant to be handed straight into the gateway's shared expression-binding
 * core, which owns the registry Expression/Binding writes.
 */
export const executeFastTrack = (
  state: JourneyState,
  input: {
    payload: SensaIntakePayload;
    operationId: string;
  },
  ports: IntakeEnginePorts,
): FastTrackOutcome => {
  const decision = evaluateIntakeRoute(input.payload);
  if (decision.route !== 'fast_track') {
    throw new Error('这条摄取材料不满足快轨条件。');
  }
  const { payload, operationId } = input;
  const sense = payload.sense!;
  const expression = payload.expression!;
  const textSegment = payload.context.textSegment!.trim();
  const now = ports.nowIso();

  // Provenance mapping is mechanical: the wording source travels unchanged
  // into every fact's provenance kind, so LLM/词典 wording is never
  // disguised as learner-authored text.
  const provenanceKind: PersonalProvenanceKind = sense.wordingSource;

  const personalMeaningId = ports.newId();
  const personalMeaningRevisionId = ports.newId();

  // 1) Semantic Anchor: the captured context itself.
  const semanticAnchorId = ports.newId();
  const semanticAnchorRevisionId = ports.newId();
  const contextAnchorProvenanceKind: PersonalProvenanceKind =
    payload.context.source ? 'imported' : 'learner_authored';
  const structuredPayload: Record<string, unknown> = {
    mediaReferenceIds: [...payload.context.mediaReferenceIds],
    source: payload.context.source,
  };

  // 2) Target/Familiar Expression Anchor for the captured word.
  const isTargetRole = expression.languageRole === 'target';
  const languageTag = isTargetRole ? TARGET_LANG : FAMILIAR_LANG;
  const expressionType: SensaExpressionType = expression.expressionTypeHint ?? 'word';
  const expressionAnchorId = ports.newId();
  const expressionAnchorRevisionId = ports.newId();
  const bindingCandidateId = ports.newId();

  // 3) Meaning Focus, born accepted: the learner confirmed this statement.
  const meaningFocusId = ports.newId();
  const meaningFocusRevisionId = ports.newId();
  const meaningFocusAcceptanceId = ports.newId();

  // 4) Construction + Proposal bookkeeping. The fast track involves no AI
  //    interview; the minimal completed chain exists so the Sense confirmation
  //    fact can reference a proposal version, and its generator provenance
  //    honestly names the local intake engine.
  const senseConstructionId = ports.newId();
  const senseProposalId = ports.newId();
  const senseProposalVersionId = ports.newId();
  const generatorInputDigest = digestOf(payload);
  const generatorOutputDigest = digestOf(sense.definitionSummary);

  const buildSemanticSpec = (): SensaSenseSemanticSpec => ({
    schemaVersion: SPEC_SCHEMA,
    coreMeaningFocus: sense.definitionSummary.trim(),
    // The captured context sentence becomes the single prototype scene.
    prototypeScenes: [
      {
        summary: textSegment,
        participantRoles: [],
        states: [],
        directionOrCausality: null,
      },
    ],
    includedCases: [textSegment],
    excludedCases: [],
    neighborContrasts: [],
    openQuestions: [],
  });

  // 5) Sense resolution: reuse an existing registry Sense by key first; only
  //    register a new learner-confirmed SenseVersion when nothing matches.
  const senseKey =
    sense.senseKey?.trim()
    || `intake-${digestOf(sense.definitionSummary.trim()).slice(0, 24)}`;
  const existingSense = state.registry.senses.find(
    (candidate) => candidate.senseKey === senseKey,
  );
  let senseId: string;
  let senseVersionId: string;
  let resolution: SensaConfirmSenseProposalFact['resolution'];
  let registry = state.registry;
  if (existingSense) {
    senseId = existingSense.senseId;
    senseVersionId = existingSense.currentSenseVersionId;
    resolution = 'reuse_existing';
  } else {
    senseId = ports.newId();
    senseVersionId = ports.newId();
    resolution = 'create_new';
    registry = {
      ...state.registry,
      senses: [
        ...state.registry.senses,
        {
          contractVersion: REG,
          senseId,
          senseKey,
          currentSenseVersionId: senseVersionId,
          currentVersionNumber: 1,
          createdAt: now,
        },
      ],
      senseVersions: [
        ...state.registry.senseVersions,
        {
          contractVersion: REG,
          senseVersionId,
          senseId,
          versionNumber: 1,
          origin: 'learner_confirmed',
          semanticPolicyVersion: LOCAL_SEMANTIC_POLICY_VERSION,
          semanticSpec: buildSemanticSpec(),
          provenance: {
            sourceKind: 'learner_confirmed',
            sourceReferenceIds: [senseProposalVersionId],
            generator: {
              provider: INTAKE_GENERATOR_PROVIDER,
              model: INTAKE_GENERATOR_MODEL,
              promptVersion: INTAKE_GENERATOR_PROMPT_VERSION,
              policyVersion: LOCAL_SEMANTIC_POLICY_VERSION,
              inputDigest: generatorInputDigest,
              outputDigest: generatorOutputDigest,
            },
          },
          reviewStatus: 'learner_confirmed',
          contentReleaseId: null,
          createdAt: now,
        },
      ],
    };
  }

  // 6) Sense confirmation + Alignment facts.
  const senseProposalConfirmationId = ports.newId();
  const personalMeaningAlignmentId = ports.newId();
  const personalMeaningAlignmentEventId = ports.newId();

  const expressionAnchorRevision: SensaPersonalExpressionAnchorRevisionSnapshot = {
    contractVersion: PSW,
    personalExpressionAnchorRevisionId: expressionAnchorRevisionId,
    personalExpressionAnchorId: expressionAnchorId,
    revision: 1,
    expressionType,
    languageTag,
    learnerLanguageRole: isTargetRole ? 'target' : 'familiar',
    surfaceForm: expression.surfaceForm.trim(),
    normalizedForm: normalizedForm(expression.surfaceForm),
    provenanceKind,
    // The learner explicitly confirmed this word + sense pairing on capture.
    verificationStatus: 'learner_confirmed',
    provenance: {
      kind: provenanceKind,
      sourceReferenceIds: [bindingCandidateId],
      createdByOperationId: operationId,
    },
    createdAt: now,
  };

  const record: MeaningJourneyRecord = {
    personalMeaning: {
      contractVersion: PSW,
      personalMeaningId,
      learnerUserId: LEARNER_USER_ID,
      currentRevision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    personalMeaningRevisions: [
      {
        contractVersion: PSW,
        personalMeaningRevisionId,
        personalMeaningId,
        revision: 1,
        // No familiar anchor exists on the fast track; the label falls back
        // to the captured context sentence.
        displayLabel: truncateWithEllipsis(textSegment, 24),
        learnerIntentNote: null,
        provenance: {
          kind: provenanceKind,
          sourceReferenceIds: [semanticAnchorId, expressionAnchorId],
          createdByOperationId: operationId,
        },
        createdAt: now,
      },
    ],
    personalSemanticAnchors: [
      {
        contractVersion: PSW,
        personalSemanticAnchorId: semanticAnchorId,
        personalMeaningId,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    personalSemanticAnchorRevisions: [
      {
        contractVersion: PSW,
        personalSemanticAnchorRevisionId: semanticAnchorRevisionId,
        personalSemanticAnchorId: semanticAnchorId,
        revision: 1,
        anchorKind: 'text',
        languageTag: null,
        bodyText: textSegment,
        personalMediaObjectId: null,
        structuredPayload,
        provenance: {
          kind: contextAnchorProvenanceKind,
          sourceReferenceIds: [semanticAnchorId],
          createdByOperationId: operationId,
        },
        createdAt: now,
      },
    ],
    personalExpressionAnchors: [
      {
        contractVersion: PSW,
        personalExpressionAnchorId: expressionAnchorId,
        personalMeaningId,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    personalExpressionAnchorRevisions: [expressionAnchorRevision],
    focuses: [
      {
        contractVersion: PSW,
        meaningFocusId,
        personalMeaningId,
        splitFromMeaningFocusId: null,
        currentRevision: 1,
        acceptedRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    focusRevisions: [
      {
        contractVersion: PSW,
        meaningFocusRevisionId,
        meaningFocusId,
        revision: 1,
        statement: sense.definitionSummary.trim(),
        distinguishingNotes: [],
        provenance: {
          kind: provenanceKind,
          sourceReferenceIds: [personalMeaningId],
          createdByOperationId: operationId,
        },
        createdAt: now,
      },
    ],
    focusAcceptances: [
      {
        contractVersion: PSW,
        meaningFocusAcceptanceId,
        meaningFocusId,
        meaningFocusRevisionId,
        operationId,
        acceptedAt: now,
      },
    ],
    constructions: [
      {
        contractVersion: PSW,
        senseConstructionId,
        learnerUserId: LEARNER_USER_ID,
        personalMeaningId,
        personalMeaningRevisionId,
        meaningFocusId,
        meaningFocusRevisionId,
        familiarLanguageTag: FAMILIAR_LANG,
        targetLanguageTag: TARGET_LANG,
        semanticPolicyVersion: LOCAL_SEMANTIC_POLICY_VERSION,
        status: 'completed',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    // No interview happened; the construction carries zero turns.
    constructionTurns: [],
    proposals: [
      {
        contractVersion: PSW,
        senseProposalId,
        senseConstructionId,
        currentVersion: 1,
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
      },
    ],
    proposalVersions: [
      {
        contractVersion: PSW,
        senseProposalVersionId,
        senseProposalId,
        version: 1,
        meaningFocusRevisionId,
        semanticSpec: buildSemanticSpec(),
        expressionCandidates: [
          {
            candidateId: bindingCandidateId,
            personalExpressionAnchorRevisionId: expressionAnchorRevisionId,
            expressionType,
            languageTag,
            surfaceForm: expression.surfaceForm.trim(),
            rationale: '来自摄取材料的表达',
          },
        ],
        unresolvedQuestions: [],
        semanticPolicyVersion: LOCAL_SEMANTIC_POLICY_VERSION,
        generatorProvenance: {
          provider: INTAKE_GENERATOR_PROVIDER,
          model: INTAKE_GENERATOR_MODEL,
          promptVersion: INTAKE_GENERATOR_PROMPT_VERSION,
          inputDigest: generatorInputDigest,
          outputDigest: generatorOutputDigest,
        },
        createdAt: now,
      },
    ],
    senseConfirmations: [
      {
        contractVersion: PSW,
        senseProposalConfirmationId,
        operationId,
        learnerUserId: LEARNER_USER_ID,
        senseProposalVersionId,
        meaningFocusRevisionId,
        resolution,
        senseId,
        senseVersionId,
        confirmedAt: now,
      },
    ],
    alignments: [
      {
        contractVersion: PSW,
        personalMeaningAlignmentId,
        learnerUserId: LEARNER_USER_ID,
        personalMeaningId,
        personalMeaningRevisionId,
        meaningFocusId,
        meaningFocusRevisionId,
        senseId,
        senseVersionId,
        senseProposalConfirmationId,
        status: 'active',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    alignmentEvents: [
      {
        contractVersion: PSW,
        personalMeaningAlignmentEventId,
        personalMeaningAlignmentId,
        ordinal: 1,
        eventType: 'confirmed',
        operationId,
        reason: null,
        occurredAt: now,
      } satisfies SensaPersonalMeaningAlignmentEvent,
    ],
    bindingConfirmations: [],
    mockState: {
      focusAspectLabels: {},
      startingPoint: null,
    },
  };

  const nextState: JourneyState = {
    ...state,
    registry,
    meanings: [...state.meanings, record],
  };

  return {
    nextState,
    record,
    personalMeaningId,
    alignment: record.alignments[0]!,
    senseProposalVersionId,
    bindingCandidate: {
      candidateId: bindingCandidateId,
      expressionType,
      languageTag,
      surfaceForm: expression.surfaceForm.trim(),
    },
    bindingInput: {
      senseVersionId,
      surfaceForm: expression.surfaceForm.trim(),
      languageTag,
      expressionType,
      relation: 'realizes',
      semanticCoverage: 'exact',
    },
  };
};
