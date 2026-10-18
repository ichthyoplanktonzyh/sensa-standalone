import {stableLearningTargetId} from '../../learning/runtime/learningIdentity';
import {
  sensaContentGenerationRequestSchema,
  sensaFormalPinnedLanguageContextSchema,
  sensaMaterialCandidateBundleSchema,
} from '@sensa/contracts/sensa';
import { stableUuid } from '@sensa/learning-kernel';
import { z } from 'zod';

import { backupEqual } from './backupCodec';
import {assertReadyContentAttempt} from './contentAttemptEvidence';
import {directProvisioningReferenceSchema,isDirectProvisioningReference,provisioningTaskId,provisioningMembershipId} from '../../contentSupply/provisioning/contracts';
import {curriculumEnrollmentSchema} from './curriculumEnrollments';
import {assertDirectTaskEnrollment,assertDirectAttemptSource} from './directProvisioningAssertions';
import {assertPersonalAttemptSource} from './personalProvisioningAssertions';
import {readPersonalProvisioningSource} from './personalProvisioningSource';
import {assertPersonalContextPin,personalMeaningPinnedRecord} from '../../experience/personalMeaningJourney/learningSource';
import {
  packageInstallationSchema,
  mergePackageInstallationRecovery,
  publicationBookMembership,
  type InstalledPackage,
} from './packageRecords';
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
  'direct.enroll',
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
        const before=packageInstallationSchema.parse(change.before);
        if(!backupEqual(mergePackageInstallationRecovery(before,installation),installation)){
          reject('An exact package installation fact is immutable.');
        }
      }
      const previous=change.before===null?undefined:packageInstallationSchema.parse(change.before);
      const additions=(installation.artifact.bookMemberships??[]).filter(member=>!previous?.artifact.bookMemberships?.some(prior=>backupEqual(prior,member)));
      if(additions.length){
        const cached=await read('packageCache',installation.key) as InstalledPackage|undefined;
        for(const member of additions){
          const publication=cached?.portableOrigin.publications.find(value=>value.bookArchiveSha256===member.archiveSha256);
          if(!publication||!backupEqual(publicationBookMembership(publication),member))reject('Book membership is missing its admitted publication position.');
        }
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
      if (!['waiting','generating','reviewing','failed','rejected','stopped','ready','covered'].includes(task.status)) {
        reject('Unknown provisioning task state.');
      }
      const source = task.source?.kind==='stable_sense'?directProvisioningReferenceSchema.parse(task.source):z.object({
        personalMeaningId: uuid,
        personalMeaningRevisionId: uuid,
        personalMeaningAlignmentId: uuid,
        alignmentRevision: z.number().int().positive(),
        alignmentBasisReferenceId: z.string().min(1),
        meaningFocusId: z.string().nullable(),
        senseId: z.string().min(1),
        senseVersionId: z.string().min(1),
        expressionId: uuid,
        expressionVersionId: uuid,
        bindingId: z.string().min(1),
        bindingVersionId: z.string().min(1),
      }).strict().parse(task.source);
      const direct=isDirectProvisioningReference(source);
      if(direct&&task.contextPin!==undefined)reject('Direct preparation cannot pin personal Context.');
      if(!direct&&task.contextPin!==undefined){
        const current=await read('semanticMeanings',source.personalMeaningId) as any;
        const pinned=change.before===null?current:personalMeaningPinnedRecord(current,source,task.contextPin);
        if(!pinned)reject('Provisioning Context pin is missing its retained source.');
        assertPersonalContextPin(pinned,task.contextPin);
      }
      if(direct){
        const enrollment=curriculumEnrollmentSchema.parse(await read('curriculumEnrollments',source.enrollmentId));
        assertDirectTaskEnrollment(task,enrollment);
        if(enrollment.learnerUserId!==identity.learnerId)reject('Direct provisioning belongs to another learner.');
        if((change.before===null||['generating','reviewing','ready'].includes(task.status))&&enrollment.status!=='active')reject('Direct preparation requires an active enrollment.');
        if(change.before===null&&(operation.input as any)?.enrollmentId!==source.enrollmentId)reject('Direct preparation was not explicitly requested.');
      }
      const expectedTaskId = provisioningTaskId(source,context.languageRouteId);
      const expectedTargetId = stableLearningTargetId(identity.learnerId,source.senseId,source.expressionId);
      const expectedMembershipId = provisioningMembershipId(source,expectedTargetId,context.languageRouteId);
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
        if(direct&&(!backupEqual(before.source,task.source)||before.planRevision!==task.planRevision||!backupEqual(before.languageContext,task.languageContext)))reject('Direct provisioning pins are immutable.');
      } else if (operation.kind !== (direct?'direct.enroll':'personal.enroll')) {
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
      if(task.status==='covered'){
        uuid.parse(task.coveredByMembershipId);
        const target=await read('learningTargets',task.targetId) as any;
        const member=target?.curriculumMemberships?.find((item:any)=>item.id===task.coveredByMembershipId);
        if(!member||member.languageContext.languageRouteId!==context.languageRouteId||member.languageContext.targetLanguageTag!==context.targetLanguageTag||member.languageContext.supportLanguageTag!==context.supportLanguageTag
          ||target.identity.senseId!==source.senseId||target.identity.expressionId!==source.expressionId)reject('Covering membership is missing or has another fixed connection.');
      }else if(task.coveredByMembershipId!==undefined)reject('Unexpected covered preparation reference.');
      continue;
    }

    const attempt = change.after as any;
    uuid.parse(attempt.id);
    uuid.parse(attempt.taskId);
    timestamp.parse(attempt.createdAt);
    if(attempt.status==='ready')assertReadyContentAttempt(attempt);
    else if(attempt.readyAt!==null)reject('Only admitted preparation can have a readiness instant.');
    if (change.key !== attempt.id) reject('Content Agent Attempt identity changed.');
    if (!['generating','reviewing','ready','rejected','stopped','failed'].includes(attempt.status)) {
      reject('Unknown Content Agent Attempt state.');
    }
    const task = await read('personalLearning', attempt.taskId) as any;
    if (!task || task.attemptId !== attempt.id) reject('Content Agent Attempt is not current for its task.');
    if(!backupEqual(attempt.contextPin??null,task.contextPin??null))reject('Content Agent Attempt changed its fixed Context.');
    if(!backupEqual(attempt.fixedInput,{source:task.source,languageContext:task.languageContext,planRevision:task.planRevision,useContext:task.useContext}))reject('Content Agent Attempt changed its fixed preparation input.');
    if(task.source?.kind==='stable_sense'){
      const enrollment=curriculumEnrollmentSchema.parse(await read('curriculumEnrollments',task.source.enrollmentId));
      assertDirectAttemptSource(attempt,task,assertDirectTaskEnrollment(task,enrollment),identity.learnerId);
    }else{
      const source=await readPersonalProvisioningSource({get:async(table,key)=>await read(table,key) as any},attempt.fixedInput.source,attempt.contextPin,true);
      assertPersonalAttemptSource(attempt,task,source,identity.learnerId);
    }
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
      if(before.readyAt!==null&&before.readyAt!==attempt.readyAt)reject('Content Agent Attempt admission time is immutable.');
      if(!backupEqual(before.fixedInput,attempt.fixedInput)||!backupEqual(before.contextPin??null,attempt.contextPin??null))reject('Content Agent Attempt fixed input is immutable.');
    }
  }
}
