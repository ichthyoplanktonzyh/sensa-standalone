/**
 * Pure intake engine for the ubiquitous multimodal intake flow.
 *
 * Every function here is a deterministic state transformation called only by
 * the gateway inside a single command transaction: no IO, no receipts, no
 * persistence. The gateway stays the sole fact writer — it validates the
 * command, hands the engine the current aggregate plus id/clock ports, applies
 * the returned state, records the CommandReceipt and persists.
 *
 * Dual-track routing is deliberately mechanical:
 * - Fast track: Context + complete Expression + Sense + Acceptance.
 * - Slow track: the first missing fact names the Inbox status.
 * The producer (a person or model) owns semantic sufficiency. This receiver
 * never scores the Context, re-runs a model or second-guesses the supplied Sense.
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
} from '@sensa/contracts/sensa';
import { digestOf } from './digest';
import type { JourneyState, MeaningJourneyRecord } from './store';

export const LOCAL_SEMANTIC_POLICY_VERSION = 'sensa-semantic-policy-local-v1';

const PSW = 'sensa-personal-semantic-world-v3' as const;
const REG = 'sensa-semantic-registry-v1' as const;
const LEARNER_USER_ID = 'sensa-local-learner';

type PersonalProvenanceKind =
  SensaPersonalMeaningRevisionSnapshot['provenance']['kind'];

export interface IntakeEnginePorts {
  newId(): string;
  nowIso(): string;
}

export type IntakeRouteDecision =
  | { route: 'fast_track' }
  | { route: 'inbox'; status: SensaIntakeItemStatus };

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

const hasCompleteExpression = (payload: SensaIntakePayload): boolean => {
  const expression = payload.expression;
  return Boolean(expression?.languageTag && expression.occurrence);
};

/**
 * Presence is the entire route decision. Shape contradictions are contract
 * errors before this function runs; semantic adequacy is not a receiver concern.
 */
export const evaluateIntakeRoute = (payload: SensaIntakePayload): IntakeRouteDecision => {
  if (!payload.context) return { route: 'inbox', status: 'pending_context' };
  if (!hasCompleteExpression(payload)) return { route: 'inbox', status: 'pending_expression' };
  if (!payload.sense) return { route: 'inbox', status: 'pending_sense' };
  if (!payload.acceptance) return { route: 'inbox', status: 'pending_acceptance' };
  return { route: 'fast_track' };
};

/** One-line list summary for the Inbox card. */
export const summarizeIntakeContext = (payload: SensaIntakePayload): string => {
  const text = payload.context?.textSegment?.trim() ?? '';
  if (text) return truncateWithEllipsis(text, 42);
  if (payload.context?.mediaReferenceIds.length) return '（媒体材料）';
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
    contractVersion: 'sensa-intake-v3',
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
    sense: input.sense,
    acceptance: { mode: 'learner_direct' },
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
    /** First-party learning adoption pins an already published version rather
     * than following the registry aggregate's current-version pointer. */
    pinnedSense?: { senseId: string; senseVersionId: string };
  },
  ports: IntakeEnginePorts,
): FastTrackOutcome => {
  const decision = evaluateIntakeRoute(input.payload);
  if (decision.route !== 'fast_track') {
    throw new Error('这条摄取材料不满足快轨条件。');
  }
  const { payload, operationId, authority } = input;
  const context = payload.context!;
  const sense = payload.sense!;
  const expression = payload.expression!;
  const occurrence = expression.occurrence!;
  const textSegment = context.textSegment?.trim() ?? '';
  const contextSummary = textSegment
    || context.source?.title
    || '媒体材料';
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
    context.source?.client === 'sensa-web' || !context.source
      ? 'learner_authored'
      : 'imported';
  const structuredPayload: Record<string, unknown> = {
    mediaReferenceIds: [...context.mediaReferenceIds],
    source: context.source,
    languageTag: context.languageTag,
    occurrenceSurfaceForm: occurrence.surfaceForm,
  };

  // 2) Expression Anchor. The absolute language comes from the producer; the
  // receiver does not compare it with a current learning Route.
  const languageTag = expression.languageTag!;
  const expressionType: SensaExpressionType = expression.expressionTypeHint ?? 'word';
  const expressionAnchorId = ports.newId();
  const expressionAnchorRevisionId = ports.newId();

  // 3) The acceptance fact is the audit root for this direct contextual
  //    resolution. No Focus, Construction or Proposal is invented.
  const semanticAcceptanceId = ports.newId();

  // 4) Sense resolution: reuse an existing registry Sense by key first; only
  //    register a new learner-confirmed SenseVersion when nothing matches.
  const senseKey =
    sense.senseKey?.trim()
    || `intake-${digestOf(sense.semanticSpec).slice(0, 24)}`;
  const existingSense = state.registry.senses.find(
    (candidate) => candidate.senseKey === senseKey,
  );
  let senseId: string;
  let senseVersionId: string;
  let resolution: SensaSemanticAcceptanceFact['resolution'];
  let registry = state.registry;
  if (input.pinnedSense) {
    const pinnedSense = state.registry.senses.find(
      (candidate) => candidate.senseId === input.pinnedSense!.senseId,
    );
    const pinnedVersion = state.registry.senseVersions.find(
      (candidate) => candidate.senseVersionId === input.pinnedSense!.senseVersionId,
    );
    if (!pinnedSense || pinnedSense.senseKey !== senseKey
      || !pinnedVersion || pinnedVersion.senseId !== pinnedSense.senseId) {
      throw new Error('固定的已发布 Sense Version 不存在。');
    }
    senseId = pinnedSense.senseId;
    senseVersionId = pinnedVersion.senseVersionId;
    resolution = 'reuse_existing';
  } else if (existingSense) {
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
          semanticSpec: sense.semanticSpec,
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
    occurrence: occurrence.locator,
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
      lifecycleRevision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedByOperationId: null,
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
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      },
    ],
    personalSemanticAnchorRevisions: [
      {
        contractVersion: PSW,
        personalSemanticAnchorRevisionId: semanticAnchorRevisionId,
        personalSemanticAnchorId: semanticAnchorId,
        revision: 1,
        anchorKind: textSegment ? 'text' : context.modality === 'audio' ? 'audio' : 'image',
        languageTag: context.languageTag,
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
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
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
        expressionOccurrence: occurrence.locator,
        resolution,
        senseId,
        senseVersionId,
        resolutionProvenance: structuredClone(sense.resolutionProvenance),
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
