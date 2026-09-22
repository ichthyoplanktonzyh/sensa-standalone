import type { LearningPackageDescriptor } from '@sensa/contracts/sensa';

import type { InstalledPackage } from '../../data/library/packageRecords';
import { packageKey } from '../../data/library/packageRecords';
import { observeLibrary, type Table } from '../../data/library/store';

export type ContentSupplyPackage = InstalledPackage;

export interface ContentSupplyWorkspace {
  readonly catalog: readonly LearningPackageDescriptor[];
  readonly packages: readonly InstalledPackage[];
}

export interface ContentSupplyRehydration {
  readonly ready: readonly string[];
  readonly blocked: readonly string[];
  readonly failed: readonly string[];
}

export interface ContentSupplyCatalogRefresh {
  readonly items: readonly LearningPackageDescriptor[];
  readonly status: 'cached' | 'current' | 'updated';
}

export type ContentSupplyCommand =
  | Readonly<{ kind: 'rehydrate'; signal?: AbortSignal }>
  | Readonly<{ kind: 'refresh_catalog'; force?: boolean; signal?: AbortSignal }>
  | Readonly<{
      kind: 'install_catalog_item';
      descriptor: LearningPackageDescriptor;
      signal: AbortSignal;
      onProgress?: (fraction: number) => void;
    }>
  | Readonly<{ kind: 'import_package'; bytes: Uint8Array; signal?: AbortSignal }>;

export type ContentSupplyCommandResult<Command extends ContentSupplyCommand> =
  Command['kind'] extends 'rehydrate' ? ContentSupplyRehydration
    : Command['kind'] extends 'refresh_catalog' ? ContentSupplyCatalogRefresh
      : InstalledPackage;

export type ContentSupplyQuery = Readonly<{ kind: 'workspace' }>;
export type ContentSupplyQueryResult<Query extends ContentSupplyQuery> =
  Query['kind'] extends 'workspace' ? ContentSupplyWorkspace : never;

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

const queryTables = {
  workspace: ['packageCache', 'packageInstallations', 'meta'],
} as const satisfies Record<ContentSupplyQuery['kind'], readonly Table[]>;

export const contentSupplyArtifactKey = packageKey;

export const contentSupplySystem: ContentSupplySystem = {
  execute: (async (command: ContentSupplyCommand) => {
    const { executeContentSupplyCommand } = await import('./contentSupplySystemImplementation');
    return executeContentSupplyCommand(command);
  }) as ContentSupplySystem['execute'],
  read: (async (query: ContentSupplyQuery) => {
    const { readContentSupplyQuery } = await import('./contentSupplySystemImplementation');
    return readContentSupplyQuery(query);
  }) as ContentSupplySystem['read'],
  subscribe: (query, listener) => observeLibrary(listener, queryTables[query.kind]),
};
