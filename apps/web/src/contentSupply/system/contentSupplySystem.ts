import type {
  SensaPortableBookDescriptor,
  SensaFormalPinnedLanguageContext,
} from '@sensa/contracts/sensa';

import type { InstalledPackage,InstalledPackageSummary } from '../../data/library/packageRecords';
import type {PackageRouteCount} from '../../data/library/packageCacheProjection';
import type {
  ContentProvisioningTask,
  ContentProvisioningStatus,
  PersonalMeaningLearningSource,
} from '../provisioning/contracts';
import type {
  PortablePackageExport,
  PortablePackagePreview,
} from '../portable/portablePackage';
import {subscribeContentSupply} from './contentSupplySubscriptions';

export type ContentSupplyPackage = InstalledPackageSummary;
export type ContentSupplyRuntimePackage = InstalledPackage;
export type ContentSupplyCatalogItem = SensaPortableBookDescriptor;

export interface ContentSupplyWorkspace {
  readonly catalog: readonly ContentSupplyCatalogItem[];
  readonly packages: readonly ContentSupplyPackage[];
}

export interface ContentSupplyRehydration {
  readonly ready: readonly string[];
  readonly blocked: readonly string[];
  readonly failed: readonly string[];
}

export interface ContentSupplyCatalogRefresh {
  readonly items: readonly ContentSupplyCatalogItem[];
  readonly status: 'cached' | 'current' | 'updated';
}

export type ContentSupplyInstallationPhase='downloading'|'preparing'|'committing';

export interface ContentProvisioningControl {
  readonly tasks: readonly ContentProvisioningTask[];
  readonly preparationAvailable: boolean;
}

export type ContentSupplyCommand =
  | Readonly<{kind:'prepare_direct_materialization';enrollmentId:string;signal:AbortSignal}>
  | Readonly<{ kind: 'rehydrate'; signal?: AbortSignal }>
  | Readonly<{ kind: 'refresh_catalog'; force?: boolean; signal?: AbortSignal }>
  | Readonly<{
      kind: 'install_catalog_item';
      descriptor: ContentSupplyCatalogItem;
      signal: AbortSignal;
      onProgress?: (fraction: number) => void;
      onPhase?: (phase: ContentSupplyInstallationPhase) => void;
    }>
  | Readonly<{ kind: 'preview_portable_package'; bytes: Uint8Array }>
  | Readonly<{
      kind: 'install_portable_package';
      bytes: Uint8Array;
      expectedArchiveDigest: string;
      signal?: AbortSignal;
    }>
  | Readonly<{ kind: 'export_portable_package'; packageKey: string }>
  | Readonly<{ kind: 'export_personal_portable_package'; taskId: string }>
  | Readonly<{
      kind: 'prepare_materialization';
      taskId: string;
      source: PersonalMeaningLearningSource;
      signal: AbortSignal;
    }>
  | Readonly<{
      kind: 'stop_provisioning';
      operationId: string;
      taskId: string;
    }>
  | Readonly<{
      kind: 'revise_provisioning';
      operationId: string;
      taskId: string;
      source: PersonalMeaningLearningSource;
      languageContext: SensaFormalPinnedLanguageContext;
      useContext: boolean;
    }>;

export type ContentSupplyCommandResult<Command extends ContentSupplyCommand> =
  Command['kind'] extends 'prepare_direct_materialization'?{taskId:string|null;targetId:string;status:ContentProvisioningStatus|'already_in_scope'}
    : Command['kind'] extends 'rehydrate' ? ContentSupplyRehydration
    : Command['kind'] extends 'refresh_catalog' ? ContentSupplyCatalogRefresh
      : Command['kind'] extends 'install_catalog_item' ? readonly InstalledPackage[]
        : Command['kind'] extends 'preview_portable_package' ? PortablePackagePreview
          : Command['kind'] extends 'export_portable_package' ? PortablePackageExport
            : Command['kind'] extends 'export_personal_portable_package' ? PortablePackageExport
            : Command['kind'] extends 'prepare_materialization' ? void
              : Command['kind'] extends 'stop_provisioning' ? boolean
                : Command['kind'] extends 'revise_provisioning' ? ContentProvisioningTask
                  : InstalledPackage;

export type ContentSupplyQuery =
  | Readonly<{kind:'direct_provisioning_task';enrollmentId:string}>
  | Readonly<{ kind: 'workspace' }>
  | Readonly<{kind:'catalog'}>
  | Readonly<{kind:'catalog_snapshot'}>
  | Readonly<{kind:'route_counts'}>
  | Readonly<{kind:'runtime_packages';packageKeys:readonly string[]}>
  | Readonly<{kind:'package_summaries';packageKeys:readonly string[]}>
  | Readonly<{ kind: 'provisioning_control' }>
  | Readonly<{ kind:'provisioning_task';taskId:string }>
  | Readonly<{kind:'personal_provisioning_source';taskId:string}>
  | Readonly<{ kind: 'provisioning_tasks' }>;
export type ContentSupplyQueryResult<Query extends ContentSupplyQuery> =
  Query['kind'] extends 'direct_provisioning_task'?ContentProvisioningTask|null
    : Query['kind'] extends 'workspace' ? ContentSupplyWorkspace
    :Query['kind'] extends 'catalog'?readonly ContentSupplyCatalogItem[]
    :Query['kind'] extends 'catalog_snapshot'?Readonly<{items:readonly ContentSupplyCatalogItem[];checkedAt:string|null}>
    :Query['kind'] extends 'route_counts'?readonly PackageRouteCount[]
    :Query['kind'] extends 'runtime_packages'?readonly InstalledPackage[]
    :Query['kind'] extends 'package_summaries'?readonly ContentSupplyPackage[]
    : Query['kind'] extends 'provisioning_control' ? ContentProvisioningControl
      :Query['kind'] extends 'provisioning_task'?ContentProvisioningTask|null
      :Query['kind'] extends 'personal_provisioning_source'?PersonalMeaningLearningSource|null
      : readonly ContentProvisioningTask[];

/**
 * Stable Content Supply System deep Module interface.
 *
 * Surfaces ask for discoverable/installed content and submit supply intents.
 * Authentication, HTTP caching, registry validation, artifact transfer,
 * digest admission, installation facts and device-cache repair stay hidden.
 */
export interface ContentSupplySystem {
  execute<Command extends ContentSupplyCommand>(
    command: Command,
  ): Promise<ContentSupplyCommandResult<Command>>;
  read<Query extends ContentSupplyQuery>(
    query: Query,
  ): Promise<ContentSupplyQueryResult<Query>>;
  subscribe(query: ContentSupplyQuery, listener: () => void): () => void;
}

export type {PortablePackageExport,PortablePackagePreview};

export const contentSupplySystem: ContentSupplySystem = {
  execute: (async (command: ContentSupplyCommand) => {
    const { executeContentSupplyCommand } = await import('./contentSupplySystemImplementation');
    return executeContentSupplyCommand(command);
  }) as ContentSupplySystem['execute'],
  read: (async (query: ContentSupplyQuery) => {
    const { readContentSupplyQuery } = await import('./contentSupplySystemImplementation');
    return readContentSupplyQuery(query);
  }) as ContentSupplySystem['read'],
  subscribe: subscribeContentSupply,
};
