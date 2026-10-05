import type { SensaContextImage } from '@sensa/contracts/sensa';
import {z} from 'zod';
import type {
  PersonalMeaningLearningSource,
} from '../../contentSupply/system';
import type { MeaningJourneyRecord } from './store';
import {readRegistry,type RegistryRead} from './registryRead';

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
      || !/^data:image\/[A-Za-z0-9.+-]+;base64,/u.test(media.dataUrl)
    ) return [];
    return [{
      id: media.mediaId,
      name: typeof media.fileName === 'string' ? media.fileName.slice(0, 200) : 'personal-scene.jpg',
      dataUrl: media.dataUrl,
    }];
  })
  .slice(0, 4);

export function assertPersonalContextPin(record:MeaningJourneyRecord,pin:unknown):asserts pin is string[]{
 const ids=z.array(z.string().uuid()).min(1).parse(pin);
 if(new Set(ids).size!==ids.length||ids.some(id=>!record.personalSemanticAnchorRevisions.some(revision=>revision.personalSemanticAnchorRevisionId===id)))throw new Error('localFlow.meaningChanged');
}

/** Media stays in its owned store; only exact selected Context references are loaded. */
export async function hydratePersonalLearningImages(record:MeaningJourneyRecord,sources:PersonalMeaningLearningSource[],read:(id:string)=>Promise<SensaContextImage>):Promise<PersonalMeaningLearningSource[]>{
 const images=new Map<string,Promise<SensaContextImage>>();
 return Promise.all(sources.map(async source=>{
  const ids=new Set(source.context.personalSemanticAnchorRevisionIds);
  const mediaIds=[...new Set(record.personalSemanticAnchorRevisions.filter(revision=>ids.has(revision.personalSemanticAnchorRevisionId)).flatMap(revision=>revision.personalMediaObjectId?[revision.personalMediaObjectId]:[]))];
  const loaded=await Promise.all(mediaIds.map(id=>{if(!images.has(id))images.set(id,read(id));return images.get(id)!;}));
  return {...source,context:{...source.context,images:[...new Map([...source.context.images,...loaded].map(image=>[image.id,image])).values()]}};
 }));
}

/**
 * Resolve every learnable Binding on one active Alignment directly from the
 * authoritative Personal Semantic World aggregate. Incomplete records and
 * incompatible Binding versions deliberately yield no source. Registry heads
 * may advance without replacing an Alignment's explicitly accepted versions.
 */
export const buildPersonalMeaningLearningSources = (
  record: MeaningJourneyRecord,
  registry: RegistryRead,
  alignmentId?: string,
  contextRevisionIds?: readonly string[],
): PersonalMeaningLearningSource[] => record.alignments
  .filter((alignment) => (
    alignment.status === 'active'
    && (!alignmentId || alignment.personalMeaningAlignmentId === alignmentId)
  ))
  .flatMap((alignment) => {
    const meaningRevision = record.personalMeaningRevisions.find(
      (candidate) => candidate.personalMeaningRevisionId === alignment.personalMeaningRevisionId,
    );
    const senseVersion = readRegistry(registry,'senseVersions',alignment.senseVersionId);
    if (!meaningRevision || !senseVersion || senseVersion.senseId !== alignment.senseId) return [];

    const contextualAcceptanceId = alignment.basis.kind === 'contextual_resolution'
      ? alignment.basis.semanticAcceptanceId
      : null;
    const contextualAcceptance = contextualAcceptanceId
      ? record.semanticAcceptances.find(
          (candidate) => candidate.semanticAcceptanceId === contextualAcceptanceId,
        )
      : null;
    if(contextRevisionIds)assertPersonalContextPin(record,contextRevisionIds);
    const revisions = contextRevisionIds
      ? contextRevisionIds.map(id=>{const revision=record.personalSemanticAnchorRevisions.find(candidate=>candidate.personalSemanticAnchorRevisionId===id);if(!revision)throw new Error('localFlow.meaningChanged');return revision;})
      : record.personalSemanticAnchors.filter(anchor=>anchor.status==='active').map(anchor=>{
        const revision=record.personalSemanticAnchorRevisions.find(candidate=>candidate.personalSemanticAnchorId===anchor.personalSemanticAnchorId&&candidate.revision===anchor.currentRevision);
        if(!revision)throw new Error('localFlow.meaningChanged');return revision;
      });
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

      const bindingVersion = readRegistry(registry,'bindingVersions',confirmation.bindingVersionId);
      const binding = bindingVersion && readRegistry(registry,'bindings',bindingVersion.senseExpressionBindingId);
      const expressionVersion = readRegistry(registry,'expressionVersions',confirmation.expressionVersionId);
      const expression = expressionVersion && readRegistry(registry,'expressions',expressionVersion.expressionId);
      if (
        !bindingVersion
        || !binding
        || !expressionVersion
        || !expression
        || binding.senseId !== alignment.senseId
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
          ...(typeof expressionVersion.structure.spokenForm==='string'?{spokenForm:expressionVersion.structure.spokenForm}:{}),
          ...(Array.isArray(expressionVersion.structure.formParts)?{formParts:structuredClone(expressionVersion.structure.formParts) as {kind:'fixed'|'slot';text:string;constraint?:string}[]}:{}),
          expressionType: expression.expressionType,
          languageTag: expression.languageTag,
        },
        semanticSpec: structuredClone(senseVersion.semanticSpec),
      }];
    });
  });
