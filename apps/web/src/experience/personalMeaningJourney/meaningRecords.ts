/** Personal Meaning record reads and revision facts; caller owns the transaction. */
import type {SensaPersonalExpressionAnchorSnapshot,SensaPersonalExpressionAnchorRevisionSnapshot} from '@sensa/contracts/sensa';
import type {MeaningJourneyRecord} from './store';
import type {JourneyFactPorts} from './ports';
const PSW='sensa-personal-semantic-world-v3' as const;

/** Context order comes from its recorded introductions, not a replica's fact
 * array order. Replacement retires all previous anchors and introduces fresh
 * IDs; appends introduce only the new ID. Later references to an existing
 * anchor (correction, binding, lifecycle) must never move it. */
export function orderedMeaningContextAnchors(record:MeaningJourneyRecord,introducedAnchorIds:readonly string[]=[]){
  const anchors=new Map(record.personalSemanticAnchors.map(anchor=>[anchor.personalSemanticAnchorId,anchor]));
  const births=new Map<string,string[]>();
  for(const anchor of anchors.values()){
    const first=record.personalSemanticAnchorRevisions.find(revision=>revision.personalSemanticAnchorId===anchor.personalSemanticAnchorId&&revision.revision===1);
    if(first){const group=births.get(first.provenance.createdByOperationId)??[];group.push(anchor.personalSemanticAnchorId);births.set(first.provenance.createdByOperationId,group);}
  }
  const ordered=new Set<string>();
  for(const revision of [...record.personalMeaningRevisions].sort((a,b)=>a.revision-b.revision)){
    for(const id of revision.provenance.sourceReferenceIds)if(anchors.has(id))ordered.add(id);
    // A sole Context introduced by this revision has an unambiguous position
    // even when its provenance lists a published Scene/release rather than its
    // own ID. Multiple materials require their recorded input order.
    const born=births.get(revision.provenance.createdByOperationId);
    if(born?.length===1)ordered.add(born[0]!);
  }
  for(const id of introducedAnchorIds)if(anchors.has(id))ordered.add(id);
  if(ordered.size!==anchors.size)throw Error('localFlow.meaningChanged');
  return [...ordered].map(id=>anchors.get(id)!);
}

export function currentMeaningContextRevisions(record:MeaningJourneyRecord){
  const revisions=new Map(record.personalSemanticAnchorRevisions.map(revision=>[`${revision.personalSemanticAnchorId}:${revision.revision}`,revision]));
  return orderedMeaningContextAnchors(record).filter(anchor=>anchor.status==='active').map(anchor=>{
    const revision=revisions.get(`${anchor.personalSemanticAnchorId}:${anchor.currentRevision}`);
    if(!revision)throw Error('localFlow.meaningChanged');return revision;
  });
}

export function activeExpressionAnchors(record: MeaningJourneyRecord) {
  return record.personalExpressionAnchors.filter((anchor) => anchor.status === 'active');
}

export function currentExpressionAnchorRevision(
  record: MeaningJourneyRecord,
  anchor: SensaPersonalExpressionAnchorSnapshot,
): SensaPersonalExpressionAnchorRevisionSnapshot | null {
  return record.personalExpressionAnchorRevisions.find(
    (revision) =>
      revision.personalExpressionAnchorId === anchor.personalExpressionAnchorId
      && revision.revision === anchor.currentRevision,
  ) ?? null;
}

export function activeSourceExpressionAnchors(record: MeaningJourneyRecord) {
  const boundRevisions=new Set([
    ...record.bindingConfirmations.map(fact=>fact.personalExpressionAnchorRevisionId),
    ...record.semanticAcceptances.map(fact=>fact.personalExpressionAnchorRevisionId),
  ]);
  return activeExpressionAnchors(record).filter((anchor) => {
    const revision=currentExpressionAnchorRevision(record,anchor);
    return revision!==null&&!boundRevisions.has(revision.personalExpressionAnchorRevisionId);
  });
}

export function activeExperienceAnchors(record: MeaningJourneyRecord,introducedAnchorIds:readonly string[]=[]) {
  return orderedMeaningContextAnchors(record,introducedAnchorIds).filter((anchor) => anchor.status === 'active');
}

export function displayLabel(record: MeaningJourneyRecord,introducedAnchorIds:readonly string[]=[]): string | null {
  const familiar = activeSourceExpressionAnchors(record)
    .map((anchor) => record.personalExpressionAnchorRevisions.find(
      (revision) =>
        revision.personalExpressionAnchorId === anchor.personalExpressionAnchorId
        && revision.revision === anchor.currentRevision,
    )?.surfaceForm)
    .find(Boolean);
  if (familiar) return familiar;
  const experience = activeExperienceAnchors(record,introducedAnchorIds)
    .map((anchor) => record.personalSemanticAnchorRevisions.find(
      (revision) =>
        revision.personalSemanticAnchorId === anchor.personalSemanticAnchorId
        && revision.revision === anchor.currentRevision,
    )?.bodyText)
    .find(Boolean);
  if (!experience) return null;
  return experience.length > 24 ? `${experience.slice(0, 24)}…` : experience;
}

export function latestMeaningRevision(record: MeaningJourneyRecord) {
  return record.personalMeaningRevisions.find(
    (revision) => revision.revision === record.personalMeaning.currentRevision,
  ) ?? record.personalMeaningRevisions.at(-1);
}

export function appendMeaningRevision(
  ports: JourneyFactPorts,
  record: MeaningJourneyRecord,
  operationId: string,
  sourceReferenceIds: string[],
): string {
  const nextRevision = record.personalMeaning.currentRevision + 1;
  const revisionId = ports.newId();
  const now = ports.nowIso();
  record.personalMeaning.currentRevision = nextRevision;
  record.personalMeaning.updatedAt = now;
  record.personalMeaningRevisions.push({
    contractVersion: PSW,
    personalMeaningRevisionId: revisionId,
    personalMeaningId: record.personalMeaning.personalMeaningId,
    revision: nextRevision,
    displayLabel: displayLabel(record,sourceReferenceIds),
    learnerIntentNote: latestMeaningRevision(record)?.learnerIntentNote ?? null,
    ...(latestMeaningRevision(record)?.savedDraft?{savedDraft:true as const}:{}),
    ...(latestMeaningRevision(record)?.draftExpression!==undefined?{draftExpression:latestMeaningRevision(record)!.draftExpression}:{}),
    ...(latestMeaningRevision(record)?.personalSenseWording!==undefined?{personalSenseWording:latestMeaningRevision(record)!.personalSenseWording}:{}),
    provenance: {
      kind: 'learner_authored',
      sourceReferenceIds: sourceReferenceIds.length > 0
        ? sourceReferenceIds
        : [record.personalMeaning.personalMeaningId],
      createdByOperationId: operationId,
    },
    createdAt: now,
  });
  return revisionId;
}
