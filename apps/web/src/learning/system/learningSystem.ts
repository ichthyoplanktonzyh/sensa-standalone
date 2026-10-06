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
  LearningRuntimeWorkspaceProjection,
  LearningManagementProjection,
  LearningHistoryProjection,
  LearningTargetDetailProjection,
  LearningBookPlanProjection,
} from './learningReadModels';
export {
  LEARNING_LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  LEARNING_LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND,
} from './learningReadModels';
export type {
  LearningBookPlanProjection,LearningBookRangeSelection,LearningBookMode,
  FourStageInitialSessionProjection,
  FourStageReviewAnswer,
  FourStageReviewSessionProjection,
  FourStageTargetPresentation,
  LearningAction,
  LearningCurriculumEnrollmentProjection,
  LearningFourStageInitialRuntimeProjection,
  LearningFourStageReviewRuntimeProjection,
  LearningHomeProjection,
  LearningManagementProjection,
  LearningHistoryProjection,
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
  LearningRuntimeWorkspaceProjection,
  LearningSemanticMemoryProjection,
  LearningSourceKind,
  LearningStructuredRuntimeProjection,
  LearningTargetPresentation,
  LearningTargetProjection,
  LearningTargetDetailProjection,
  LearningTargetState,
  LearningWorkspaceProjection,
} from './learningReadModels';

export interface PersonalLearningEnrollment {
  readonly provisioningTaskId: string;
  readonly provisioningStatus: 'waiting' | 'ready';
}

export type LearningCommand =
  | Readonly<{kind:'end_session';operationId:string;runId:string;expectedRevision:number;at?:string}>
  | Readonly<{kind:'change_book_plan';operationId:string;enrollmentId:string;expectedRevision:number;languageContext:SensaFormalPinnedLanguageContext;mode:import('../../data/library/bookPlans').BookEnrollmentMode;selection:import('../../data/library/bookPlans').BookRangeSelection}>
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
      sessionIntent?:'mixed'|'review_only';
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
      requiredPurpose?: 'relearning';
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
      dailyLimit: number | null;
      at?: string;
    }>;

export type LearningCommandResult<Command extends LearningCommand> =
  Command['kind'] extends 'prepare_direct' ? {targetId:string;status:'ready'|'already_in_scope'|'needs_generation'}
    : Command['kind'] extends 'enroll_direct' ? DirectLearningEnrollment
    : Command['kind'] extends 'enroll_package' | 'enroll_book' | 'prepare_queue' ? string[]
    : Command['kind'] extends 'enroll_personal' ? PersonalLearningEnrollment
      : boolean;

export type LearningQuery =
  | Readonly<{kind:'book_plans';languageContext:SensaFormalPinnedLanguageContext}>
  | Readonly<{kind:'target';targetId:string;languageContext:SensaFormalPinnedLanguageContext;clock?:number}>
  | Readonly<{kind:'history';languageContext:SensaFormalPinnedLanguageContext;filter:import('./learningHistoryModel').LearningHistoryFilter;clock?:number;cursor?:import('./learningHistoryModel').LearningHistoryCursor|null;limit?:number}>
  | Readonly<{kind:'management';languageContext:SensaFormalPinnedLanguageContext;clock?:number}>
  | Readonly<{kind:'preferences';languageContext:SensaFormalPinnedLanguageContext}>
  | Readonly<{kind:'runtime';languageContext:SensaFormalPinnedLanguageContext;clock?:number}>
  | Readonly<{kind:'direct_choices';query:string;targetLanguageTag:string;page:number}>
  | Readonly<{kind:'direct_enrollment';enrollmentId:string}>
  | Readonly<{kind:'direct_source';reference:DirectLearningReference;expectedDigest?:string}>
  | Readonly<{ kind: 'home'; languageContext: SensaFormalPinnedLanguageContext; clock?: number }>
  | Readonly<{
      kind: 'workspace';
      languageContext: SensaFormalPinnedLanguageContext;
      clock?: number;
    }>
  | Readonly<{ kind: 'personal_enrollment_index' }>
  | Readonly<{ kind: 'semantic_memory' }>;

export type LearningQueryResult<Query extends LearningQuery> =
  Query['kind'] extends 'book_plans'?readonly LearningBookPlanProjection[]
  : Query['kind'] extends 'target'?LearningTargetDetailProjection
  : Query['kind'] extends 'history'?LearningHistoryProjection
  : Query['kind'] extends 'management'?LearningManagementProjection
  : Query['kind'] extends 'preferences'?Pick<LearningManagementProjection,'dailyLimit'|'policyOptions'>
  : Query['kind'] extends 'runtime' ? LearningRuntimeWorkspaceProjection
    : Query['kind'] extends 'direct_choices' ? DirectLearningChoicePage
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
  book_plans:['curriculumEnrollments','packageCache','packageInstallations','meta'],
  target:['learningTargets','learningRuns','packageCache','settings','meta'],
  history:['learningRuns','learningTargets','meta'],
  management:['packageCache','packageInstallations','learningTargets','learningRuns','curriculumEnrollments','settings','meta'],
  preferences:['settings','meta'],
  runtime:['packageCache','learningTargets','learningRuns','settings','meta'],
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
