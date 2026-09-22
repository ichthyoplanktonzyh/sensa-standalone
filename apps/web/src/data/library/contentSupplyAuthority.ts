import {
  sensaContentGenerationRequestSchema,
  sensaFormalPinnedLanguageContextSchema,
  sensaMaterialCandidateBundleSchema,
} from '@sensa/contracts/sensa';
import { stableUuid } from '@sensa/learning-kernel';
import { z } from 'zod';

import { backupEqual } from './backupCodec';
import { packageInstallationSchema } from './packageRecords';
import type {
  LibraryIdentity,
  LibraryRecordTransition,
  Operation,
  Table,
} from './store';

export const contentSupplyTransitionTables = [
  'packageInstallations',
  'personalLearning',
  'contentAttempts',
] as const satisfies readonly Table[];

export class ContentSupplyInvariantError extends Error {
  constructor(message = 'The Content Supply transition violates its authority boundary.') {
    super(message);
    this.name = 'ContentSupplyInvariantError';
  }
}

type ContentSupplyTable = (typeof contentSupplyTransitionTables)[number];

const allowedPersonalOperations = new Set([
  'personal.enroll',
  'personal.prepare',
  'personal.progress',
  'personal.stop',
  'personal.fail',
  'personal.update-resources',
]);
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

const reject = (message: string): never => {
  throw new ContentSupplyInvariantError(message);
};

/** Admit only Content Supply-owned facts; Learning facts are checked by Learning authority. */
export async function assertContentSupplyTransition(input: {
  identity: LibraryIdentity;
  operation: Operation;
  changes: readonly LibraryRecordTransition<readonly ContentSupplyTable[]>[];
  read: (table: Table, key: string) => Promise<unknown>;
}): Promise<void> {
  const { identity, operation, changes, read } = input;
  for (const change of changes) {
    if (change.after === null) reject('Content Supply facts cannot be physically deleted.');
    if (change.table === 'packageInstallations') {
      if (operation.kind !== 'package.install') reject('Only package installation may write installation facts.');
      const installation = packageInstallationSchema.parse(change.after);
      if (change.key !== installation.key) reject('Package installation identity changed.');
      if (change.before !== null && !backupEqual(change.before, change.after)) {
        reject('An exact package installation fact is immutable.');
      }
      continue;
    }

    if (!allowedPersonalOperations.has(operation.kind)) {
      reject('Only provisioning operations may write learner-private content supply facts.');
    }

    if (change.table === 'personalLearning') {
      const task = change.after as any;
      const context = sensaFormalPinnedLanguageContextSchema.parse(task.languageContext);
      uuid.parse(task.id);
      uuid.parse(task.targetId);
      uuid.parse(task.curriculumMembershipId);
      uuid.parse(task.planRevision);
      timestamp.parse(task.createdAt);
      z.boolean().parse(task.useContext);
      z.number().nonnegative().parse(task.leaseUntil);
      z.string().parse(task.notice);
      if (!['waiting','generating','reviewing','failed','rejected','stopped','ready'].includes(task.status)) {
        reject('Unknown provisioning task state.');
      }
      const source = z.object({
        personalMeaningId: uuid,
        personalMeaningRevisionId: uuid,
        personalMeaningAlignmentId: uuid,
        alignmentRevision: z.number().int().positive(),
        alignmentBasisReferenceId: z.string().min(1),
        meaningFocusId: z.string().nullable(),
        senseId: z.string().min(1),
        senseVersionId: z.string().min(1),
        bindingId: z.string().min(1),
        bindingVersionId: z.string().min(1),
      }).strict().parse(task.source);
      const sourceKey = `${source.personalMeaningAlignmentId}:${source.bindingVersionId}`;
      const expectedTaskId = stableUuid(`sensa-personal-learning:${sourceKey}:${context.languageRouteId}`);
      const expectedTargetId = stableUuid(
        `sensa-learning-target:${identity.learnerId}:${source.senseVersionId}:${source.bindingVersionId}`,
      );
      const expectedMembershipId = stableUuid(
        `local-curriculum-membership:${expectedTargetId}:${context.languageRouteId}:personal_meaning_alignment:${source.personalMeaningAlignmentId}`,
      );
      if (
        change.key !== task.id
        || task.id !== expectedTaskId
        || task.targetId !== expectedTargetId
        || task.curriculumMembershipId !== expectedMembershipId
      ) reject('Provisioning task identity is inconsistent with its pinned source.');
      if (change.before !== null) {
        const before = change.before as any;
        if (
          before.id !== task.id
          || before.targetId !== task.targetId
          || before.curriculumMembershipId !== task.curriculumMembershipId
          || before.createdAt !== task.createdAt
        ) reject('Provisioning task identity is immutable.');
      } else if (operation.kind !== 'personal.enroll') {
        reject('A provisioning task must originate from an explicit Learning enrollment.');
      }
      if (task.attemptId !== null) {
        uuid.parse(task.attemptId);
        const attempt = await read('contentAttempts', task.attemptId) as any;
        if (!attempt || attempt.taskId !== task.id) reject('Provisioning task attempt is missing.');
      }
      if (task.status === 'ready') {
        const target = await read('learningTargets', task.targetId) as any;
        if (!target?.curriculumMemberships?.some((membership: any) => membership.id === task.curriculumMembershipId)) {
          reject('Ready provisioning must hand an admitted materialization to Learning.');
        }
      }
      continue;
    }

    const attempt = change.after as any;
    uuid.parse(attempt.id);
    uuid.parse(attempt.taskId);
    timestamp.parse(attempt.createdAt);
    if (change.key !== attempt.id) reject('Content Agent Attempt identity changed.');
    if (!['generating','reviewing','ready','rejected','stopped','failed'].includes(attempt.status)) {
      reject('Unknown Content Agent Attempt state.');
    }
    const task = await read('personalLearning', attempt.taskId) as any;
    if (!task || task.attemptId !== attempt.id) reject('Content Agent Attempt is not current for its task.');
    if (attempt.request) sensaContentGenerationRequestSchema.parse(attempt.request);
    if (attempt.bundle) {
      sensaMaterialCandidateBundleSchema.parse(attempt.bundle);
      if (!attempt.request || attempt.bundle.contentGenerationRequestId !== attempt.request.contentGenerationRequestId) {
        reject('Candidate bundle does not answer its pinned request.');
      }
    }
    if (attempt.resumedFrom) {
      uuid.parse(attempt.resumedFrom);
      if (!await read('contentAttempts', attempt.resumedFrom)) reject('Resumed attempt is missing.');
    }
    if (change.before === null && operation.kind !== 'personal.prepare') {
      reject('A Content Agent Attempt must originate from an explicit preparation command.');
    }
    if (change.before !== null) {
      const before = change.before as any;
      if (before.id !== attempt.id || before.taskId !== attempt.taskId || before.createdAt !== attempt.createdAt) {
        reject('Content Agent Attempt identity is immutable.');
      }
    }
  }
}
