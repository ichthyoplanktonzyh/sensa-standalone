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
 * - Fast track: context + located expression + a teaching-sufficient sense +
 *   verified acceptance materialize into a complete PersonalMeaning (Anchor
 *   + Expression + direct Sense Alignment + Binding) in one atomic step.
 * - Slow track: anything missing goes to the Inbox as a draft item waiting for
 *   an expression occurrence, a resolved Sense or Semantic Acceptance.
 */

import type {
  SensaExpressionType,
  SensaIntakeItem,
  SensaIntakeItemStatus,
  SensaIntakePayload,
  SensaIntakeSense,
  SensaPersonalExpressionAnchorRevisionSnapshot,
  SensaPersonalMeaningAlignmentEvent,
  SensaPersonalMeaningAlignmentSnapshot,
  SensaPersonalMeaningRevisionSnapshot,
  SensaSemanticAcceptanceAuthority,
  SensaSemanticAcceptanceFact,
  SensaSenseSemanticSpec,
} from '@sensa/contracts/sensa';
import { sensaLanguageRolesForTag } from '@sensa/contracts/sensa';
import { digestOf } from './digest';
import type { CommandLanguages } from './ports';
import type { JourneyState, MeaningJourneyRecord } from './store';

export const LOCAL_SEMANTIC_POLICY_VERSION = 'sensa-semantic-policy-local-v1';

const PSW = 'sensa-personal-semantic-world-v2' as const;
const REG = 'sensa-semantic-registry-v1' as const;
const SPEC_SCHEMA = 'sensa-sense-semantic-spec-v1' as const;
const LEARNER_USER_ID = 'sensa-local-learner';

type PersonalProvenanceKind =
  SensaPersonalMeaningRevisionSnapshot['provenance']['kind'];

export interface IntakeEnginePorts {
  newId(): string;
  nowIso(): string;
  /** The pair this operation is about, pinned once by the gateway before any
   * route decision. A captured expression states its own language; whether that
   * language sits on a side of this learner's boundary is a question only the
   * profile can answer, and this engine performs no IO of its own. */
  languages: CommandLanguages;
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
  bindingCandidate: {
    candidateId: string;
    expressionType: SensaExpressionType;
    languageTag: string;
    surfaceForm: string;
    provenanceKind: PersonalProvenanceKind;
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

const hasLocatedExpression = (payload: SensaIntakePayload): boolean => {
  const expression = payload.expression;
  const occurrence = expression?.occurrence;
  if (!expression || !occurrence) return false;
  if (occurrence.kind === 'media_region') {
    return payload.context.mediaReferenceIds.includes(occurrence.mediaReferenceId);
  }
  const text = payload.context.textSegment;
  if (!text || occurrence.end > text.length) return false;
  return normalizedForm(text.slice(occurrence.start, occurrence.end))
    === normalizedForm(expression.surfaceForm);
};

/**
 * Mechanical route decision. Fast track needs all three elements with an
 * expression whose language this learner's boundary can place, a resolved sense
 * and a verified acceptance request. The captured text or referenced media
 * becomes the prototype scene. Pure-audio payloads are rejected for this
 * milestone: the contract keeps the enum, the local media store has no audio
 * support yet.
 *
 * The language comes before the sense because it is the more fundamental gap: a
 * resolved sense for material in a language this operation is not about still
 * cannot be written, so reporting `pending_sense` there would name the wrong
 * thing to fix.
 */
export const evaluateIntakeRoute = (
  payload: SensaIntakePayload,
  languages: CommandLanguages,
): IntakeRouteDecision => {
  if (payload.context.modality === 'audio') {
    return { route: 'rejected', reason: '本地原型暂不支持纯音频材料。' };
  }
  const text = payload.context.textSegment?.trim() ?? '';
  if (!text && payload.context.mediaReferenceIds.length === 0) {
    return { route: 'rejected', reason: '摄取材料缺少可用的上下文内容。' };
  }
  const hasExpression = hasLocatedExpression(payload);
  const hasPlacedLanguage = sensaLanguageRolesForTag(
    payload.expression?.languageTag ?? null,
    languages,
  ).length>0;
  const hasResolvedSense =
    payload.sense != null
    && payload.sense.resolutionStatus === 'resolved'
    && payload.sense.definitionSummary.trim().length > 0;
  if (hasExpression && hasPlacedLanguage && hasResolvedSense && payload.acceptanceRequest) {
    return { route: 'fast_track' };
  }
  if (!hasExpression) return { route: 'inbox', status: 'pending_expression' };
  if (!hasPlacedLanguage) return { route: 'inbox', status: 'pending_language' };
  if (!hasResolvedSense) return { route: 'inbox', status: 'pending_sense' };
  return {
    route: 'inbox',
    status: 'pending_acceptance',
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
  languages: CommandLanguages,
): SensaIntakeItem => {
  const decision = evaluateIntakeRoute(payload, languages);
  if (decision.route !== 'inbox') {
    throw new Error('这条摄取材料不应该进入待处理材料盒。');
  }
  return {
    contractVersion: 'sensa-intake-v2',
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
    authority: SensaSemanticAcceptanceAuthority;
  },
  ports: IntakeEnginePorts,
): FastTrackOutcome => {
  const item = state.inboxItems.find(
    (candidate) => candidate.intakeId === input.intakeId,
  );
  if (!item) throw new Error('找不到这条待处理材料。');
  const payload: SensaIntakePayload = {
    ...item.payload,
    sense: { ...input.sense, resolutionStatus: 'resolved' },
    acceptanceRequest: { mode: 'learner_direct' },
  };
  const outcome = executeFastTrack(
    state,
    { payload, operationId: input.operationId, authority: input.authority },
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
    authority: SensaSemanticAcceptanceAuthority;
  },
  ports: IntakeEnginePorts,
): FastTrackOutcome => {
  const decision = evaluateIntakeRoute(input.payload, ports.languages);
  if (decision.route !== 'fast_track') {
    throw new Error('这条摄取材料不满足快轨条件。');
  }
  const { payload, operationId, authority } = input;
  const sense = payload.sense!;
  const expression = payload.expression!;
  const textSegment = payload.context.textSegment?.trim() ?? '';
  const contextSummary = textSegment
    || payload.context.source?.title
    || '图像材料';
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

  // 2) Expression Anchor for the captured word. The capture states the exact
  //    language it is in. A tag this operation cannot place never
  //    reaches here — `evaluateIntakeRoute` sends it to the Inbox as
  //    `pending_language` — so the throw is a guard, not a fallback.
  if (sensaLanguageRolesForTag(expression.languageTag,ports.languages).length===0) {
    throw new Error('这条摄取材料的语言不在本次操作的语对中。');
  }
  const languageTag = expression.languageTag!;
  const expressionType: SensaExpressionType = expression.expressionTypeHint ?? 'word';
  const expressionAnchorId = ports.newId();
  const expressionAnchorRevisionId = ports.newId();

  // 3) The acceptance fact is the audit root for this direct contextual
  //    resolution. No Focus, Construction or Proposal is invented.
  const semanticAcceptanceId = ports.newId();

  const buildSemanticSpec = (): SensaSenseSemanticSpec => ({
    schemaVersion: SPEC_SCHEMA,
    coreMeaningFocus: sense.definitionSummary.trim(),
    // The captured context sentence becomes the single prototype scene.
    prototypeScenes: [
      {
        summary: contextSummary,
        participantRoles: [],
        states: [],
        directionOrCausality: null,
      },
    ],
    includedCases: [contextSummary],
    excludedCases: [],
    neighborContrasts: [],
    openQuestions: [],
  });

  // 4) Sense resolution: reuse an existing registry Sense by key first; only
  //    register a new learner-confirmed SenseVersion when nothing matches.
  const senseKey =
    sense.senseKey?.trim()
    || `intake-${digestOf(sense.definitionSummary.trim()).slice(0, 24)}`;
  const existingSense = state.registry.senses.find(
    (candidate) => candidate.senseKey === senseKey,
  );
  let senseId: string;
  let senseVersionId: string;
  let resolution: SensaSemanticAcceptanceFact['resolution'];
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
            sourceReferenceIds: [semanticAcceptanceId],
            generator: null,
          },
          reviewStatus: 'learner_confirmed',
          contentReleaseId: null,
          createdAt: now,
        },
      ],
    };
  }

  // 5) Semantic Acceptance + Alignment facts.
  const personalMeaningAlignmentId = ports.newId();
  const personalMeaningAlignmentEventId = ports.newId();

  const expressionAnchorRevision: SensaPersonalExpressionAnchorRevisionSnapshot = {
    contractVersion: PSW,
    personalExpressionAnchorRevisionId: expressionAnchorRevisionId,
    personalExpressionAnchorId: expressionAnchorId,
    revision: 1,
    expressionType,
    languageTag,
    surfaceForm: expression.surfaceForm.trim(),
    normalizedForm: normalizedForm(expression.surfaceForm),
    contextAnchorRevisionId: semanticAnchorRevisionId,
    occurrence: expression.occurrence,
    provenanceKind,
    // The accepted tuple is tracked by the Semantic Acceptance fact.
    verificationStatus: 'learner_confirmed',
    provenance: {
      kind: provenanceKind,
      sourceReferenceIds: [semanticAcceptanceId],
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
        displayLabel: truncateWithEllipsis(contextSummary, 24),
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
        anchorKind: textSegment ? 'text' : 'image',
        languageTag: null,
        bodyText: textSegment || null,
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
    focuses: [],
    focusRevisions: [],
    focusAcceptances: [],
    constructions: [],
    constructionTurns: [],
    proposals: [],
    proposalVersions: [],
    senseConfirmations: [],
    semanticAcceptances: [
      {
        contractVersion: PSW,
        semanticAcceptanceId,
        operationId,
        learnerUserId: LEARNER_USER_ID,
        authority,
        personalSemanticAnchorRevisionId: semanticAnchorRevisionId,
        personalExpressionAnchorRevisionId: expressionAnchorRevisionId,
        expressionOccurrence: expression.occurrence!,
        resolution,
        senseId,
        senseVersionId,
        resolutionProvenance: {
          resolverKind: sense.wordingSource === 'learner_authored'
            ? 'learner'
            : sense.wordingSource === 'llm_suggested'
              ? 'language_model'
              : 'external_tool',
          provider: payload.context.source?.client ?? 'sensa-local-intake',
          model: null,
          policyVersion: LOCAL_SEMANTIC_POLICY_VERSION,
          sourceReferenceIds: [payload.intakeOperationId],
        },
        acceptedAt: now,
      },
    ],
    alignments: [
      {
        contractVersion: PSW,
        personalMeaningAlignmentId,
        learnerUserId: LEARNER_USER_ID,
        personalMeaningId,
        personalMeaningRevisionId,
        basis: {
          kind: 'contextual_resolution',
          semanticAcceptanceId,
        },
        senseId,
        senseVersionId,
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
    bindingCandidate: {
      candidateId: semanticAcceptanceId,
      expressionType,
      languageTag,
      surfaceForm: expression.surfaceForm.trim(),
      provenanceKind,
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
