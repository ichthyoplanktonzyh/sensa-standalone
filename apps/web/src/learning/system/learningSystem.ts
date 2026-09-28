import type { SensaFormalPinnedLanguageContext } from '@sensa/contracts/sensa';

import type { PersonalMeaningLearningSource } from '../../contentSupply/provisioning/contracts';
import { observeLibrary, type Table } from '../../data/library/store';
import type {
  LearningAction,
  LearningHomeProjection,
  LearningPersonalEnrollmentIndex,
  LearningPolicy,
  LearningSemanticMemoryProjection,
  LearningWorkspaceProjection,
} from './learningReadModels';
export {
  LEARNING_LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  LEARNING_LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND,
} from './learningReadModels';
export type {
  FourStageInitialSessionProjection,
  FourStageReviewAnswer,
  FourStageReviewSessionProjection,
  FourStageTargetPresentation,
  LearningAction,
  LearningFourStageInitialRuntimeProjection,
  LearningFourStageReviewRuntimeProjection,
  LearningHomeProjection,
  LearningLightweightRuntimeProjection,
  LearningLightweightRating,
  LearningLightweightStepProjection,
  LearningPersonalEnrollmentIndex,
  LearningPolicy,
  LearningPolicyOption,
  LearningPurpose,
  LearningQueueProjection,
  LearningReadiness,
  LearningRecordKind,
  LearningRecordProjection,
  LearningRuntimeCapability,
  LearningRuntimeProjection,
  LearningSemanticMemoryProjection,
  LearningSourceKind,
  LearningStructuredRuntimeProjection,
  LearningTargetPresentation,
  LearningTargetProjection,
  LearningTargetState,
  LearningWorkspaceProjection,
} from './learningReadModels';

export interface PersonalLearningEnrollment {
  readonly provisioningTaskId: string;
  readonly provisioningStatus: 'waiting' | 'ready';
}

export type LearningCommand =
  | Readonly<{
      kind: 'enroll_package';
      operationId: string;
      packageKey: string;
      languageContext: SensaFormalPinnedLanguageContext;
      publicationArchiveSha256?: string;
    }>
  | Readonly<{
      kind: 'confirm_quantity';
      operationId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      dailyLimit: number;
    }>
  | Readonly<{
      kind: 'start';
      operationId: string;
      targetId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      dailyLimit: number;
      at?: string;
    }>
  | Readonly<{
      kind: 'act';
      operationId: string;
      runId: string;
      expectedRevision: number;
      action: LearningAction;
      at?: string;
    }>
  | Readonly<{
      kind: 'finish';
      operationId: string;
      runId: string;
    }>
  | Readonly<{
      kind: 'continue';
      operationId: string;
      runId: string;
      targetId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      dailyLimit: number;
      at?: string;
    }>
  | Readonly<{
      kind: 'set_declared_mastery';
      operationId: string;
      targetId: string;
      active: boolean;
      at?: string;
    }>
  | Readonly<{
      kind: 'select_policy';
      operationId: string;
      targetId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      profileId: LearningPolicy;
    }>
  | Readonly<{
      kind: 'enroll_personal';
      operationId: string;
      source: PersonalMeaningLearningSource;
      languageContext: SensaFormalPinnedLanguageContext;
      useContext: boolean;
    }>
  | Readonly<{
      kind: 'declare_mastery_and_continue';
      operationId: string;
      targetId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      dailyLimit: number | null;
      at?: string;
    }>
  | Readonly<{
      kind: 'advance';
      operationId: string;
      runId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      dailyLimit: number;
      at?: string;
    }>;

export type LearningCommandResult<Command extends LearningCommand> =
  Command['kind'] extends 'enroll_package' ? string[]
    : Command['kind'] extends 'enroll_personal' ? PersonalLearningEnrollment
      : boolean;

export type LearningQuery =
  | Readonly<{ kind: 'home'; languageRouteId: string; clock?: number }>
  | Readonly<{
      kind: 'workspace';
      languageContext: SensaFormalPinnedLanguageContext;
      clock?: number;
    }>
  | Readonly<{ kind: 'personal_enrollment_index' }>
  | Readonly<{ kind: 'semantic_memory' }>;

export type LearningQueryResult<Query extends LearningQuery> =
  Query['kind'] extends 'home' ? LearningHomeProjection
          : Query['kind'] extends 'workspace' ? LearningWorkspaceProjection
            : Query['kind'] extends 'personal_enrollment_index' ? LearningPersonalEnrollmentIndex
              : LearningSemanticMemoryProjection;

/**
 * Stable Learning System deep Module interface.
 *
 * Callers submit learner intents and read coherent projections. Persistence
 * tables, transaction admission, policy registries, protocol reducers,
 * replay/reconciliation and scheduler details remain implementation concerns.
 */
export interface LearningSystem {
  execute<Command extends LearningCommand>(
    command: Command,
  ): Promise<LearningCommandResult<Command>>;
  read<Query extends LearningQuery>(query: Query): Promise<LearningQueryResult<Query>>;
  subscribe(query: LearningQuery, listener: () => void): () => void;
}

const queryTables = {
  home: ['packageCache', 'packageInstallations', 'learningTargets', 'learningRuns', 'settings', 'meta'],
  workspace: ['packageCache', 'packageInstallations', 'learningTargets', 'learningRuns', 'learningEvents', 'settings', 'meta'],
  personal_enrollment_index: ['learningTargets'],
  semantic_memory: ['learningTargets'],
} as const satisfies Record<LearningQuery['kind'], readonly Table[]>;

export const learningSystem: LearningSystem = {
  execute: (async (command: LearningCommand) => {
    const { executeLearningCommand } = await import('./learningSystemImplementation');
    return executeLearningCommand(command);
  }) as LearningSystem['execute'],
  read: (async (query: LearningQuery) => {
    const { readLearningQuery } = await import('./learningSystemImplementation');
    return readLearningQuery(query);
  }) as LearningSystem['read'],
  subscribe: (query, listener) => observeLibrary(listener, queryTables[query.kind]),
};
