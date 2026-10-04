import type { SensaFormalPinnedLanguageContext } from '@sensa/contracts/sensa';

import type { PersonalMeaningLearningSource } from '../../contentSupply/provisioning/contracts';
import type {DirectLearningReference,DirectLearningSource} from './directLearningSource';
import type {DirectLearningChoicePage} from './directLearningChoices';
export type {DirectLearningChoice,DirectLearningChoicePage} from './directLearningChoices';
export type {DirectLearningReference,DirectLearningSource} from './directLearningSource';
import type {DirectLearningEnrollment} from '../../data/library/directLearningEnrollment';
export type {DirectLearningEnrollment} from '../../data/library/directLearningEnrollment';
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
  LearningCurriculumEnrollmentProjection,
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
  | Readonly<{kind:'prepare_direct';operationId:string;enrollmentId:string}>
  | Readonly<{kind:'enroll_direct';operationId:string;reference:DirectLearningReference;expectedDigest:string;languageContext:SensaFormalPinnedLanguageContext}>
  | Readonly<{
      kind: 'enroll_package';
      operationId: string;
      packageKey: string;
      languageContext: SensaFormalPinnedLanguageContext;
      publicationArchiveSha256?: string;
    }>
  | Readonly<{
      kind: 'enroll_book';
      operationId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      publicationArchiveSha256: string;
    }>
  | Readonly<{
      kind: 'confirm_quantity';
      operationId: string;
      languageContext: SensaFormalPinnedLanguageContext;
      dailyLimit: number;
    }>
  | Readonly<{
      kind:'prepare_queue';
      languageContext:SensaFormalPinnedLanguageContext;
      at?:string;
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
      languageContext:SensaFormalPinnedLanguageContext;
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
  Command['kind'] extends 'prepare_direct' ? {targetId:string;status:'ready'|'already_in_scope'|'needs_generation'}
    : Command['kind'] extends 'enroll_direct' ? DirectLearningEnrollment
    : Command['kind'] extends 'enroll_package' | 'enroll_book' | 'prepare_queue' ? string[]
    : Command['kind'] extends 'enroll_personal' ? PersonalLearningEnrollment
      : boolean;

export type LearningQuery =
  | Readonly<{kind:'direct_choices';query:string;targetLanguageTag:string;page:number}>
  | Readonly<{kind:'direct_enrollment';enrollmentId:string}>
  | Readonly<{kind:'direct_source';reference:DirectLearningReference;expectedDigest?:string}>
  | Readonly<{ kind: 'home'; languageRouteId: string; clock?: number }>
  | Readonly<{
      kind: 'workspace';
      languageContext: SensaFormalPinnedLanguageContext;
      clock?: number;
    }>
  | Readonly<{ kind: 'personal_enrollment_index' }>
  | Readonly<{ kind: 'semantic_memory' }>;

export type LearningQueryResult<Query extends LearningQuery> =
  Query['kind'] extends 'direct_choices' ? DirectLearningChoicePage
    : Query['kind'] extends 'direct_enrollment' ? DirectLearningEnrollment|null
    : Query['kind'] extends 'direct_source' ? DirectLearningSource
    : Query['kind'] extends 'home' ? LearningHomeProjection
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
  direct_choices: ['semanticRegistry','packageCache','packageInstallations','meta'],
  direct_enrollment: ['curriculumEnrollments','learningTargets','meta'],
  direct_source: ['semanticRegistry','packageCache','packageInstallations','meta'],
  home: ['packageCache', 'packageInstallations', 'curriculumEnrollments', 'learningTargets', 'learningRuns', 'settings', 'meta'],
  workspace: ['packageCache', 'packageInstallations', 'curriculumEnrollments', 'learningTargets', 'learningRuns', 'learningEvents', 'settings', 'meta'],
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
