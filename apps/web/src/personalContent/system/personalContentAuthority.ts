import { z } from 'zod';

import type { LibraryTransaction } from '../../data/library/store';
import type { PersonalContentRecord } from './personalContentSystem';
import {assertSceneAcceptance,assertSceneConflictHistory,sceneHistoryRecords} from './sceneConflictHistory';

const uuid = z.string().uuid();
const timestamp = z.number().int().nonnegative();
const senseReference = z.string().min(1).max(2000);
const image = z.object({
  mediaId: uuid,
  kind: z.literal('image'),
  dataUrl: z.string().startsWith('data:image/').max(8 * 1024 * 1024),
  mimeType: z.string().min(1).max(200),
  fileName: z.string().min(1).max(500),
  altText: z.string().max(80),
}).strict();

const assertBodyOrImage = (body: string, media: readonly unknown[]) => {
  if (!body.trim() && media.length === 0) throw new Error('localFlow.annotationInvalid');
};

const rowId = (kind: PersonalContentRecord['kind'], subject: string) =>
  `${kind}:${encodeURIComponent(subject)}`;

const unchanged = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const assertRecord = async (
  tx: LibraryTransaction,
  key: string,
  record: PersonalContentRecord,
  previous: PersonalContentRecord | null,
) => {
  if (record.id !== key) throw new Error('localFlow.annotationInvalid');
  if (previous && previous.kind !== record.kind) throw new Error('localFlow.annotationInvalid');
  switch (record.kind) {
    case 'sense_note': {
      senseReference.parse(record.senseId);
      z.string().max(1000).parse(record.body);
      z.number().int().positive().parse(record.revision);
      timestamp.parse(record.createdAt);
      timestamp.parse(record.updatedAt);
      if (record.id !== rowId(record.kind, record.senseId)) throw new Error('localFlow.annotationInvalid');
      if (previous?.kind === 'sense_note' && (
        previous.senseId !== record.senseId
        || previous.createdAt !== record.createdAt
        || record.revision !== previous.revision + 1
        || record.updatedAt < previous.updatedAt
      )) throw new Error('localFlow.annotationInvalid');
      return;
    }
    case 'saved_sense':
      senseReference.parse(record.senseId);
      timestamp.parse(record.createdAt);
      if (record.id !== rowId(record.kind, record.senseId)
        || (previous && !unchanged(previous, record))) throw new Error('localFlow.annotationInvalid');
      return;
    case 'saved_example':
      z.string().min(1).max(2000).parse(record.exampleId);
      timestamp.parse(record.createdAt);
      if (record.id !== rowId(record.kind, record.exampleId)
        || (previous && !unchanged(previous, record))) throw new Error('localFlow.annotationInvalid');
      return;
    case 'sense_context': {
      uuid.parse(record.contextId);
      senseReference.parse(record.senseId);
      z.string().max(1000).parse(record.body);
      z.array(image).max(3).parse(record.media);
      z.number().int().positive().parse(record.revision);
      timestamp.parse(record.createdAt);
      timestamp.parse(record.updatedAt);
      assertBodyOrImage(record.body, record.media);
      if (record.id !== rowId(record.kind, record.contextId)) throw new Error('localFlow.annotationInvalid');
      if (previous?.kind === 'sense_context' && (
        previous.contextId !== record.contextId
        || previous.senseId !== record.senseId
        || previous.createdAt !== record.createdAt
        || record.revision !== previous.revision + 1
        || record.updatedAt < previous.updatedAt
      )) throw new Error('localFlow.annotationInvalid');
      return;
    }
    case 'learning_scene': {
      assertSceneConflictHistory(record);
      uuid.parse(record.sceneId);
      uuid.parse(record.learningTargetId);
      uuid.parse(record.languageRouteId);
      uuid.parse(record.senseId);
      uuid.parse(record.senseVersionId);
      uuid.parse(record.bindingVersionId);
      z.number().int().positive().parse(record.currentRevision);
      timestamp.parse(record.createdAt);
      timestamp.parse(record.updatedAt);
      const target = await tx.get<any>('learningTargets', record.learningTargetId);
      if (!target || target.identity?.senseId !== record.senseId
        || target.identity?.senseVersionId !== record.senseVersionId
        || target.identity?.bindingVersionId !== record.bindingVersionId) {
        throw new Error('localFlow.annotationInvalid');
      }
      const memberships = new Set<string>(target.curriculumMemberships
        .filter((membership: any) => (
          membership.languageContext.languageRouteId === record.languageRouteId
        ))
        .map((membership: any) => membership.id));
      for(const snapshot of sceneHistoryRecords(record))for(const revision of snapshot.revisions)if(!memberships.has(revision.curriculumMembershipId))throw new Error('localFlow.annotationInvalid');
      for(const snapshot of sceneHistoryRecords(record))if(snapshot.acceptedPersonalMeaningId)assertSceneAcceptance(snapshot,await tx.get('semanticMeanings',snapshot.acceptedPersonalMeaningId));
      if (record.revisions.length !== record.currentRevision
        || new Set(record.revisions.map((revision) => revision.revisionId)).size
          !== record.revisions.length) throw new Error('localFlow.annotationInvalid');
      for (const [index, revision] of record.revisions.entries()) {
        uuid.parse(revision.revisionId);
        if (revision.revision !== index + 1 || !memberships.has(revision.curriculumMembershipId)) {
          throw new Error('localFlow.annotationInvalid');
        }
        z.string().max(1000).parse(revision.body);
        z.array(image).max(3).parse(revision.media);
        timestamp.parse(revision.createdAt);
        assertBodyOrImage(revision.body, revision.media);
      }
      if ((record.acceptedRevisionId === null) !== (record.acceptedPersonalMeaningId === null)
        || (record.acceptedRevisionId !== null
          && !record.revisions.some((revision) => revision.revisionId === record.acceptedRevisionId))) {
        throw new Error('localFlow.annotationInvalid');
      }
      if (record.acceptedPersonalMeaningId !== null) uuid.parse(record.acceptedPersonalMeaningId);
      if (record.id !== rowId(record.kind, `${record.learningTargetId}:${record.languageRouteId}`)) {
        throw new Error('localFlow.annotationInvalid');
      }
      if (previous?.kind === 'learning_scene') {
        if(!unchanged(previous.conflictHistory,record.conflictHistory))throw new Error('localFlow.annotationInvalid');
        for (const field of [
          'sceneId',
          'learningTargetId',
          'languageRouteId',
          'senseId',
          'senseVersionId',
          'bindingVersionId',
          'createdAt',
        ] as const) {
          if (previous[field] !== record[field]) throw new Error('localFlow.annotationInvalid');
        }
        if (record.updatedAt < previous.updatedAt
          || record.currentRevision < previous.currentRevision
          || record.currentRevision > previous.currentRevision + 1
          || !record.revisions.slice(0, previous.revisions.length)
            .every((revision, index) => unchanged(revision, previous.revisions[index]))) {
          throw new Error('localFlow.annotationInvalid');
        }
      }
      return;
    }
    default:
      throw new Error('localFlow.annotationInvalid');
  }
};

/** Admit only the Personal Content rows changed by the current command. */
export async function assertPersonalContentChanges(tx: LibraryTransaction) {
  const changes = await tx.proposedChanges(['annotations'] as const);
  for (const change of changes) {
    if (change.after === null) {
      const previous = change.before as PersonalContentRecord | null;
      if (previous?.kind === 'learning_scene' || previous?.kind === 'sense_note') throw new Error('localFlow.annotationInvalid');
      continue;
    }
    await assertRecord(
      tx,
      change.key,
      change.after as PersonalContentRecord,
      change.before as PersonalContentRecord | null,
    );
  }
}
