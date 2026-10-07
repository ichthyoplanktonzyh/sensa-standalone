import {canonicalConsumerJson,type SensaContextImage} from '@sensa/contracts/sensa';
import {z} from 'zod';
import type {
  PersonalMeaningLearningSource,
} from '../../contentSupply/system';
import type { MeaningJourneyRecord } from './store';
import {readRegistry,type RegistryRead} from './registryRead';
import {isAlignmentActive,alignmentStatusAt} from './alignmentLifecycle';
import {currentMeaningContextRevisions} from './meaningRecords';

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
  revisionIds: readonly string[],
): SensaContextImage[] => revisionIds
  .map(id=>record.personalSemanticAnchorRevisions.find(revision=>revision.personalSemanticAnchorRevisionId===id)!)
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

/** Preserve the supplied (current or historical) Context order across media
 * loading and replica admission; never use fact-array order for a grant. */
export function orderPersonalContextImages(record:MeaningJourneyRecord,revisionIds:readonly string[],images:readonly SensaContextImage[]):SensaContextImage[]{
 const revisions=revisionIds.map(id=>{const revision=record.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorRevisionId===id);if(!revision)throw Error('localFlow.meaningChanged');return revision;});
 const byId=new Map(images.map(image=>[image.id,image]));
 const order=[...new Set(revisions.flatMap(revision=>[...(revision.personalMediaObjectId?[revision.personalMediaObjectId]:[]),...(Array.isArray(revision.structuredPayload.media)?revision.structuredPayload.media.flatMap(media=>media&&typeof media==='object'&&typeof (media as Record<string,unknown>).mediaId==='string'?[(media as {mediaId:string}).mediaId]:[]):[])]))];
 return order.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
}

/** Media stays in its owned store; only exact selected Context references are loaded. */
export async function hydratePersonalLearningImages(record:MeaningJourneyRecord,sources:PersonalMeaningLearningSource[],read:(id:string)=>Promise<SensaContextImage>):Promise<PersonalMeaningLearningSource[]>{
 const images=new Map<string,Promise<SensaContextImage>>();
 return Promise.all(sources.map(async source=>{
  const revisions=source.context.personalSemanticAnchorRevisionIds.map(id=>record.personalSemanticAnchorRevisions.find(revision=>revision.personalSemanticAnchorRevisionId===id)!);
  const mediaIds=[...new Set(revisions.flatMap(revision=>revision.personalMediaObjectId?[revision.personalMediaObjectId]:[]))];
  const loaded=await Promise.all(mediaIds.map(id=>{if(!images.has(id))images.set(id,read(id));return images.get(id)!;}));
  return {...source,context:{...source.context,images:orderPersonalContextImages(record,source.context.personalSemanticAnchorRevisionIds,[...source.context.images,...loaded])}};
 }));
}

/**
 * Resolve every learnable Binding on one active Alignment directly from the
 * authoritative Personal Semantic World aggregate. Incomplete records and
 * incompatible Binding versions deliberately yield no source. Registry heads
 * may advance without replacing an Alignment's explicitly accepted versions.
 */
const meaningLearningSources = (
  record: MeaningJourneyRecord,
  registry: RegistryRead,
  alignmentId?: string,
  contextRevisionIds?: readonly string[],
  historical=false,
): PersonalMeaningLearningSource[] => record.alignments
  .filter((alignment) => (
    (historical||isAlignmentActive(record,alignment))
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
      : currentMeaningContextRevisions(record);
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
          images: sceneImages(record, [...revisionIds]),
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

/** Current user selection is different from validating a frozen historical source. */
export const buildPersonalMeaningLearningSources=(record:MeaningJourneyRecord,registry:RegistryRead,alignmentId?:string,contextRevisionIds?:readonly string[])=>
 record.personalMeaning.status==='active'?meaningLearningSources(record,registry,alignmentId,contextRevisionIds):[];

export function resolvePinnedPersonalMeaningLearningSource(record:MeaningJourneyRecord,registry:RegistryRead,reference:PersonalMeaningLearningSource['reference'],contextRevisionIds?:readonly string[]):PersonalMeaningLearningSource|null{
 const alignment=record.alignments.find(row=>row.personalMeaningAlignmentId===reference.personalMeaningAlignmentId);
 if(!alignment||alignment.revision!==reference.alignmentRevision||alignmentStatusAt(record.alignmentEvents,alignment.personalMeaningAlignmentId,reference.alignmentRevision)!=='active')return null;
 return meaningLearningSources(record,registry,alignment.personalMeaningAlignmentId,contextRevisionIds,true).find(source=>canonicalConsumerJson(source.reference)===canonicalConsumerJson(reference))??null;
}
