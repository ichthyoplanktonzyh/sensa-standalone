import { stableUuid } from '@sensa/learning-kernel';

import {
  advanceInterleavedLearningRetries,
  type InterleavedLearningRetry,
} from './learningPlanning';
import {
  readLearningHomeProjection,
  readLearningPersonalEnrollmentIndex,
  readLearningSemanticMemoryProjection,
  readLearningWorkspaceProjection,
  readLearningRuntimeProjection,
  readLearningManagementProjection,
  readLearningPreferencesProjection,
  readLearningHistoryProjection,
  readLearningTargetDetailProjection,
  removeRetryTarget,
} from './learningProjection';
import type { LearningCommand, LearningQuery } from './learningSystem';

const retriesByLanguageRoute = new Map<string, readonly InterleavedLearningRetry[]>();

const retriesFor = (languageRouteId: string) => (
  retriesByLanguageRoute.get(languageRouteId) ?? []
);

const setRetries = (languageRouteId: string, retries: readonly InterleavedLearningRetry[]) => {
  if (retries.length) retriesByLanguageRoute.set(languageRouteId, retries);
  else retriesByLanguageRoute.delete(languageRouteId);
};

export const executeLearningCommand = async (command: LearningCommand): Promise<unknown> => {
  // A caller-supplied timestamp cannot turn future eligibility into a fact.
  // Deterministic tests and UI acceptance advance the actual injected clock.
  if('at' in command&&command.at!==undefined&&(!Number.isFinite(Date.parse(command.at))||Date.parse(command.at)>Date.now()))throw new Error('localFlow.clockChanged');
  switch (command.kind) {
    case 'prepare_direct': {
      const {prepareDirectPublishedLearning}=await import('../../data/library/learning');
      return prepareDirectPublishedLearning(command.operationId,command.enrollmentId);
    }
    case 'enroll_direct': {
      const {enrollDirectSense}=await import('../../data/library/directLearningEnrollment');
      return enrollDirectSense(command);
    }
    case 'enroll_package': {
      const { enrollPackage } = await import('../../data/library/learning');
      return enrollPackage(
        command.operationId,
        command.packageKey,
        command.languageContext,
        command.publicationArchiveSha256,
      );
    }
    case 'enroll_book': {
      const { enrollBook } = await import('../../data/library/learning');
      return enrollBook(
        command.operationId,
        command.languageContext,
        command.publicationArchiveSha256,
      );
    }
    case 'confirm_quantity': {
      const { confirmLearningQuantity } = await import('../../data/library/learning');
      await confirmLearningQuantity(command.operationId, command.languageContext, command.dailyLimit);
      return true;
    }
    case 'prepare_queue': {
      const {prepareLearningQueue}=await import('../../data/library/learning');
      return prepareLearningQueue(command.languageContext,command.at);
    }
    case 'start': {
      const { startLearning } = await import('../../data/library/learning');
      await startLearning(
        command.operationId,
        command.targetId,
        command.languageContext,
        command.dailyLimit,
        command.at,
        command.sessionIntent,
      );
      return true;
    }
    case 'act': {
      const { actLearning } = await import('../../data/library/learning');
      const run = await actLearning(
        command.operationId,
        command.runId,
        command.expectedRevision,
        command.action,
        command.at,
      );
      if (command.action.kind === 'rate') {
        const routeId = run.languageContext.languageRouteId;
        setRetries(routeId, advanceInterleavedLearningRetries(
          retriesFor(routeId),
          run.targetId,
          command.action.rating === 'again',
        ));
      }
      return true;
    }
    case 'finish': {
      const { finishLearning } = await import('../../data/library/learning');
      await finishLearning(command.operationId, command.runId);
      return true;
    }
    case 'continue': {
      const { continueLearning } = await import('../../data/library/learning');
      await continueLearning(
        command.operationId,
        command.runId,
        command.targetId,
        command.languageContext,
        command.dailyLimit,
        command.at,
        command.requiredPurpose,
      );
      return true;
    }
    case 'set_declared_mastery': {
      const { prepareLearningQueue, setLocalDeclaredMastery,readActiveLearningSessionIntent } = await import('../../data/library/learning');
      const at=command.at??new Date().toISOString();
      const intent=await readActiveLearningSessionIntent();
      await setLocalDeclaredMastery(
        command.operationId,
        command.targetId,
        command.active,
        at,
      );
      if(command.active&&intent!=='review_only')await prepareLearningQueue(command.languageContext,at,command.operationId);
      return true;
    }
    case 'select_policy': {
      const { selectLocalLearningPolicy } = await import('../../data/library/learning');
      await selectLocalLearningPolicy(
        command.operationId,
        command.targetId,
        command.languageContext,
        command.profileId,
      );
      return true;
    }
    case 'enroll_personal': {
      const { requestPersonalContentProvisioning } = await import(
        '../../contentSupply/provisioning/requestProvisioning'
      );
      return requestPersonalContentProvisioning(command);
    }
    case 'declare_mastery_and_continue': {
      const { prepareLearningQueue, setLocalDeclaredMastery, startLearning,readActiveLearningSessionIntent } = await import('../../data/library/learning');
      const at = command.at ?? new Date().toISOString();
      const sessionIntent=await readActiveLearningSessionIntent();
      await setLocalDeclaredMastery(
        stableUuid(`${command.operationId}:declare-mastery`),
        command.targetId,
        true,
        at,
      );
      const routeId = command.languageContext.languageRouteId;
      setRetries(routeId, removeRetryTarget(retriesFor(routeId), command.targetId));
      if (command.dailyLimit === null) return false;
      if(sessionIntent!=='review_only')await prepareLearningQueue(command.languageContext,at,command.operationId);
      const workspace = await readLearningRuntimeProjection({
        languageContext: command.languageContext,
        clock: Date.parse(at),
        retries: retriesFor(routeId),
        sessionIntent,
      });
      const nextTargetId = workspace.nextTargetId;
      if (!nextTargetId) return false;
      await startLearning(
        stableUuid(`${command.operationId}:start-next`),
        nextTargetId,
        command.languageContext,
        command.dailyLimit,
        at,
        sessionIntent,
      );
      return true;
    }
    case 'advance': {
      const { continueLearning, finishLearning } = await import('../../data/library/learning');
      const at = command.at ?? new Date().toISOString();
      const routeId = command.languageContext.languageRouteId;
      const workspace = await readLearningRuntimeProjection({
        languageContext: command.languageContext,
        clock: Date.parse(at),
        retries: retriesFor(routeId),
      });
      const nextTargetId = workspace.nextTargetId;
      if (nextTargetId) {
        await continueLearning(
          stableUuid(`${command.operationId}:continue-next`),
          command.runId,
          nextTargetId,
          command.languageContext,
          command.dailyLimit,
          at,
        );
        return true;
      }
      await finishLearning(stableUuid(`${command.operationId}:finish`), command.runId);
      return false;
    }
  }
};

export const readLearningQuery = async (query: LearningQuery): Promise<unknown> => {
  switch (query.kind) {
    case 'target':return readLearningTargetDetailProjection({targetId:query.targetId,languageContext:query.languageContext,clock:query.clock??Date.now()});
    case 'history':return readLearningHistoryProjection({request:{...query.filter,activeLanguageTag:query.languageContext.targetLanguageTag,clock:query.cursor?.clock??query.clock??Date.now(),cursor:query.cursor??null,limit:query.limit??20}});
    case 'management':return readLearningManagementProjection({languageContext:query.languageContext,clock:query.clock??Date.now()});
    case 'preferences':return readLearningPreferencesProjection(query.languageContext);
    case 'runtime':return readLearningRuntimeProjection({languageContext:query.languageContext,clock:query.clock??Date.now(),retries:retriesFor(query.languageContext.languageRouteId)});
    case 'direct_choices': {
      const {readDirectLearningChoices}=await import('./directLearningChoices');
      return readDirectLearningChoices({query:query.query,targetLanguageTag:query.targetLanguageTag,page:query.page});
    }
    case 'direct_enrollment': {
      const {readDirectLearningEnrollment}=await import('../../data/library/directLearningEnrollment');
      return readDirectLearningEnrollment(query.enrollmentId);
    }
    case 'direct_source': {
      const [{readLibrary,assertCurrentLibrary},{resolveDirectLearningSource}]=await Promise.all([
        import('../../data/library/store'),import('./directLearningSource'),
      ]);
      return readLibrary(async tx=>{await assertCurrentLibrary(tx);return resolveDirectLearningSource(tx,query.reference,query.expectedDigest);});
    }
    case 'home': {
      return readLearningHomeProjection({
        languageRouteId: query.languageRouteId,
        clock: query.clock ?? Date.now(),
      });
    }
    case 'workspace': {
      return readLearningWorkspaceProjection({
        languageContext: query.languageContext,
        clock: query.clock ?? Date.now(),
        retries: retriesFor(query.languageContext.languageRouteId),
      });
    }
    case 'personal_enrollment_index': {
      return readLearningPersonalEnrollmentIndex();
    }
    case 'semantic_memory': {
      return readLearningSemanticMemoryProjection();
    }
  }
};
