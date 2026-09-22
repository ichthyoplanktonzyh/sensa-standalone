import { readHomeLearningRecords } from '../../data/library/store';
import type {
  HomeLearningProjection,
  LearningCommand,
  LearningQuery,
  PersonalLearningControl,
} from './learningSystem';

export const executeLearningCommand = async (command: LearningCommand): Promise<unknown> => {
  switch (command.kind) {
    case 'enroll_package': {
      const { enrollPackage } = await import('../../data/library/learning');
      return enrollPackage(command.operationId, command.packageKey, command.languageContext);
    }
    case 'confirm_quantity': {
      const { confirmLearningQuantity } = await import('../../data/library/learning');
      return confirmLearningQuantity(command.operationId, command.languageContext, command.dailyLimit);
    }
    case 'start': {
      const { startLearning } = await import('../../data/library/learning');
      return startLearning(
        command.operationId,
        command.targetId,
        command.languageContext,
        command.dailyLimit,
        command.at,
      );
    }
    case 'act': {
      const { actLearning } = await import('../../data/library/learning');
      return actLearning(
        command.operationId,
        command.runId,
        command.expectedRevision,
        command.action,
        command.at,
      );
    }
    case 'finish': {
      const { finishLearning } = await import('../../data/library/learning');
      return finishLearning(command.operationId, command.runId);
    }
    case 'continue': {
      const { continueLearning } = await import('../../data/library/learning');
      return continueLearning(
        command.operationId,
        command.runId,
        command.targetId,
        command.languageContext,
        command.dailyLimit,
        command.at,
      );
    }
    case 'set_declared_mastery': {
      const { setLocalDeclaredMastery } = await import('../../data/library/learning');
      return setLocalDeclaredMastery(
        command.operationId,
        command.targetId,
        command.active,
        command.at,
      );
    }
    case 'select_policy': {
      const { selectLocalLearningPolicy } = await import('../../data/library/learning');
      return selectLocalLearningPolicy(
        command.operationId,
        command.targetId,
        command.languageContext,
        command.profileId,
      );
    }
    case 'enroll_personal': {
      const { enrollPersonal } = await import('../../data/library/personalLearning');
      return enrollPersonal(
        command.operationId,
        command.source,
        command.languageContext,
        command.useContext,
      );
    }
    case 'stop_personal_preparation': {
      const { stopPersonalPreparation } = await import('../../data/library/personalLearning');
      return stopPersonalPreparation(command.operationId, command.taskId);
    }
    case 'prepare_personal': {
      const {
        personalLearningControlSnapshot,
        preparePersonal,
      } = await import('../../data/library/personalLearning');
      const { providers } = await personalLearningControlSnapshot();
      return preparePersonal(
        command.taskId,
        command.source,
        providers.content,
        providers.review,
        command.signal,
        () => {},
      );
    }
    case 'update_personal_resources': {
      const { requestPersonalResourceUpdate } = await import('../../data/library/personalLearning');
      return requestPersonalResourceUpdate(
        command.operationId,
        command.taskId,
        command.source,
        command.languageContext,
        command.useContext,
      );
    }
  }
};

export const readLearningQuery = async (query: LearningQuery): Promise<unknown> => {
  switch (query.kind) {
    case 'overview': {
      const { readLearningOverview } = await import('../../data/library/learning');
      return readLearningOverview();
    }
    case 'state': {
      const { readLearning } = await import('../../data/library/learning');
      return readLearning();
    }
    case 'targets': {
      const { learningTargetsSnapshot } = await import('../../data/library/learning');
      return learningTargetsSnapshot();
    }
    case 'home': {
      const stored = await readHomeLearningRecords(query.languageRouteId);
      return {
        targets: stored.targets,
        availablePackageKeys: new Set(stored.availablePackageKeys),
        activeRun: stored.activeRun,
        dailyLimit: stored.dailyLimit,
      } satisfies HomeLearningProjection;
    }
    case 'personal_tasks': {
      const { personalLearningSnapshot } = await import('../../data/library/personalLearning');
      return personalLearningSnapshot();
    }
    case 'personal_control': {
      const { personalLearningControlSnapshot } = await import('../../data/library/personalLearning');
      const snapshot = await personalLearningControlSnapshot();
      return {
        tasks: snapshot.tasks,
        targets: snapshot.targets,
        preparationAvailable: true,
      } satisfies PersonalLearningControl;
    }
  }
};
