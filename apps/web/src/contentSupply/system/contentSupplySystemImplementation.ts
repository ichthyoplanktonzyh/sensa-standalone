import {
  learningPackageCatalogSchema,
  learningPackageDescriptorSchema,
  type LearningPackageDescriptor,
} from '@sensa/contracts/sensa';

import { openLibrary, readLibrary, writeLibraryCache } from '../../data/library/store';
import type { InstalledPackage } from '../../data/library/packageRecords';
import type {
  ContentSupplyCatalogRefresh,
  ContentSupplyCommand,
  ContentSupplyQuery,
  ContentSupplyWorkspace,
} from './contentSupplySystem';

type CatalogCache = Readonly<{
  format: 'sensa-local-registry-cache-v1';
  items: readonly LearningPackageDescriptor[];
  revision: string | null;
  checkedAt: string | null;
}>;

const emptyCatalog: CatalogCache = {
  format: 'sensa-local-registry-cache-v1',
  items: [],
  revision: null,
  checkedAt: null,
};

const parseCatalogItems = (raw: readonly unknown[]): readonly LearningPackageDescriptor[] | null => {
  const parsed = raw.map((item) => learningPackageDescriptorSchema.safeParse(item));
  return parsed.every((item) => item.success) ? parsed.map((item) => item.data) : null;
};

const parseCatalogCache = (raw: unknown): CatalogCache => {
  if (Array.isArray(raw)) {
    const items = parseCatalogItems(raw);
    return items ? { ...emptyCatalog, items } : emptyCatalog;
  }
  if (!raw || typeof raw !== 'object') return emptyCatalog;
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.format !== 'sensa-local-registry-cache-v1'
    || !Array.isArray(candidate.items)
    || !(candidate.revision === null || typeof candidate.revision === 'string')
    || !(candidate.checkedAt === null || typeof candidate.checkedAt === 'string')
  ) return emptyCatalog;
  const items = parseCatalogItems(candidate.items);
  if (!items) return emptyCatalog;
  const checkedAt = candidate.checkedAt;
  return {
    format: 'sensa-local-registry-cache-v1',
    items,
    revision: candidate.revision,
    checkedAt: checkedAt && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : null,
  };
};

const readWorkspace = async (): Promise<ContentSupplyWorkspace> => {
  await openLibrary();
  return readLibrary(async (tx) => {
    const cache = parseCatalogCache(await tx.get<unknown>('meta', 'package-catalog'));
    return {
      catalog: [...cache.items],
      packages: await tx.all<InstalledPackage>('packageCache'),
    };
  });
};

const refreshCatalog = async (
  force = false,
  signal?: AbortSignal,
): Promise<ContentSupplyCatalogRefresh> => {
  await openLibrary();
  const cache = await readLibrary((tx) => tx.get<unknown>('meta', 'package-catalog').then(parseCatalogCache));
  const localOwnerAcceptance = import.meta.env?.VITE_SENSA_MODE === 'local-owner-acceptance';
  if (
    !force
    && !localOwnerAcceptance
    && cache.checkedAt
    && Date.now() - Date.parse(cache.checkedAt) < 6 * 60 * 60 * 1_000
  ) return { items: cache.items, status: 'cached' };

  const { fetchContentCatalog } = await import('./contentCatalogClient');
  const response = await fetchContentCatalog(cache.revision, signal);
  const parsed = response.kind === 'loaded'
    ? learningPackageCatalogSchema.parse(response.value)
    : null;
  const items = parsed?.items ?? cache.items;
  const revision = parsed && 'format' in parsed ? parsed.revision : cache.revision;
  await writeLibraryCache(async (tx) => {
    tx.put('meta', 'package-catalog', {
      format: 'sensa-local-registry-cache-v1',
      items,
      revision,
      checkedAt: new Date().toISOString(),
    } satisfies CatalogCache);
  });
  const { rehydratePackageInstallations } = await import('../../data/library/packages');
  await rehydratePackageInstallations(items, signal ?? AbortSignal.timeout(120_000));
  return { items, status: response.kind === 'not_modified' ? 'current' : 'updated' };
};

export const executeContentSupplyCommand = async (command: ContentSupplyCommand): Promise<unknown> => {
  await openLibrary();
  switch (command.kind) {
    case 'rehydrate': {
      const { rehydratePackageInstallations } = await import('../../data/library/packages');
      return rehydratePackageInstallations(undefined, command.signal);
    }
    case 'refresh_catalog':
      return refreshCatalog(command.force, command.signal);
    case 'install_catalog_item': {
      const { downloadPackage } = await import('../../data/library/packages');
      return downloadPackage(command.descriptor, command.signal, (receivedBytes) => {
        command.onProgress?.(Math.min(1, receivedBytes / command.descriptor.byteLength));
      });
    }
    case 'import_package': {
      const { installPackage } = await import('../../data/library/packages');
      return installPackage(command.bytes, undefined, command.signal);
    }
    case 'preview_portable_package': {
      const {previewPortablePackage}=await import('../portable/portablePackage');
      return previewPortablePackage(command.bytes);
    }
    case 'install_portable_package': {
      const {installPortablePackage}=await import('../portable/portablePackage');
      return installPortablePackage(command.bytes,command.expectedArchiveDigest,command.signal);
    }
    case 'export_portable_package': {
      const {exportPortablePackage}=await import('../portable/portablePackage');
      return exportPortablePackage(command.packageKey);
    }
    case 'prepare_materialization': {
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
    case 'stop_provisioning': {
      const { stopPersonalPreparation } = await import('../../data/library/personalLearning');
      return stopPersonalPreparation(command.operationId, command.taskId);
    }
    case 'revise_provisioning': {
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

export const readContentSupplyQuery = async (query: ContentSupplyQuery): Promise<unknown> => {
  switch (query.kind) {
    case 'workspace':
      return readWorkspace();
    case 'provisioning_tasks': {
      const { personalLearningSnapshot } = await import('../../data/library/personalLearning');
      return personalLearningSnapshot();
    }
    case 'provisioning_control': {
      const { personalLearningControlSnapshot } = await import('../../data/library/personalLearning');
      const snapshot = await personalLearningControlSnapshot();
      return { tasks: snapshot.tasks, preparationAvailable: true };
    }
  }
};
