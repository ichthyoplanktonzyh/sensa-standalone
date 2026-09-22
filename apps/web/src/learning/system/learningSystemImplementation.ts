import { readHomeLearningRecords } from '../../data/library/store';
import type {
  HomeLearningProjection,
  LearningCommand,
  LearningQuery,
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
      const { requestPersonalContentProvisioning } = await import(
        '../../contentSupply/provisioning/requestProvisioning'
      );
      return requestPersonalContentProvisioning(command);
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
  }
};
