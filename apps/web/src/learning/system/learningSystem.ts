import type { SensaFormalPinnedLanguageContext } from '@sensa/contracts/sensa';

import type { LearningEvent } from '../../data/library/learning';
import type { PersonalLearning } from '../../data/library/personalLearning';
import type { PersonalMeaningLearningSource } from '../../data/library/personalLearningSource';
import { observeLibrary, type Table } from '../../data/library/store';
import type { HomeLearningStorageProjection, HomeLearningTargetRecord } from '../../data/library/homeLearningRecords';
import type { LocalLearningAction, LocalLearningRun, LocalLearningTarget } from '../runtime/localProtocol';
import type { LearningPolicyId } from '../runtime/policyProfiles';
import type { LocalStudyPlan } from '../../data/library/studyPlans';

export type LearningTargetView = LocalLearningTarget;
export type LearningRunView = LocalLearningRun;
export type LearningAction = LocalLearningAction;
export type LearningPolicy = LearningPolicyId;
export type PersonalLearningView = PersonalLearning;

export interface LearningOverview {
  targets: LocalLearningTarget[];
  runs: LocalLearningRun[];
  active: string | undefined;
  studyPlans: Record<string, LocalStudyPlan>;
}

export interface LearningState {
  targets: LocalLearningTarget[];
  runs: LocalLearningRun[];
  events: LearningEvent[];
  active: string | undefined;
  studyPlans: Record<string, LocalStudyPlan>;
}

export interface HomeLearningProjection {
  readonly targets: readonly HomeLearningTargetRecord[];
  readonly availablePackageKeys: ReadonlySet<string>;
  readonly activeRun: HomeLearningStorageProjection['activeRun'];
  readonly dailyLimit: number | undefined;
}

export interface PersonalLearningControl {
  readonly tasks: PersonalLearning[];
  readonly targets: LocalLearningTarget[];
  readonly preparationAvailable: boolean;
}

export type LearningCommand =
  | Readonly<{
      kind: 'enroll_package';
      operationId: string;
      packageKey: string;
      languageContext: SensaFormalPinnedLanguageContext;
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
      action: LocalLearningAction;
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
      profileId: LearningPolicyId;
    }>
  | Readonly<{
      kind: 'enroll_personal';
      operationId: string;
      source: PersonalMeaningLearningSource;
      languageContext: SensaFormalPinnedLanguageContext;
      useContext: boolean;
    }>
  | Readonly<{
      kind: 'stop_personal_preparation';
      operationId: string;
      taskId: string;
    }>
  | Readonly<{
      kind: 'prepare_personal';
      taskId: string;
      source: PersonalMeaningLearningSource;
      signal: AbortSignal;
    }>
  | Readonly<{
      kind: 'update_personal_resources';
      operationId: string;
      taskId: string;
      source: PersonalMeaningLearningSource;
      languageContext: SensaFormalPinnedLanguageContext;
      useContext: boolean;
    }>;

export type LearningCommandResult<Command extends LearningCommand> =
  Command['kind'] extends 'enroll_package' ? string[]
    : Command['kind'] extends 'start' | 'act' | 'continue' ? LocalLearningRun
      : Command['kind'] extends 'select_policy' ? LocalLearningTarget
        : Command['kind'] extends 'enroll_personal' | 'update_personal_resources' ? PersonalLearning
          : Command['kind'] extends 'prepare_personal' ? void
            : boolean;

export type LearningQuery =
  | Readonly<{ kind: 'overview' }>
  | Readonly<{ kind: 'state' }>
  | Readonly<{ kind: 'targets' }>
  | Readonly<{ kind: 'home'; languageRouteId: string }>
  | Readonly<{ kind: 'personal_tasks' }>
  | Readonly<{ kind: 'personal_control' }>;

export type LearningQueryResult<Query extends LearningQuery> =
  Query['kind'] extends 'overview' ? LearningOverview
    : Query['kind'] extends 'state' ? LearningState
      : Query['kind'] extends 'targets' ? LocalLearningTarget[]
        : Query['kind'] extends 'home' ? HomeLearningProjection
        : Query['kind'] extends 'personal_tasks' ? PersonalLearning[]
          : PersonalLearningControl;

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
  overview: [
    'learningTargets',
    'learningRuns',
    'learningEvents',
    'settings',
    'meta',
  ],
  state: ['learningTargets', 'learningRuns', 'learningEvents', 'settings', 'meta'],
  targets: ['learningTargets'],
  home: ['packageCache', 'packageInstallations', 'learningTargets', 'learningRuns', 'settings', 'meta'],
  personal_tasks: ['personalLearning'],
  personal_control: ['learningTargets', 'personalLearning', 'providers', 'settings'],
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
