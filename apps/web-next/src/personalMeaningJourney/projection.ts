/**
 * Pure read-model projection for the Personal Meaning journey.
 *
 * Phases are derived from authoritative snapshots and confirmation facts. The
 * mock adapter state only supplies suggestions and presentation hints; it can
 * never advance a domain phase by itself.
 */

import type {
  SensaSenseExpressionBindingVersionSnapshot,
  SensaSenseVersionSnapshot,
} from '@sensa/contracts/sensa';
import type { MeaningJourneyRecord, SenseRegistryState } from './store';
import type {
  JourneyAlignmentView,
  JourneyConstructionView,
  JourneyDetailView,
  JourneyExperienceAnchorView,
  JourneyMaterialBlockView,
  JourneyFamiliarAnchorView,
  JourneyFocusView,
  JourneyListItemView,
  JourneyProposalView,
  JourneyExpressionBindingView,
  JourneySemanticSpecView,
  JourneySenseFormationView,
  ExpressionBindingPhase,
  SenseFormationPhase,
  PersonalMeaningJourneyPhase,
  JourneyWorldItemView,
} from './types';

const PHASE_ORDER: PersonalMeaningJourneyPhase[] = [
  'unclarified',
  'focus_suggested',
  'focus_pending_acceptance',
  'focus_accepted',
  'constructing',
  'proposal_ready',
  'sense_confirmed_expression_pending',
  'aligned',
];

const furthestPhase = (
  phases: PersonalMeaningJourneyPhase[],
): PersonalMeaningJourneyPhase =>
  phases.reduce<PersonalMeaningJourneyPhase>((furthest, phase) => (
    PHASE_ORDER.indexOf(phase) > PHASE_ORDER.indexOf(furthest) ? phase : furthest
  ), 'unclarified');

export const shortId = (id: string): string => id.split('-')[0].toUpperCase();

const currentMeaningRevision = (record: MeaningJourneyRecord) =>
  record.personalMeaningRevisions
    .find((revision) => revision.revision === record.personalMeaning.currentRevision)
  ?? record.personalMeaningRevisions[record.personalMeaningRevisions.length - 1]
  ?? null;

const currentFocusRevision = (record: MeaningJourneyRecord, focusId: string) => {
  const focus = record.focuses.find((item) => item.meaningFocusId === focusId);
  if (!focus) return null;
  return record.focusRevisions.find(
    (revision) =>
      revision.meaningFocusId === focusId
      && revision.revision === focus.currentRevision,
  ) ?? null;
};

const activeAlignmentForFocus = (record: MeaningJourneyRecord, focusId: string) =>
  record.alignments.find(
    (alignment) =>
      alignment.meaningFocusId === focusId && alignment.status === 'active',
  ) ?? null;

const latestConstructionForFocus = (record: MeaningJourneyRecord, focusId: string) =>
  record.constructions
    .filter((construction) => construction.meaningFocusId === focusId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;

const proposalForConstruction = (
  record: MeaningJourneyRecord,
  senseConstructionId: string,
) =>
  record.proposals.find(
    (proposal) => proposal.senseConstructionId === senseConstructionId,
  ) ?? null;

const proposalVersion = (
  record: MeaningJourneyRecord,
  senseProposalId: string,
  versionNumber: number,
) =>
  record.proposalVersions.find(
    (version) =>
      version.senseProposalId === senseProposalId
      && version.version === versionNumber,
  ) ?? null;

const latestProposalVersion = (
  record: MeaningJourneyRecord,
  proposalId: string,
) =>
  record.proposalVersions
    .filter((version) => version.senseProposalId === proposalId)
    .sort((left, right) => right.version - left.version)[0] ?? null;

const senseVersionById = (
  registry: SenseRegistryState,
  senseVersionId: string,
): SensaSenseVersionSnapshot | null =>
  registry.senseVersions.find((version) => version.senseVersionId === senseVersionId)
  ?? null;

const bindingVersionById = (
  registry: SenseRegistryState,
  bindingVersionId: string,
): SensaSenseExpressionBindingVersionSnapshot | null =>
  registry.bindingVersions.find((version) => version.bindingVersionId === bindingVersionId)
  ?? null;

const confirmedCandidateIds = (record: MeaningJourneyRecord): Set<string> => {
  const anchorRevisionById = new Map(
    record.personalExpressionAnchorRevisions.map((revision) => [
      revision.personalExpressionAnchorRevisionId,
      revision,
    ]),
  );
  const ids = new Set<string>();
  for (const binding of record.bindingConfirmations) {
    const anchorRevision = anchorRevisionById.get(
      binding.personalExpressionAnchorRevisionId,
    );
    for (const sourceReferenceId of anchorRevision?.provenance.sourceReferenceIds ?? []) {
      ids.add(sourceReferenceId);
    }
  }
  return ids;
};

const focusIdForBinding = (
  record: MeaningJourneyRecord,
  binding: MeaningJourneyRecord['bindingConfirmations'][number],
): string | null => {
  if (!binding.senseProposalVersionId) return null;
  const proposalVersion = record.proposalVersions.find(
    (version) => version.senseProposalVersionId === binding.senseProposalVersionId,
  );
  if (!proposalVersion) return null;
  const proposal = record.proposals.find(
    (item) => item.senseProposalId === proposalVersion.senseProposalId,
  );
  if (!proposal) return null;
  return record.constructions.find(
    (construction) => construction.senseConstructionId === proposal.senseConstructionId,
  )?.meaningFocusId ?? null;
};

/**
 * Read only the current version of each Binding identity for one confirmed
 * Focus. Older confirmation facts remain in the store for audit/replay, but
 * they are not current edges in the world or Sense detail projection.
 */
const currentBindingFactsForFocus = (
  record: MeaningJourneyRecord,
  registry: SenseRegistryState,
  senseId: string,
  senseVersionId: string,
  focusId: string,
) => {
  const seenBindingIds = new Set<string>();
  return record.bindingConfirmations
    .filter((confirmation) =>
      confirmation.senseVersionId === senseVersionId
      && focusIdForBinding(record, confirmation) === focusId,
    )
    .flatMap((confirmation) => {
      const bindingVersion = bindingVersionById(registry, confirmation.bindingVersionId);
      const binding = bindingVersion
        ? registry.bindings.find(
            (candidate) => candidate.senseExpressionBindingId === bindingVersion.senseExpressionBindingId,
          )
        : null;
      const expressionVersion = registry.expressionVersions.find(
        (candidate) => candidate.expressionVersionId === confirmation.expressionVersionId,
      );
      const expression = registry.expressions.find(
        (candidate) => candidate.expressionId === expressionVersion?.expressionId,
      );
      const anchorRevision = record.personalExpressionAnchorRevisions.find(
        (candidate) => candidate.personalExpressionAnchorRevisionId === confirmation.personalExpressionAnchorRevisionId,
      );
      if (
        !bindingVersion
        || !binding
        || !expressionVersion
        || !expression
        || !anchorRevision
        || binding.senseId !== senseId
        || binding.currentBindingVersionId !== confirmation.bindingVersionId
        || bindingVersion.senseVersionId !== senseVersionId
        || bindingVersion.expressionVersionId !== confirmation.expressionVersionId
        || seenBindingIds.has(binding.senseExpressionBindingId)
      ) {
        return [];
      }
      seenBindingIds.add(binding.senseExpressionBindingId);
      return [{ confirmation, binding, bindingVersion, expressionVersion, expression, anchorRevision }];
    });
};

export const deriveFocusPhase = (
  record: MeaningJourneyRecord,
  focusId: string,
): PersonalMeaningJourneyPhase => {
  const focus = record.focuses.find((item) => item.meaningFocusId === focusId);
  if (!focus) return 'unclarified';

  const alignment = activeAlignmentForFocus(record, focusId);
  if (alignment) {
    const hasBinding = record.bindingConfirmations.some(
      (binding) =>
        binding.senseVersionId === alignment.senseVersionId
        && focusIdForBinding(record, binding) === focusId,
    );
    return hasBinding ? 'aligned' : 'sense_confirmed_expression_pending';
  }

  // Editing an accepted Focus leaves acceptedRevision pointing to the old
  // revision. Only the equality below means the current revision is accepted.
  if (focus.acceptedRevision === null || focus.acceptedRevision !== focus.currentRevision) {
    return 'focus_pending_acceptance';
  }

  const construction = latestConstructionForFocus(record, focusId);
  if (construction && construction.meaningFocusRevisionId !== currentFocusRevision(record, focusId)?.meaningFocusRevisionId) {
    return 'focus_accepted';
  }
  if (construction) {
    const proposal = proposalForConstruction(record, construction.senseConstructionId);
    const openVersion = proposal && proposal.status === 'open'
      ? proposalVersion(record, proposal.senseProposalId, proposal.currentVersion)
      : null;
    return openVersion ? 'proposal_ready' : 'constructing';
  }

  return 'focus_accepted';
};

export const derivePersonalMeaningPhase = (
  record: MeaningJourneyRecord,
): PersonalMeaningJourneyPhase => {
  const phases = record.focuses.map((focus) =>
    deriveFocusPhase(record, focus.meaningFocusId));
  if ((record.mockState.focusSuggestions?.items.length ?? 0) > 0) {
    phases.push('focus_suggested');
  }
  return furthestPhase(phases.length > 0 ? phases : ['unclarified']);
};

const buildAnchorViews = (record: MeaningJourneyRecord) => {
  const familiar: JourneyFamiliarAnchorView[] = record.personalExpressionAnchors
    .filter((anchor) => anchor.status === 'active')
    .flatMap((anchor) => {
      const revision = record.personalExpressionAnchorRevisions.find(
        (candidate) =>
          candidate.personalExpressionAnchorId === anchor.personalExpressionAnchorId
          && candidate.revision === anchor.currentRevision,
      );
      return revision && revision.learnerLanguageRole === 'familiar'
        ? [{
            anchorId: anchor.personalExpressionAnchorId,
            kind: 'familiar_expression' as const,
            surfaceForm: revision.surfaceForm,
            expressionType: revision.expressionType,
            revision: revision.revision,
          }]
        : [];
    });

  const blocks: JourneyMaterialBlockView[] = record.personalSemanticAnchors
    .filter((anchor) => anchor.status === 'active')
    .flatMap((anchor) => {
      const revision = record.personalSemanticAnchorRevisions.find(
        (candidate) =>
          candidate.personalSemanticAnchorId === anchor.personalSemanticAnchorId
          && candidate.revision === anchor.currentRevision,
      );
      if (!revision) return [];
      return [{
        anchorId: anchor.personalSemanticAnchorId,
        kind: revision.anchorKind === 'image' ? ('image' as const) : ('text' as const),
        bodyText: revision.bodyText,
        personalMediaObjectId: revision.personalMediaObjectId,
        revision: revision.revision,
      }];
    });

  // The legacy experience projection stays text-only: an image block has no
  // surface form, and readers of this view render it as plain text.
  const experience: JourneyExperienceAnchorView[] = blocks
    .filter((block) => block.kind === 'text' && block.bodyText)
    .map((block) => ({
      anchorId: block.anchorId,
      kind: 'experience' as const,
      surfaceForm: block.bodyText!,
      expressionType: null,
      revision: block.revision,
    }));

  return { familiar, experience, blocks };
};

const buildConstructionView = (
  record: MeaningJourneyRecord,
  senseConstructionId: string,
): JourneyConstructionView | null => {
  const construction = record.constructions.find(
    (item) => item.senseConstructionId === senseConstructionId,
  );
  if (!construction) return null;
  const turns = record.constructionTurns
    .filter((turn) => turn.senseConstructionId === senseConstructionId)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((turn) => ({
      turnId: turn.constructionTurnId,
      actor: turn.actor,
      body: turn.body,
      occurredAt: turn.occurredAt,
    }));
  const hint = record.mockState.constructionHints[senseConstructionId];
  const proposal = proposalForConstruction(record, senseConstructionId);
  return {
    senseConstructionId,
    status: construction.status,
    turns,
    awaitingLearnerAnswer: hint !== undefined,
    boundaryOptions: hint?.boundaryOptions ?? [],
    readyForProposal:
      construction.status === 'active'
      && hint === undefined
      && proposal?.status !== 'open'
      && proposal?.status !== 'confirmed',
  };
};

const buildProposalView = (
  record: MeaningJourneyRecord,
  senseConstructionId: string,
): JourneyProposalView | null => {
  const proposal = proposalForConstruction(record, senseConstructionId);
  if (!proposal || (proposal.status !== 'open' && proposal.status !== 'confirmed')) {
    return null;
  }
  const version = latestProposalVersion(record, proposal.senseProposalId);
  if (!version) return null;
  const confirmedIds = confirmedCandidateIds(record);
  return {
    senseProposalId: proposal.senseProposalId,
    senseProposalVersionId: version.senseProposalVersionId,
    version: version.version,
    status: proposal.status,
    coreMeaningFocus: version.semanticSpec.coreMeaningFocus,
    prototypeScenes: version.semanticSpec.prototypeScenes.map((scene) => ({
      summary: scene.summary,
      participantRoles: [...scene.participantRoles],
      states: [...scene.states],
      directionOrCausality: scene.directionOrCausality,
    })),
    includedCases: [...version.semanticSpec.includedCases],
    excludedCases: [...version.semanticSpec.excludedCases],
    neighborContrasts: version.semanticSpec.neighborContrasts.map((contrast) => ({
      label: contrast.label,
      distinction: contrast.distinction,
    })),
    openQuestions: [...version.semanticSpec.openQuestions],
    unresolvedQuestions: [...version.unresolvedQuestions],
    expressionCandidates: version.expressionCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      expressionType: candidate.expressionType,
      languageTag: candidate.languageTag,
      surfaceForm: candidate.surfaceForm,
      rationale: candidate.rationale,
      confirmed: confirmedIds.has(candidate.candidateId),
    })),
    semanticPolicyVersion: version.semanticPolicyVersion,
    generator: {
      provider: version.generatorProvenance.provider,
      model: version.generatorProvenance.model,
      promptVersion: version.generatorProvenance.promptVersion,
    },
  };
};

const buildAlignmentView = (
  record: MeaningJourneyRecord,
  registry: SenseRegistryState,
  focusId: string,
): JourneyAlignmentView | null => {
  const alignment = activeAlignmentForFocus(record, focusId);
  if (!alignment) return null;
  const senseVersion = senseVersionById(registry, alignment.senseVersionId);
  const confirmation = record.senseConfirmations.find(
    (fact) =>
      fact.senseProposalConfirmationId === alignment.senseProposalConfirmationId,
  );
  const confirmedProposalVersion = confirmation
    ? record.proposalVersions.find(
        (version) => version.senseProposalVersionId === confirmation.senseProposalVersionId,
      ) ?? null
    : null;
  const semanticSpec: JourneySemanticSpecView | null = senseVersion
    ? {
        coreMeaningFocus: senseVersion.semanticSpec.coreMeaningFocus,
        prototypeScenes: senseVersion.semanticSpec.prototypeScenes.map((scene) => ({
          summary: scene.summary,
          participantRoles: [...scene.participantRoles],
          states: [...scene.states],
          directionOrCausality: scene.directionOrCausality,
        })),
        includedCases: [...senseVersion.semanticSpec.includedCases],
        excludedCases: [...senseVersion.semanticSpec.excludedCases],
        neighborContrasts: senseVersion.semanticSpec.neighborContrasts.map((contrast) => ({
          label: contrast.label,
          distinction: contrast.distinction,
        })),
        openQuestions: [...senseVersion.semanticSpec.openQuestions],
      }
    : null;
  const currentBindingFacts = currentBindingFactsForFocus(
    record,
    registry,
    alignment.senseId,
    alignment.senseVersionId,
    focusId,
  );
  const candidateBindingStatus = (candidate: {
    candidateId: string;
    expressionType: JourneyAlignmentView['expressionCandidates'][number]['expressionType'];
    languageTag: string;
    surfaceForm: string;
  }): 'confirmed' | 'used' | undefined => {
    const candidateUsages = currentBindingFacts.filter(({ anchorRevision }) =>
      anchorRevision.provenance.sourceReferenceIds.includes(candidate.candidateId),
    );
    const exactUsage = candidateUsages.some(({ expression, expressionVersion }) =>
      expression.expressionType === candidate.expressionType
      && expression.languageTag === candidate.languageTag
      && expressionVersion.surfaceForm === candidate.surfaceForm,
    );
    return exactUsage ? 'confirmed' : candidateUsages.length > 0 ? 'used' : undefined;
  };
  const expressionCandidates = confirmedProposalVersion?.expressionCandidates.map((candidate) => {
    const bindingStatus = candidateBindingStatus(candidate);
    return {
      candidateId: candidate.candidateId,
      expressionType: candidate.expressionType,
      languageTag: candidate.languageTag,
      surfaceForm: candidate.surfaceForm,
      rationale: candidate.rationale,
      bindingStatus,
      confirmed: bindingStatus === 'confirmed',
    };
  }) ?? [];
  const confirmedBindings = currentBindingFacts.map(({ confirmation, binding, bindingVersion, expressionVersion, expression }) => ({
    expressionBindingConfirmationId: confirmation.expressionBindingConfirmationId,
    senseVersionId: confirmation.senseVersionId,
    expressionVersionId: confirmation.expressionVersionId,
    bindingVersionId: confirmation.bindingVersionId,
    expressionType: expression.expressionType,
    surfaceForm: expressionVersion.surfaceForm,
    languageTag: expression.languageTag,
    relation: binding.relation,
    semanticCoverage: bindingVersion.semanticCoverage,
  }));

  return {
    personalMeaningAlignmentId: alignment.personalMeaningAlignmentId,
    status: alignment.status,
    senseId: alignment.senseId,
    senseVersionId: alignment.senseVersionId,
    senseShortId: shortId(alignment.senseId),
    senseVersionShortId: shortId(alignment.senseVersionId),
    senseVersionNumber: senseVersion?.versionNumber ?? null,
    origin: senseVersion?.origin ?? 'learner_confirmed',
    reviewStatus: senseVersion?.reviewStatus ?? 'learner_confirmed',
    resolution: confirmation?.resolution ?? 'create_new',
    coreMeaningFocus: senseVersion?.semanticSpec.coreMeaningFocus ?? '',
    semanticSpec,
    semanticSpecVersion: senseVersion?.versionNumber ?? null,
    semanticPolicyVersion: senseVersion?.semanticPolicyVersion ?? null,
    generator: senseVersion?.provenance.generator
      ? {
          provider: senseVersion.provenance.generator.provider,
          model: senseVersion.provenance.generator.model,
          promptVersion: senseVersion.provenance.generator.promptVersion,
        }
      : null,
    expressionCandidates,
    unresolvedQuestions: confirmedProposalVersion?.unresolvedQuestions.map((question) => question) ?? [],
    confirmedBindings,
  };
};

export const buildFocusView = (
  record: MeaningJourneyRecord,
  registry: SenseRegistryState,
  focusId: string,
): JourneyFocusView | null => {
  const focus = record.focuses.find((item) => item.meaningFocusId === focusId);
  if (!focus) return null;
  const revision = currentFocusRevision(record, focusId);
  if (!revision) return null;
  const construction = latestConstructionForFocus(record, focusId);
  const currentConstruction = construction
    && construction.meaningFocusRevisionId === revision.meaningFocusRevisionId
    ? construction
    : null;
  return {
    meaningFocusId: focus.meaningFocusId,
    shortId: shortId(focus.meaningFocusId),
    phase: deriveFocusPhase(record, focusId),
    statement: revision.statement,
    distinguishingNotes: revision.distinguishingNotes,
    aspectLabel: record.mockState.focusAspectLabels[focusId] ?? null,
    currentRevision: focus.currentRevision,
    currentRevisionId: revision.meaningFocusRevisionId,
    accepted:
      focus.acceptedRevision !== null
      && focus.acceptedRevision === focus.currentRevision,
    acceptedRevision: focus.acceptedRevision,
    splitFromMeaningFocusId: focus.splitFromMeaningFocusId,
    construction: currentConstruction
      ? buildConstructionView(record, currentConstruction.senseConstructionId)
      : null,
    proposal: currentConstruction
      ? buildProposalView(record, currentConstruction.senseConstructionId)
      : null,
    alignment: buildAlignmentView(record, registry, focusId),
  };
};

export const buildDetailView = (
  record: MeaningJourneyRecord,
  registry: SenseRegistryState,
): JourneyDetailView => {
  const anchors = buildAnchorViews(record);
  const focuses = record.focuses
    .map((focus) => buildFocusView(record, registry, focus.meaningFocusId))
    .filter((view): view is JourneyFocusView => view !== null);
  const acceptedStatements = new Set(
    record.focusRevisions
      .filter((revision) =>
        record.focuses.some(
          (focus) =>
            focus.meaningFocusId === revision.meaningFocusId
            && focus.currentRevision >= revision.revision,
        ),
      )
      .map((revision) => revision.statement),
  );
  const acceptedAspects = new Set(
    Object.entries(record.mockState.focusAspectLabels)
      .filter(([focusId]) => record.focuses.some((focus) => focus.meaningFocusId === focusId))
      .map(([, aspect]) => aspect),
  );
  const focusSuggestions = (record.mockState.focusSuggestions?.items ?? [])
    .filter((suggestion) =>
      !acceptedStatements.has(suggestion.statement)
      && !acceptedAspects.has(suggestion.aspectLabel),
    )
    .map((suggestion) => ({
      suggestionId: suggestion.suggestionId,
      statement: suggestion.statement,
      distinguishingNotes: [...suggestion.distinguishingNotes],
      aspectLabel: suggestion.aspectLabel,
      provenance: record.mockState.focusSuggestions!.provenance,
    }));
  const meaningRevision = currentMeaningRevision(record);
  return {
    personalMeaningId: record.personalMeaning.personalMeaningId,
    shortId: shortId(record.personalMeaning.personalMeaningId),
    displayLabel: meaningRevision?.displayLabel ?? null,
    learnerIntentNote: meaningRevision?.learnerIntentNote ?? null,
    phase: derivePersonalMeaningPhase(record),
    senseFormation: buildSenseFormationView(focuses),
    expressionBinding: buildExpressionBindingView(focuses),
    familiarAnchors: anchors.familiar,
    experienceAnchors: anchors.experience,
    materialBlocks: anchors.blocks,
    startingPoint: record.mockState.startingPoint ?? null,
    focuses,
    focusSuggestions,
    focusSuggestionsAreMultipleAspects:
      record.mockState.focusSuggestions?.multipleAspects ?? false,
    createdAt: record.personalMeaning.createdAt,
    updatedAt: record.personalMeaning.updatedAt,
  };
};

export const buildListItemView = (
  record: MeaningJourneyRecord,
  registry: SenseRegistryState,
): JourneyListItemView => {
  const detail = buildDetailView(record, registry);
  return {
    personalMeaningId: record.personalMeaning.personalMeaningId,
    shortId: shortId(record.personalMeaning.personalMeaningId),
    phase: detail.phase,
    primaryLabel: detail.displayLabel ?? '我的个人意义',
    familiarAnchors: detail.familiarAnchors,
    experienceAnchors: detail.experienceAnchors,
    focusCount: record.focuses.length,
    confirmedSenseCount: detail.senseFormation.confirmedSenseCount,
    confirmedExpressionCount: detail.expressionBinding.confirmedBindingCount,
    senseFormation: detail.senseFormation,
    expressionBinding: detail.expressionBinding,
    updatedAt: record.personalMeaning.updatedAt,
  };
};

/**
 * Derive the world-level Sense Formation axis from all active Focuses.
 *
 * A Personal Meaning can contain several independent Focuses, so the world
 * summary exposes the furthest actionable phase while retaining counts for
 * every phase. Actionable work wins over already confirmed siblings: an open
 * Proposal is surfaced before an in-progress clarification, which is surfaced
 * before an unaccepted Focus. Only when every Focus has an Alignment does the
 * aggregate become `sense_confirmed`.
 */
export const buildSenseFormationView = (
  focuses: readonly JourneyFocusView[],
): JourneySenseFormationView => {
  const pendingFocuses = focuses.filter((focus) => focus.phase === 'focus_pending_acceptance');
  const proposalPendingFocuses = focuses.filter((focus) => focus.phase === 'proposal_ready');
  const clarifyingFocuses = focuses.filter((focus) =>
    focus.phase === 'constructing' || focus.phase === 'focus_accepted',
  );
  const confirmedSenseFocuses = focuses.filter((focus) => focus.alignment !== null);

  // Focus projections have only the actionable cases above or an active
  // Alignment; the final branch is therefore the explicit completed case.
  const phase: SenseFormationPhase = focuses.length === 0
    ? 'focus_missing'
    : proposalPendingFocuses.length > 0
      ? 'proposal_pending'
      : clarifyingFocuses.length > 0
        ? 'clarifying'
        : pendingFocuses.length > 0
          ? 'focus_pending_acceptance'
          : 'sense_confirmed';

  const nextFocus = proposalPendingFocuses[0]
    ?? clarifyingFocuses[0]
    ?? pendingFocuses[0]
    ?? confirmedSenseFocuses[0]
    ?? null;

  return {
    phase,
    focusCount: focuses.length,
    acceptedFocusCount: focuses.filter((focus) => focus.accepted).length,
    pendingFocusCount: pendingFocuses.length,
    clarifyingFocusCount: clarifyingFocuses.length,
    proposalPendingCount: proposalPendingFocuses.length,
    confirmedSenseCount: confirmedSenseFocuses.length,
    nextFocusId: nextFocus?.meaningFocusId ?? null,
  };
};

/**
 * Derive the world-level Expression Binding axis independently from Sense
 * Formation. Unconfirmed Focuses never make binding look available, and a
 * confirmed Sense without a binding is explicitly `pending`, never `aligned`.
 */
export const buildExpressionBindingView = (
  focuses: readonly JourneyFocusView[],
): JourneyExpressionBindingView => {
  const alignedFocuses = focuses.filter((focus) => focus.alignment !== null);
  const boundFocuses = alignedFocuses.filter(
    (focus) => (focus.alignment?.confirmedBindings.length ?? 0) > 0,
  );
  const pendingFocuses = alignedFocuses.filter(
    (focus) => (focus.alignment?.confirmedBindings.length ?? 0) === 0,
  );
  const confirmedBindingCount = alignedFocuses.reduce(
    (total, focus) => total + (focus.alignment?.confirmedBindings.length ?? 0),
    0,
  );

  const phase: ExpressionBindingPhase = alignedFocuses.length === 0
    ? 'not_ready'
    : pendingFocuses.length === alignedFocuses.length
      ? 'pending'
      : pendingFocuses.length > 0
        ? 'partial'
        : 'bound';

  return {
    phase,
    confirmedSenseCount: alignedFocuses.length,
    boundSenseCount: boundFocuses.length,
    confirmedBindingCount,
    pendingBindingCount: pendingFocuses.length,
    nextFocusId: pendingFocuses[0]?.meaningFocusId ?? null,
  };
};

/**
 * Build the world item consumed by graph, expanded and list presentations.
 * Keeping the detail projection beside the compact projection makes the
 * gateway's world query one coherent snapshot rather than a list followed by
 * per-card reads.
 */
export const buildWorldItemView = (
  record: MeaningJourneyRecord,
  registry: SenseRegistryState,
): JourneyWorldItemView => {
  const detail = buildDetailView(record, registry);
  return { ...buildListItemView(record, registry), detail };
};

export const PHASE_LABELS: Record<PersonalMeaningJourneyPhase, string> = {
  unclarified: '待澄清',
  focus_suggested: 'Focus 建议待加入',
  focus_pending_acceptance: 'Focus 待确认',
  focus_accepted: 'Focus 已接受',
  constructing: '澄清中',
  proposal_ready: 'Proposal 待确认',
  sense_confirmed_expression_pending: 'Sense 已确认 · 表达待确认',
  aligned: 'Sense 已确认 · 表达已确认',
};
