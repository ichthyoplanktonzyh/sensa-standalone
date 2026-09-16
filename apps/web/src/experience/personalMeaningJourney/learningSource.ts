import type { SensaContextImage } from '@sensa/contracts/sensa';
import type {
  PersonalMeaningLearningSource,
} from '../../data/library/personalLearningSource';
import type { MeaningJourneyRecord, SenseRegistryState } from './store';

const bindingBelongsToConstructionAlignment = (
  record: MeaningJourneyRecord,
  senseProposalConfirmationId: string,
  senseProposalVersionId: string | null,
): boolean => {
  const confirmation = record.senseConfirmations.find(
    (candidate) => candidate.senseProposalConfirmationId
      === senseProposalConfirmationId,
  );
  return confirmation != null
    && senseProposalVersionId === confirmation.senseProposalVersionId;
};

const sceneImages = (
  record: MeaningJourneyRecord,
  revisionIds: Set<string>,
): SensaContextImage[] => record.personalSemanticAnchorRevisions
  .filter((revision) => revisionIds.has(revision.personalSemanticAnchorRevisionId))
  .flatMap((revision) => Array.isArray(revision.structuredPayload.media)
    ? revision.structuredPayload.media
    : [])
  .flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const media = value as Record<string, unknown>;
    if (
      typeof media.mediaId !== 'string'
      || typeof media.dataUrl !== 'string'
      || !/^data:image\/jpeg;base64,/u.test(media.dataUrl)
    ) return [];
    return [{
      id: media.mediaId,
      name: typeof media.fileName === 'string' ? media.fileName.slice(0, 200) : 'personal-scene.jpg',
      dataUrl: media.dataUrl,
    }];
  })
  .slice(0, 4);

const alignedAnchorRevisions = (
  record: MeaningJourneyRecord,
  alignment: MeaningJourneyRecord['alignments'][number],
) => {
  if (alignment.basis.kind === 'contextual_resolution') {
    const semanticAcceptanceId = alignment.basis.semanticAcceptanceId;
    const acceptance = record.semanticAcceptances.find(
      (candidate) => candidate.semanticAcceptanceId === semanticAcceptanceId,
    );
    return acceptance
      ? record.personalSemanticAnchorRevisions.filter(
          (candidate) => candidate.personalSemanticAnchorRevisionId
            === acceptance.personalSemanticAnchorRevisionId,
        )
      : [];
  }
  return record.personalSemanticAnchors
    .filter((anchor) => anchor.createdAt <= alignment.createdAt)
    .flatMap((anchor) => record.personalSemanticAnchorRevisions
      .filter((revision) => (
        revision.personalSemanticAnchorId === anchor.personalSemanticAnchorId
        && revision.createdAt <= alignment.createdAt
      ))
      .sort((left, right) => right.revision - left.revision)
      .slice(0, 1));
};

/**
 * Resolve every learnable Binding on one active Alignment directly from the
 * authoritative Personal Semantic World aggregate. Incomplete records and
 * stale Binding versions deliberately yield no source.
 */
export const buildPersonalMeaningLearningSources = (
  record: MeaningJourneyRecord,
  registry: SenseRegistryState,
  alignmentId?: string,
): PersonalMeaningLearningSource[] => record.alignments
  .filter((alignment) => (
    alignment.status === 'active'
    && (!alignmentId || alignment.personalMeaningAlignmentId === alignmentId)
  ))
  .flatMap((alignment) => {
    const meaningRevision = record.personalMeaningRevisions.find(
      (candidate) => candidate.personalMeaningRevisionId === alignment.personalMeaningRevisionId,
    );
    const senseVersion = registry.senseVersions.find(
      (candidate) => candidate.senseVersionId === alignment.senseVersionId,
    );
    if (!meaningRevision || !senseVersion || senseVersion.senseId !== alignment.senseId) return [];

    const contextualAcceptanceId = alignment.basis.kind === 'contextual_resolution'
      ? alignment.basis.semanticAcceptanceId
      : null;
    const contextualAcceptance = contextualAcceptanceId
      ? record.semanticAcceptances.find(
          (candidate) => candidate.semanticAcceptanceId === contextualAcceptanceId,
        )
      : null;
    const revisions = alignedAnchorRevisions(record, alignment);
    const revisionIds = new Set(
      revisions.map((revision) => revision.personalSemanticAnchorRevisionId),
    );
    const contextText = revisions
      .flatMap((revision) => revision.bodyText ? [revision.bodyText] : [])
      .join('\n\n');

    return record.bindingConfirmations.flatMap((confirmation) => {
      if (confirmation.senseVersionId !== alignment.senseVersionId) return [];
      const belongs = alignment.basis.kind === 'sense_construction'
        ? bindingBelongsToConstructionAlignment(
            record,
            alignment.basis.senseProposalConfirmationId,
            confirmation.senseProposalVersionId,
          )
        : confirmation.senseProposalVersionId === null
          && confirmation.personalExpressionAnchorRevisionId
            === contextualAcceptance?.personalExpressionAnchorRevisionId;
      if (!belongs) return [];

      const bindingVersion = registry.bindingVersions.find(
        (candidate) => candidate.bindingVersionId === confirmation.bindingVersionId,
      );
      const binding = bindingVersion && registry.bindings.find(
        (candidate) => candidate.senseExpressionBindingId
          === bindingVersion.senseExpressionBindingId,
      );
      const expressionVersion = registry.expressionVersions.find(
        (candidate) => candidate.expressionVersionId === confirmation.expressionVersionId,
      );
      const expression = expressionVersion && registry.expressions.find(
        (candidate) => candidate.expressionId === expressionVersion.expressionId,
      );
      if (
        !bindingVersion
        || !binding
        || !expressionVersion
        || !expression
        || binding.senseId !== alignment.senseId
        || binding.currentBindingVersionId !== bindingVersion.bindingVersionId
        || bindingVersion.senseVersionId !== alignment.senseVersionId
        || bindingVersion.expressionVersionId !== expressionVersion.expressionVersionId
      ) return [];

      return [{
        sourceKind: 'personal_meaning_alignment' as const,
        reference: {
          personalMeaningId: alignment.personalMeaningId,
          personalMeaningRevisionId: alignment.personalMeaningRevisionId,
          personalMeaningAlignmentId: alignment.personalMeaningAlignmentId,
          alignmentRevision: alignment.revision,
          alignmentBasisReferenceId: alignment.basis.kind === 'contextual_resolution'
            ? alignment.basis.semanticAcceptanceId
            : alignment.basis.senseProposalConfirmationId,
          meaningFocusId: alignment.basis.kind === 'sense_construction'
            ? alignment.basis.meaningFocusId
            : null,
          senseId: alignment.senseId,
          senseVersionId: alignment.senseVersionId,
          bindingId: binding.senseExpressionBindingId,
          bindingVersionId: bindingVersion.bindingVersionId,
        },
        targetLanguageTag: expression.languageTag,
        context: {
          text: contextText,
          images: sceneImages(record, revisionIds),
          personalSemanticAnchorRevisionIds: [...revisionIds],
        },
        expression: {
          surfaceForm: expressionVersion.surfaceForm,
          expressionType: expression.expressionType,
          languageTag: expression.languageTag,
        },
        semanticSpec: structuredClone(senseVersion.semanticSpec),
      }];
    });
  });
