/**
 * Pure read-model projection for the Personal Meaning journey.
 *
 * Phases are derived from authoritative snapshots and confirmation facts. The
 * mock adapter state only supplies suggestions and presentation hints; it can
 * never advance a domain phase by itself.
 */

import {sensaIntakeSourceMetaSchema} from '@sensa/contracts/sensa';
import {isAlignmentActive,alignmentStatusAt} from './alignmentLifecycle';
import type {
  SensaPersonalMeaningAlignmentSnapshot,
  SensaSenseExpressionBindingVersionSnapshot,
  SensaSenseVersionSnapshot,
} from '@sensa/contracts/sensa';
import type { MeaningJourneyRecord } from './store';
import {readRegistry,type RegistryRead} from './registryRead';
import {orderedMeaningContextAnchors} from './meaningRecords';
import type {
  JourneyAlignmentView,
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
      alignment.basis.kind === 'sense_construction'
      && alignment.basis.meaningFocusId === focusId
      && isAlignmentActive(record,alignment),
  ) ?? null;

const currentFocuses=(record:MeaningJourneyRecord)=>record.focuses.filter(focus=>{
 const alignments=record.alignments.filter(row=>row.basis.kind==='sense_construction'&&row.basis.meaningFocusId===focus.meaningFocusId);
 return !alignments.length||alignments.some(row=>isAlignmentActive(record,row));
});

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
  registry: RegistryRead,
  senseVersionId: string,
): SensaSenseVersionSnapshot | null =>
  readRegistry(registry,'senseVersions',senseVersionId)
  ?? null;

const bindingVersionById = (
  registry: RegistryRead,
  bindingVersionId: string,
): SensaSenseExpressionBindingVersionSnapshot | null =>
  readRegistry(registry,'bindingVersions',bindingVersionId)
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

const bindingBelongsToAlignment = (
  record: MeaningJourneyRecord,
  alignment: SensaPersonalMeaningAlignmentSnapshot,
  binding: MeaningJourneyRecord['bindingConfirmations'][number],
): boolean => {
  if (binding.senseVersionId !== alignment.senseVersionId) return false;
  if (alignment.basis.kind === 'sense_construction') {
    const senseProposalConfirmationId = alignment.basis.senseProposalConfirmationId;
    const confirmation = record.senseConfirmations.find(
      (fact) => fact.senseProposalConfirmationId
        === senseProposalConfirmationId,
    );
    return confirmation != null
      && binding.senseProposalVersionId === confirmation.senseProposalVersionId;
  }
  const semanticAcceptanceId = alignment.basis.semanticAcceptanceId;
  const acceptance = record.semanticAcceptances.find(
    (fact) => fact.semanticAcceptanceId === semanticAcceptanceId,
  );
  return acceptance != null
    && binding.senseProposalVersionId === null
    && binding.personalExpressionAnchorRevisionId
      === acceptance.personalExpressionAnchorRevisionId;
};

/**
 * Read the versions explicitly confirmed on this Alignment. Another Meaning
 * advancing a registry head does not supersede this learner's accepted edge.
 */
const currentBindingFactsForAlignment = (
  record: MeaningJourneyRecord,
  registry: RegistryRead,
  senseId: string,
  senseVersionId: string,
  alignment: SensaPersonalMeaningAlignmentSnapshot,
) => {
  const seenBindingIds = new Set<string>();
  return record.bindingConfirmations
    .filter((confirmation) =>
      confirmation.senseVersionId === senseVersionId
      && bindingBelongsToAlignment(record, alignment, confirmation),
    )
    .flatMap((confirmation) => {
      const bindingVersion = bindingVersionById(registry, confirmation.bindingVersionId);
      const binding = bindingVersion
        ? readRegistry(registry,'bindings',bindingVersion.senseExpressionBindingId)
        : null;
      const expressionVersion = readRegistry(registry,'expressionVersions',confirmation.expressionVersionId);
      const expression = expressionVersion?readRegistry(registry,'expressions',expressionVersion.expressionId):undefined;
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
      (binding) => bindingBelongsToAlignment(record, alignment, binding),
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
  const phases = currentFocuses(record).map((focus) =>
    deriveFocusPhase(record, focus.meaningFocusId));
  for (const alignment of record.alignments) {
    const direct = alignment.basis.kind === 'contextual_resolution'
      || alignment.basis.meaningFocusId === null;
    if (!isAlignmentActive(record,alignment) || !direct) {
      continue;
    }
    phases.push(record.bindingConfirmations.some(
      (binding) => bindingBelongsToAlignment(record, alignment, binding),
    ) ? 'aligned' : 'sense_confirmed_expression_pending');
  }
  return furthestPhase(phases.length > 0 ? phases : ['unclarified']);
};

const buildAnchorViews = (record: MeaningJourneyRecord) => {
  const boundRevisions=new Set([
    ...record.bindingConfirmations.map(fact=>fact.personalExpressionAnchorRevisionId),
    ...record.semanticAcceptances.map(fact=>fact.personalExpressionAnchorRevisionId),
  ]);
  const familiar: JourneyFamiliarAnchorView[] = record.personalExpressionAnchors
    .filter((anchor) => anchor.status === 'active')
    .flatMap((anchor) => {
      const revision = record.personalExpressionAnchorRevisions.find(
        (candidate) =>
          candidate.personalExpressionAnchorId === anchor.personalExpressionAnchorId
          && candidate.revision === anchor.currentRevision,
      );
      return revision && !boundRevisions.has(revision.personalExpressionAnchorRevisionId)
        ? [{
            anchorId: anchor.personalExpressionAnchorId,
            kind: 'familiar_expression' as const,
            surfaceForm: revision.surfaceForm,
            expressionType: revision.expressionType,
            revision: revision.revision,
          }]
        : [];
    });

  const capturedSources:NonNullable<JourneyDetailView['capturedSources']>=[];
  const blocks: JourneyMaterialBlockView[] = orderedMeaningContextAnchors(record)
    .flatMap((anchor) => {
      const revision = record.personalSemanticAnchorRevisions.find(
        (candidate) =>
          candidate.personalSemanticAnchorId === anchor.personalSemanticAnchorId
          && candidate.revision === anchor.currentRevision,
      );
      if (!revision) return [];
      const intake=revision.structuredPayload.intake as Record<string,unknown>|undefined;
      const parsedSource=sensaIntakeSourceMetaSchema.safeParse(intake&&Object.hasOwn(intake,'contextSource')?intake.contextSource:revision.structuredPayload.source);
      const source=parsedSource.success?parsedSource.data:null;
      const capturedRevision=record.personalExpressionAnchorRevisions.flatMap(expression=>{
        if(!expression.contextAnchorRevisionId)return [];
        return record.personalSemanticAnchorRevisions.filter(candidate=>candidate.personalSemanticAnchorRevisionId===expression.contextAnchorRevisionId
          &&candidate.personalSemanticAnchorId===anchor.personalSemanticAnchorId);
      })[0];
      const originalText=intake&&Object.hasOwn(intake,'contextText')?(typeof intake.contextText==='string'?intake.contextText:null):capturedRevision?.bodyText??null;
      const capturedSource=source||originalText&&(originalText!==revision.bodyText||anchor.status!=='active')?{text:originalText,source}:undefined;
      if(capturedSource)capturedSources.push({anchorId:anchor.personalSemanticAnchorId,...capturedSource});
      // Retirement changes the current Context, not its capture provenance.
      if(anchor.status!=='active')return [];
      const sceneMedia = revision.anchorKind === 'scene' && Array.isArray(revision.structuredPayload.media)
        ? revision.structuredPayload.media.flatMap((value) => {
            if (!value || typeof value !== 'object') return [];
            const media = value as Record<string, unknown>;
            return typeof media.mediaId === 'string' && typeof media.dataUrl === 'string'
              && typeof media.mimeType === 'string'
              ? [{ mediaId: media.mediaId, dataUrl: media.dataUrl, mimeType: media.mimeType }]
              : [];
          })
        : [];
      const body = revision.bodyText ? [{
        anchorId: anchor.personalSemanticAnchorId,
        kind: 'text' as const,
        bodyText: revision.bodyText,
        personalMediaObjectId: null,
        revision: revision.revision,
        ...(capturedSource?{capturedSource}:{}),
      }] : [];
      const media = sceneMedia.map((item) => ({
        anchorId: `${anchor.personalSemanticAnchorId}:${item.mediaId}`,
        kind: 'image' as const,
        bodyText: null,
        personalMediaObjectId: null,
        inlineDataUrl: item.dataUrl,
        inlineMimeType: item.mimeType,
        revision: revision.revision,
      }));
      if (revision.anchorKind === 'scene') return [...body, ...media];
      return [{
        anchorId: anchor.personalSemanticAnchorId,
        kind: revision.anchorKind === 'image' ? ('image' as const) : ('text' as const),
        bodyText: revision.bodyText,
        personalMediaObjectId: revision.personalMediaObjectId,
        revision: revision.revision,
        ...(capturedSource?{capturedSource}:{}),
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

  return { familiar, experience, blocks,capturedSources };
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
  registry: RegistryRead,
  alignment: SensaPersonalMeaningAlignmentSnapshot,
  historical=false,
): JourneyAlignmentView | null => {
  if (!historical&&!isAlignmentActive(record,alignment)) return null;
  const senseVersion = senseVersionById(registry, alignment.senseVersionId);
  const confirmation = record.senseConfirmations.find(
    (fact) =>
      alignment.basis.kind === 'sense_construction'
      && fact.senseProposalConfirmationId === alignment.basis.senseProposalConfirmationId,
  );
  const contextualAcceptance = record.semanticAcceptances.find(
    (fact) => alignment.basis.kind === 'contextual_resolution'
      && fact.semanticAcceptanceId === alignment.basis.semanticAcceptanceId,
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
  const currentBindingFacts = currentBindingFactsForAlignment(
    record,
    registry,
    alignment.senseId,
    alignment.senseVersionId,
    alignment,
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
    expressionId: expression.expressionId,
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
    basisKind: alignment.basis.kind,
    status: alignmentStatusAt(record.alignmentEvents,alignment.personalMeaningAlignmentId),
    senseId: alignment.senseId,
    senseVersionId: alignment.senseVersionId,
    senseShortId: shortId(alignment.senseId),
    senseVersionShortId: shortId(alignment.senseVersionId),
    senseVersionNumber: senseVersion?.versionNumber ?? null,
    origin: senseVersion?.origin ?? 'learner_confirmed',
    reviewStatus: senseVersion?.reviewStatus ?? 'learner_confirmed',
    resolution: confirmation?.resolution ?? contextualAcceptance?.resolution ?? 'create_new',
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
  registry: RegistryRead,
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
    distinguishingNotes: [...revision.distinguishingNotes],
    aspectLabel: record.mockState.focusAspectLabels[focusId] ?? null,
    currentRevision: focus.currentRevision,
    currentRevisionId: revision.meaningFocusRevisionId,
    accepted:
      focus.acceptedRevision !== null
      && focus.acceptedRevision === focus.currentRevision,
    acceptedRevision: focus.acceptedRevision,
    splitFromMeaningFocusId: focus.splitFromMeaningFocusId,
    proposal: currentConstruction
      ? buildProposalView(record, currentConstruction.senseConstructionId)
      : null,
    alignment: (() => {
      const alignment = activeAlignmentForFocus(record, focusId);
      return alignment ? buildAlignmentView(record, registry, alignment) : null;
    })(),
  };
};

export const buildDetailView = (
  record: MeaningJourneyRecord,
  registry: RegistryRead,
): JourneyDetailView => {
  const anchors = buildAnchorViews(record);
  const focuses = currentFocuses(record)
    .map((focus) => buildFocusView(record, registry, focus.meaningFocusId))
    .filter((view): view is JourneyFocusView => view !== null);
  const directAlignments = record.alignments
    .filter((alignment) => alignment.basis.kind === 'contextual_resolution'
      || alignment.basis.meaningFocusId === null)
    .map((alignment) => buildAlignmentView(record, registry, alignment))
    .filter((view): view is JourneyAlignmentView => view !== null);
  const meaningRevision = currentMeaningRevision(record);
  const currentAlignmentIds=new Set(record.alignments.filter(alignment=>isAlignmentActive(record,alignment)).map(alignment=>alignment.personalMeaningAlignmentId));
  const alignmentHistory=new Map<string,JourneyAlignmentView>();
  for(const branch of [record,...(record.conflictHistory?.branches.map(row=>row.record)??[])])for(const alignment of branch.alignments){
    if(currentAlignmentIds.has(alignment.personalMeaningAlignmentId)||alignmentHistory.has(alignment.personalMeaningAlignmentId))continue;
    const view=buildAlignmentView(branch,registry,alignment,true);if(view)alignmentHistory.set(alignment.personalMeaningAlignmentId,view);
  }
  return {
    personalMeaningId: record.personalMeaning.personalMeaningId,
    shortId: shortId(record.personalMeaning.personalMeaningId),
    revision: record.personalMeaning.currentRevision,
    status:record.personalMeaning.status,
    displayLabel: meaningRevision?.displayLabel ?? null,
    learnerIntentNote: meaningRevision?.learnerIntentNote ?? null,
    phase: derivePersonalMeaningPhase(record),
    senseFormation: buildSenseFormationView(focuses, directAlignments),
    expressionBinding: buildExpressionBindingView(focuses, directAlignments),
    familiarAnchors: anchors.familiar,
    experienceAnchors: anchors.experience,
    materialBlocks: anchors.blocks,
    capturedSources:anchors.capturedSources,
    startingPoint: record.mockState.startingPoint ?? null,
    focuses,
    directAlignments,
    alignmentHistory:[...alignmentHistory.values()],
    createdAt: record.personalMeaning.createdAt,
    updatedAt: record.personalMeaning.updatedAt,
  };
};

export const buildListItemView = (
  record: MeaningJourneyRecord,
  registry: RegistryRead,
): JourneyListItemView => listItemFromDetail(record,buildDetailView(record,registry));

const listItemFromDetail = (record:MeaningJourneyRecord,detail:JourneyDetailView):JourneyListItemView => {
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
  directAlignments: readonly JourneyAlignmentView[] = [],
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
    ? directAlignments.length > 0 ? 'sense_confirmed' : 'focus_missing'
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
    confirmedSenseCount: confirmedSenseFocuses.length + directAlignments.length,
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
  directAlignments: readonly JourneyAlignmentView[] = [],
): JourneyExpressionBindingView => {
  const focusAlignments = focuses.flatMap((focus) => focus.alignment ? [focus.alignment] : []);
  const alignments = [...focusAlignments, ...directAlignments];
  const boundAlignments = alignments.filter(
    (alignment) => alignment.confirmedBindings.length > 0,
  );
  const pendingAlignments = alignments.filter(
    (alignment) => alignment.confirmedBindings.length === 0,
  );
  const confirmedBindingCount = alignments.reduce(
    (total, alignment) => total + alignment.confirmedBindings.length,
    0,
  );

  const phase: ExpressionBindingPhase = alignments.length === 0
    ? 'not_ready'
    : pendingAlignments.length === alignments.length
      ? 'pending'
      : pendingAlignments.length > 0
        ? 'partial'
        : 'bound';

  return {
    phase,
    confirmedSenseCount: alignments.length,
    boundSenseCount: boundAlignments.length,
    confirmedBindingCount,
    pendingBindingCount: pendingAlignments.length,
    nextFocusId: focuses.find(
      (focus) => focus.alignment && focus.alignment.confirmedBindings.length === 0,
    )?.meaningFocusId ?? null,
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
  registry: RegistryRead,
): JourneyWorldItemView => {
  const detail = buildDetailView(record, registry);
  return { ...listItemFromDetail(record,detail), detail };
};

export const PHASE_LABELS: Record<PersonalMeaningJourneyPhase, string> = {
  unclarified: '待澄清',
  focus_pending_acceptance: 'Focus 待确认',
  focus_accepted: 'Focus 已接受',
  constructing: '澄清中',
  proposal_ready: 'Proposal 待确认',
  sense_confirmed_expression_pending: 'Sense 已确认 · 表达待确认',
  aligned: 'Sense 已确认 · 表达已确认',
};
