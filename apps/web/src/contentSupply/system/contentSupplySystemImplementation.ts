import {
  canonicalConsumerJson,
  sensaPortableBookDescriptorSchema,
  sensaPortableLearningContentRegistrySchema,
  type SensaPortableBookDescriptor,
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
  format: 'sensa-local-registry-cache-v3';
  items: readonly SensaPortableBookDescriptor[];
  revision: string | null;
  checkedAt: string | null;
}>;

const emptyCatalog: CatalogCache = {
  format: 'sensa-local-registry-cache-v3',
  items: [],
  revision: null,
  checkedAt: null,
};

const browserSha256=async(value:string)=>Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)),
),byte=>byte.toString(16).padStart(2,'0')).join('');

const parseCatalogItems = (
  raw: readonly unknown[],
): readonly SensaPortableBookDescriptor[] | null => {
  const parsed = raw.map((item) => sensaPortableBookDescriptorSchema.safeParse(item));
  return parsed.every((item) => item.success) ? parsed.map((item) => item.data) : null;
};

const parseCatalogCache = (raw: unknown): CatalogCache => {
  if (!raw || typeof raw !== 'object') return emptyCatalog;
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.format !== 'sensa-local-registry-cache-v3'
    || !Array.isArray(candidate.items)
    || !(candidate.revision === null || typeof candidate.revision === 'string')
    || !(candidate.checkedAt === null || typeof candidate.checkedAt === 'string')
  ) return emptyCatalog;
  const items = parseCatalogItems(candidate.items);
  if (!items) return emptyCatalog;
  const checkedAt = candidate.checkedAt;
  return {
    format: 'sensa-local-registry-cache-v3',
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
    ? sensaPortableLearningContentRegistrySchema.parse(response.value)
    : null;
  if(parsed){
    const {revision,...snapshot}=parsed;
    if(await browserSha256(canonicalConsumerJson(snapshot))!==revision){
      throw new Error('localFlow.catalogMismatch');
    }
  }
  const items = parsed?.items ?? cache.items;
  const revision = parsed?.revision ?? cache.revision;
  await writeLibraryCache(async (tx) => {
    tx.put('meta', 'package-catalog', {
      format: 'sensa-local-registry-cache-v3',
      items,
      revision,
      checkedAt: new Date().toISOString(),
    } satisfies CatalogCache);
  });
  const { rehydratePublishedPortableInstallations } = await import('../portable/portableCatalog');
  await rehydratePublishedPortableInstallations(
    items,
    signal ?? AbortSignal.timeout(120_000),
  );
  return { items, status: response.kind === 'not_modified' ? 'current' : 'updated' };
};

export const executeContentSupplyCommand = async (command: ContentSupplyCommand): Promise<unknown> => {
  await openLibrary();
  switch (command.kind) {
    case 'rehydrate': {
      const cache=await readLibrary(
        tx=>tx.get<unknown>('meta','package-catalog').then(parseCatalogCache),
      );
      const {rehydratePublishedPortableInstallations}=await import('../portable/portableCatalog');
      return rehydratePublishedPortableInstallations(
        cache.items,
        command.signal??AbortSignal.timeout(120_000),
      );
    }
    case 'refresh_catalog':
      return refreshCatalog(command.force, command.signal);
    case 'install_catalog_item': {
      const {downloadPublishedBook}=await import('../portable/portableCatalog');
      return downloadPublishedBook(
        command.descriptor,
        command.signal,
        fraction=>command.onProgress?.(fraction),
      );
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
    case 'export_personal_portable_package': {
      const {exportPersonalPortablePackage}=await import('../portable/personalPortablePackage');
      return exportPersonalPortablePackage(command.taskId);
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
