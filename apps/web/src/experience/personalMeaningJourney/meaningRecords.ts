/** Personal Meaning record reads and revision facts; caller owns the transaction. */
import type {SensaPersonalExpressionAnchorSnapshot,SensaPersonalExpressionAnchorRevisionSnapshot} from '@sensa/contracts/sensa';
import type {MeaningJourneyRecord} from './store';
import type {JourneyFactPorts} from './ports';
const PSW='sensa-personal-semantic-world-v3' as const;

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

export function activeExperienceAnchors(record: MeaningJourneyRecord) {
  return record.personalSemanticAnchors.filter((anchor) => anchor.status === 'active');
}

export function displayLabel(record: MeaningJourneyRecord): string | null {
  const familiar = activeSourceExpressionAnchors(record)
    .map((anchor) => record.personalExpressionAnchorRevisions.find(
      (revision) =>
        revision.personalExpressionAnchorId === anchor.personalExpressionAnchorId
        && revision.revision === anchor.currentRevision,
    )?.surfaceForm)
    .find(Boolean);
  if (familiar) return familiar;
  const experience = activeExperienceAnchors(record)
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
    displayLabel: displayLabel(record),
    learnerIntentNote: latestMeaningRevision(record)?.learnerIntentNote ?? null,
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
