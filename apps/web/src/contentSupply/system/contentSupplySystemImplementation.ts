import {
  canonicalConsumerJson,
  sensaPortableBookDescriptorSchema,
  sensaPortableLearningContentRegistrySchema,
  type SensaPortableBookDescriptor,
} from '@sensa/contracts/sensa';

import { openLibrary, readLibrary, writeLibraryCache } from '../../data/library/store';
import type {InstalledPackage} from '../../data/library/packageRecords';
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
  previewVariant: boolean;
}>;

const emptyCatalog: CatalogCache = {
  format: 'sensa-local-registry-cache-v3',
  items: [],
  revision: null,
  checkedAt: null,
  previewVariant: false,
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
    previewVariant: candidate.previewVariant === true,
  };
};

const readWorkspace = async (): Promise<ContentSupplyWorkspace> => {
  await openLibrary();
  return readLibrary(async (tx) => {
    const cache = parseCatalogCache(await tx.get<unknown>('meta', 'package-catalog'));
    return {
      catalog: [...cache.items],
      packages:await tx.packageCacheProjection({kind:'summaries'}),
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
    && cache.previewVariant
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
  signal?.throwIfAborted();
  await writeLibraryCache(async (tx) => {
    signal?.throwIfAborted();
    tx.put('meta', 'package-catalog', {
      format: 'sensa-local-registry-cache-v3',
      items,
      revision,
      checkedAt: new Date().toISOString(),
      previewVariant: true,
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
    case 'prepare_direct_materialization': {
      const [{learningSystem},{enrollDirectProvisioning,readDirectProvisioningSource},{preparationProvidersSnapshot,preparePersonal},{DirectLearningSourceError}]=await Promise.all([
        import('../../learning/system/learningSystem'),import('../../data/library/directProvisioning'),import('../../data/library/personalLearning'),import('../../learning/system/directLearningSource'),
      ]);
      if(command.signal.aborted)throw command.signal.reason;
      try{
        const published=await learningSystem.execute({kind:'prepare_direct',operationId:crypto.randomUUID(),enrollmentId:command.enrollmentId});
        if(published.status!=='needs_generation')return {...published,taskId:null};
      }catch(cause){if(!(cause instanceof DirectLearningSourceError)||cause.reason!=='missing')throw cause;}
      // A retained accepted publication can be regenerated without its cache;
      // missing/corrupt registry facts still fail source resolution below.
      const task=await enrollDirectProvisioning(crypto.randomUUID(),command.enrollmentId);
      const [source,providers]=await Promise.all([readDirectProvisioningSource(command.enrollmentId),preparationProvidersSnapshot()]);
      await preparePersonal(task.id,source,providers.content,providers.review,command.signal,()=>{});
      const current=await readLibrary(tx=>tx.get<import('../provisioning/contracts').ContentProvisioningTask>('personalLearning',task.id));
      if(!current)throw new Error('localFlow.enrollFirst');
      return {taskId:current.id,targetId:current.targetId,status:current.status};
    }
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
        phase=>command.onPhase?.(phase),
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
        preparationProvidersSnapshot,
        preparePersonal,
      } = await import('../../data/library/personalLearning');
      const providers = await preparationProvidersSnapshot();
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
    case 'book_preview':{
      const {fetchPublishedBookPreview}=await import('../portable/portableCatalog');
      return fetchPublishedBookPreview(query.descriptor,query.signal);
    }
    case 'direct_provisioning_task': {
      const {directProvisioningTaskId}=await import('../../data/library/directProvisioning');
      const {personalLearningTaskSnapshot}=await import('../../data/library/personalLearning');
      return personalLearningTaskSnapshot(directProvisioningTaskId(query.enrollmentId));
    }
    case 'workspace':
      return readWorkspace();
    case 'catalog':return readLibrary(async tx=>parseCatalogCache(await tx.get<unknown>('meta','package-catalog')).items);
    case 'catalog_snapshot':return readLibrary(async tx=>{
      const cache=parseCatalogCache(await tx.get<unknown>('meta','package-catalog'));
      return {items:cache.items,checkedAt:cache.checkedAt};
    });
    case 'route_counts':return readLibrary(tx=>tx.packageCacheProjection({kind:'route_counts'}));
    case 'runtime_packages':
      return readLibrary(async tx=>Promise.all([...new Set(query.packageKeys)].map(key=>tx.get<InstalledPackage>('packageCache',key))).then(values=>values.filter((value):value is InstalledPackage=>!!value)));
    case 'package_summaries':
      return readLibrary(tx=>tx.packageCacheProjection({kind:'summaries_by_keys',keys:query.packageKeys}));
    case 'provisioning_tasks': {
      const { personalLearningSnapshot } = await import('../../data/library/personalLearning');
      return personalLearningSnapshot();
    }
    case 'provisioning_task':{
      const {personalLearningTaskSnapshot}=await import('../../data/library/personalLearning');return personalLearningTaskSnapshot(query.taskId);
    }
    case 'personal_provisioning_source':{
      const {readPersonalProvisioningSource}=await import('../../data/library/personalProvisioningSource');
      const {isPersonalProvisioningTask}=await import('../provisioning/contracts');
      return readLibrary(async tx=>{const task=await tx.get<import('../provisioning/contracts').ContentProvisioningTask>('personalLearning',query.taskId);return task&&isPersonalProvisioningTask(task)?readPersonalProvisioningSource(tx,task.source,task.contextPin,true):null;});
    }
    case 'personal_provisioning_presentation':{
      const {readPersonalProvisioningPresentation}=await import('../../data/library/personalProvisioningSource');
      const {isPersonalProvisioningTask}=await import('../provisioning/contracts');
      return readLibrary(async tx=>{const task=await tx.get<import('../provisioning/contracts').ContentProvisioningTask>('personalLearning',query.taskId);return task&&isPersonalProvisioningTask(task)?readPersonalProvisioningPresentation(tx,task.source,task.contextPin):null;});
    }
    case 'provisioning_control': {
      const { personalLearningControlSnapshot } = await import('../../data/library/personalLearning');
      const snapshot = await personalLearningControlSnapshot();
      return { tasks: snapshot.tasks, preparationAvailable: true };
    }
  }
};
