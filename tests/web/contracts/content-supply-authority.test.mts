import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultSensaLanguageRoute,
  sensaPinnedLanguageContext,
} from '@sensa/contracts/sensa';
import { stableUuid } from '@sensa/learning-kernel';

import {
  assertContentSupplyTransition,
  ContentSupplyInvariantError,
} from '../../../apps/web/src/data/library/contentSupplyAuthority.ts';
import type { LibraryIdentity, Table } from '../../../apps/web/src/data/library/store.ts';

test('[contract][local-correctness] Content Supply admits only its own transitions', async () => {
  const id = (): string => crypto.randomUUID();
  const identity: LibraryIdentity = {
    id: id(),
    learnerId: id(),
    deviceId: id(),
    createdAt: '2026-09-22T00:00:00.000Z',
    schemaVersion: 2,
  };
  const languageContext = sensaPinnedLanguageContext(defaultSensaLanguageRoute);
  const source = {
    personalMeaningId: id(),
    personalMeaningRevisionId: id(),
    personalMeaningAlignmentId: id(),
    alignmentRevision: 1,
    alignmentBasisReferenceId: id(),
    meaningFocusId: null,
    senseId: id(),
    senseVersionId: id(),
    bindingId: id(),
    bindingVersionId: id(),
  };
  const targetId = stableUuid(
    `sensa-learning-target:${identity.learnerId}:${source.senseVersionId}:${source.bindingVersionId}`,
  );
  const taskId = stableUuid(
    `sensa-personal-learning:${source.personalMeaningAlignmentId}:${source.bindingVersionId}:${languageContext.languageRouteId}`,
  );
  const task = {
    id: taskId,
    source,
    targetId,
    curriculumMembershipId: stableUuid(
      `local-curriculum-membership:${targetId}:${languageContext.languageRouteId}:personal_meaning_alignment:${source.personalMeaningAlignmentId}`,
    ),
    languageContext,
    planRevision: id(),
    useContext: true,
    status: 'waiting',
    attemptId: null,
    leaseUntil: 0,
    notice: '',
    createdAt: '2026-09-22T00:00:00.000Z',
  };
  const read = async (_table: Table, _key: string): Promise<undefined> => undefined;

  await assert.doesNotReject(() => assertContentSupplyTransition({
    identity,
    operation: { id: id(), kind: 'personal.enroll', input: {} },
    changes: [{ table: 'personalLearning', key: taskId, before: null, after: task }],
    read,
  }));

  await assert.rejects(
    () => assertContentSupplyTransition({
      identity,
      operation: { id: id(), kind: 'learning.start', input: {} },
      changes: [{ table: 'personalLearning', key: taskId, before: task, after: { ...task, notice: 'forged' } }],
      read,
    }),
    ContentSupplyInvariantError,
    'Learning commands cannot mutate Content Supply task state',
  );

  await assert.rejects(
    () => assertContentSupplyTransition({
      identity,
      operation: { id: id(), kind: 'personal.stop', input: {} },
      changes: [{ table: 'personalLearning', key: taskId, before: task, after: null }],
      read,
    }),
    ContentSupplyInvariantError,
    'learner-private supply facts use lifecycle states instead of physical deletion',
  );
});
