import type {ContextBrowseQuery,ContextBrowsePage} from '../../experience/personalMeaningJourney/contextRead';
import type {LearningScheduleQuery,LearningSchedulePage} from '../../learning/system/learningScheduleModel';
import type {
  HomeLearningStorageProjection,
  MeaningLookupResult,
  WorldBrowseQuery,WorldBrowsePage,WorldLearningChoiceQuery,WorldLearningChoicePage,
  PortableMediaBlob,
  PortableMediaStorageDiagnostics,
  SqliteLibraryTable,
  SqliteMutation,
  SqliteRecordChange,
  SqliteSyncBaseEntry,
  SqliteStorageDiagnostics,
  SqliteWorkerInput,
  SqliteWorkerRequest,
  SqliteWorkerResult,
} from "./sqliteProtocol";
import type {PackageCacheProjectionQuery,PackageCacheProjectionResult} from './packageCacheProjection';
import type {PracticeExpressionQuery,PracticeExpressionPage} from './practiceExpressionProjection';
import type {RuntimeLearningCandidateQuery,RuntimeLearningCandidates} from './runtimeLearningCandidates';
import type {LearningManagementSummaryQuery,LearningManagementStorageSummary} from './runtimeLearningCandidates';
import type {LearningHistoryRequest} from '../../learning/system/learningHistoryModel';
import type {StoredLearningHistoryPage} from './learningHistoryProjection';
import type {ReplicaCandidateRequest,ReplicaCandidateResponse} from './replicaCandidateProtocol';
import {CoordinatedSqliteAdapter,type CoordinatedSqliteBackend} from './sqliteCoordinator';
import {localLibraryNamespace,assertLocalLibrarySelected,observeLocalLibrarySelection,assertIsolatedSnapshotNamespace,registerIsolatedSnapshotNamespace,type LocalLibraryNamespace} from './localLibraryLocation';

export interface SqliteRecordAdapter {
  exportLocalSnapshot?(expectedRevision:number):Promise<import('./sqlitePortableSnapshot').LocalPortableSnapshot>;
  replicaCandidate(request:ReplicaCandidateRequest):Promise<ReplicaCandidateResponse>;
  learningSemanticMemory(targetId?:string):Promise<import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection>;
  get(table: SqliteLibraryTable, key: string): Promise<string | null>;
  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>>;
  entriesPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):Promise<Array<{key:string;encodedValue:string}>>;
  recordKeysPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):Promise<string[]>;
  existingRecordKeys(table:SqliteLibraryTable,keys:readonly string[]):Promise<string[]>;
  packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):Promise<PackageCacheProjectionResult<Query>>;
  lookupMeanings(query:string):Promise<MeaningLookupResult>;
  contextBrowse(query:ContextBrowseQuery):Promise<ContextBrowsePage>;
  worldBrowse(query:WorldBrowseQuery):Promise<WorldBrowsePage>;
  worldSceneMeaning(sceneId:string):Promise<string|null>;
  registrySelection(query:import('./sqliteProtocol').RegistrySelectionQuery):Promise<import('./sqliteProtocol').RegistrySelection>;
  worldLearningChoices(query:WorldLearningChoiceQuery):Promise<WorldLearningChoicePage>;
  practiceExpressions(query:PracticeExpressionQuery):Promise<PracticeExpressionPage>;
  existingJourneyIdentities(ids:readonly string[]):Promise<string[]>;
  changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[]): Promise<SqliteRecordChange[]>;
  hasChangesSince(contentRevision:number,tables:readonly SqliteLibraryTable[]):Promise<boolean>;
  syncBaseEntries(keys?: readonly { table: SqliteLibraryTable; key: string }[]): Promise<SqliteSyncBaseEntry[]>;
  syncBaseReferences():Promise<import('./sqliteProtocol').SqliteSyncBaseReference[]>;
  count(table: SqliteLibraryTable): Promise<number>;
  estimateRecordBytes(tables: readonly SqliteLibraryTable[]): Promise<number>;
  homeLearningProjection(languageRouteId: string,clock?:number): Promise<HomeLearningStorageProjection>;
  learningSchedulePage(query:LearningScheduleQuery):Promise<LearningSchedulePage>;
  learningHistoryPage(query:LearningHistoryRequest):Promise<StoredLearningHistoryPage>;
  learningManagementSummary(query:LearningManagementSummaryQuery):Promise<LearningManagementStorageSummary>;
  runtimeLearningCandidates(query:RuntimeLearningCandidateQuery):Promise<RuntimeLearningCandidates>;
  studyScopeMember(scopeRevisionId:string,targetId:string):Promise<import('./studyScopes').LocalStudyScopeMember|null>;
  latestLearningActionAt(runId:string):Promise<string|null>;
  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number>;
  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]>;
  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>>;
  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number>;
  learningTargetIdsForBookUpgrade(languageRouteId: string, targetLanguageTag: string, supportLanguageTag: string, bookId: string, nextBookVersionId: string): Promise<string[]>;
  isMediaReferenced(mediaId: string): Promise<boolean>;
  portableMedia(sha256:string):Promise<PortableMediaBlob|null>;
  portableMediaDiagnostics():Promise<PortableMediaStorageDiagnostics>;
  commit(mutation: SqliteMutation): Promise<void>;
  diagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): Promise<SqliteStorageDiagnostics>;
}

class WorkerSqliteAdapter implements SqliteRecordAdapter,CoordinatedSqliteBackend {
  private readonly worker = new Worker(new URL("./sqliteWorker.ts", import.meta.url), {
    type: "module",
    name: "sensa-sqlite",
  });
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private terminated=false;
  private workerError:Error|undefined;
  private isolatedAdmitted=false;

  constructor(private readonly namespace:LocalLibraryNamespace,private readonly isolatedExisting=false) {
    this.worker.addEventListener("message", (event: MessageEvent<SqliteWorkerResult>) => {
      const waiting = this.pending.get(event.data.id);
      if (!waiting) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) waiting.resolve(event.data.value);
      else waiting.reject(new Error(event.data.error));
    });
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "sqlite_worker_failed");
      this.workerError=error;
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
    });
  }

  initialize(): Promise<SqliteStorageDiagnostics> {
    return this.send({ kind: "initialize",namespace:this.namespace,...(this.isolatedExisting?{requireExisting:true}:{}) }) as Promise<SqliteStorageDiagnostics>;
  }

  exportLocalSnapshot(expectedRevision:number){return this.send({kind:'exportLocalSnapshot',expectedRevision}) as Promise<import('./sqlitePortableSnapshot').LocalPortableSnapshot>;}
  initializeSnapshot(snapshot:import('./sqlitePortableSnapshot').LocalPortableSnapshot){
    if(this.namespace===null)throw Error('sqlite_snapshot_requires_fresh_namespace');
    return this.send({kind:'initializeSnapshot',namespace:this.namespace,snapshot}) as Promise<{report:Omit<Awaited<ReturnType<typeof import('./sqlitePortableSnapshot').importLocalPortableSnapshot>>,'library'>;diagnostics:SqliteStorageDiagnostics}>;
  }
  markIsolatedAdmitted():void{this.isolatedAdmitted=true;}

  replicaCandidate(request:ReplicaCandidateRequest):Promise<ReplicaCandidateResponse>{return this.send({kind:'replicaCandidate',request}) as Promise<ReplicaCandidateResponse>;}

  get(table: SqliteLibraryTable, key: string): Promise<string | null> {
    return this.send({ kind: "get", table, key }) as Promise<string | null>;
  }

  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>> {
    return this.send({ kind: "entries", table }) as Promise<Array<{ key: string; encodedValue: string }>>;
  }
  entriesPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):Promise<Array<{key:string;encodedValue:string}>>{
    return this.send({kind:'entriesPage',table,afterKey,limit}) as Promise<Array<{key:string;encodedValue:string}>>;
  }
  recordKeysPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):Promise<string[]>{
    return this.send({kind:'recordKeysPage',table,afterKey,limit}) as Promise<string[]>;
  }

  existingRecordKeys(table:SqliteLibraryTable,keys:readonly string[]):Promise<string[]>{
    return this.send({kind:'existingRecordKeys',table,keys:[...keys]}) as Promise<string[]>;
  }

  packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):Promise<PackageCacheProjectionResult<Query>>{
    return this.send({kind:'packageCacheProjection',query}) as Promise<PackageCacheProjectionResult<Query>>;
  }

  changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[]): Promise<SqliteRecordChange[]> {
    return this.send({ kind: "changesSince", contentRevision, tables: [...tables] }) as Promise<SqliteRecordChange[]>;
  }
  lookupMeanings(query:string):Promise<MeaningLookupResult>{return this.send({kind:'meaningLookup',query}) as Promise<MeaningLookupResult>;}
  contextBrowse(query:ContextBrowseQuery):Promise<ContextBrowsePage>{return this.send({kind:'contextBrowse',query}) as Promise<ContextBrowsePage>;}
  worldBrowse(query:WorldBrowseQuery):Promise<WorldBrowsePage>{return this.send({kind:'worldBrowse',query}) as Promise<WorldBrowsePage>;}
  worldSceneMeaning(sceneId:string):Promise<string|null>{return this.send({kind:'worldSceneMeaning',sceneId}) as Promise<string|null>;}
  registrySelection(query:import('./sqliteProtocol').RegistrySelectionQuery):Promise<import('./sqliteProtocol').RegistrySelection>{return this.send({kind:'registrySelection',query}) as Promise<import('./sqliteProtocol').RegistrySelection>;}
  worldLearningChoices(query:WorldLearningChoiceQuery):Promise<WorldLearningChoicePage>{return this.send({kind:'worldLearningChoices',query}) as Promise<WorldLearningChoicePage>;}
  practiceExpressions(query:PracticeExpressionQuery):Promise<PracticeExpressionPage>{return this.send({kind:'practiceExpressions',query}) as Promise<PracticeExpressionPage>;}
  existingJourneyIdentities(ids:readonly string[]):Promise<string[]>{return this.send({kind:'existingJourneyIdentities',ids:[...ids]}) as Promise<string[]>;}

  hasChangesSince(contentRevision:number,tables:readonly SqliteLibraryTable[]):Promise<boolean>{
    return this.send({kind:'hasChangesSince',contentRevision,tables:[...tables]}) as Promise<boolean>;
  }

  syncBaseEntries(keys?: readonly { table: SqliteLibraryTable; key: string }[]): Promise<SqliteSyncBaseEntry[]> {
    const input: SqliteWorkerInput = keys
      ? { kind: "syncBaseEntries", keys: [...keys] }
      : { kind: "syncBaseEntries" };
    return this.send(input) as Promise<SqliteSyncBaseEntry[]>;
  }

  syncBaseReferences():Promise<import('./sqliteProtocol').SqliteSyncBaseReference[]>{
    return this.send({kind:'syncBaseReferences'}) as Promise<import('./sqliteProtocol').SqliteSyncBaseReference[]>;
  }
  count(table: SqliteLibraryTable): Promise<number> {
    return this.send({ kind: "count", table }) as Promise<number>;
  }

  learningSemanticMemory(targetId?:string):Promise<import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection>{return this.send({kind:'learningSemanticMemory',targetId}) as Promise<import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection>;}

  estimateRecordBytes(tables: readonly SqliteLibraryTable[]): Promise<number> {
    return this.send({kind:'estimateRecordBytes',tables:[...tables]}) as Promise<number>;
  }

  homeLearningProjection(languageRouteId: string,clock=Date.now()): Promise<HomeLearningStorageProjection> {
    return this.send({ kind: "homeLearningProjection", languageRouteId,clock }) as Promise<HomeLearningStorageProjection>;
  }
  runtimeLearningCandidates(query:RuntimeLearningCandidateQuery):Promise<RuntimeLearningCandidates>{return this.send({kind:'runtimeLearningCandidates',query}) as Promise<RuntimeLearningCandidates>;}
  studyScopeMember(scopeRevisionId:string,targetId:string):Promise<import('./studyScopes').LocalStudyScopeMember|null>{return this.send({kind:'studyScopeMember',scopeRevisionId,targetId}) as Promise<import('./studyScopes').LocalStudyScopeMember|null>;}
  latestLearningActionAt(runId:string):Promise<string|null>{return this.send({kind:'latestLearningActionAt',runId}) as Promise<string|null>;}
  learningSchedulePage(query:LearningScheduleQuery):Promise<LearningSchedulePage>{return this.send({kind:'learningSchedulePage',query}) as Promise<LearningSchedulePage>;}
  learningHistoryPage(query:LearningHistoryRequest):Promise<StoredLearningHistoryPage>{return this.send({kind:'learningHistoryPage',query}) as Promise<StoredLearningHistoryPage>;}
  learningManagementSummary(query:LearningManagementSummaryQuery):Promise<LearningManagementStorageSummary>{return this.send({kind:'learningManagementSummary',query}) as Promise<LearningManagementStorageSummary>;}

  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number> {
    return this.send({
      kind: 'countIntroducedLearningTargets', languageRouteId, startedAfter, startedBefore,
    }) as Promise<number>;
  }

  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]> {
    return this.send({ kind: 'learningRunIdsForTarget', targetId, openOnly }) as Promise<string[]>;
  }

  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>> {
    return this.send({ kind: 'openLearningRunTargets' }) as Promise<Array<{ runId: string; targetId: string }>>;
  }

  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number> {
    return this.send({ kind: 'countContentAttemptsSince', taskId, createdAfter }) as Promise<number>;
  }

  learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    return this.send({
      kind: 'learningTargetIdsForBookUpgrade',
      languageRouteId,
      targetLanguageTag,
      supportLanguageTag,
      bookId,
      nextBookVersionId,
    }) as Promise<string[]>;
  }

  isMediaReferenced(mediaId: string): Promise<boolean> {
    return this.send({ kind: 'isMediaReferenced', mediaId }) as Promise<boolean>;
  }

  portableMedia(sha256:string):Promise<PortableMediaBlob|null>{
    return this.send({kind:'portableMedia',sha256}) as Promise<PortableMediaBlob|null>;
  }

  portableMediaDiagnostics():Promise<PortableMediaStorageDiagnostics>{
    return this.send({kind:'portableMediaDiagnostics'}) as Promise<PortableMediaStorageDiagnostics>;
  }

  async commit(mutation: SqliteMutation): Promise<void> {
    await this.send({ kind: "commit", mutation });
  }

  diagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): Promise<SqliteStorageDiagnostics> {
    return this.send({ kind: "diagnostics",...options }) as Promise<SqliteStorageDiagnostics>;
  }

  async close():Promise<void>{
    if(this.terminated)return;
    if(this.workerError)throw new Error('sqlite_worker_close_unconfirmed',{cause:this.workerError});
    await this.send({kind:'close'});
    this.worker.terminate();
    this.terminated=true;
  }

  private send(input: SqliteWorkerInput|{kind:'close'}): Promise<unknown> {
    if(this.terminated)return Promise.reject(new Error('sqlite_worker_terminated'));
    if((this.isolatedExisting||this.isolatedAdmitted)&&input.kind!=='close'){
      try{assertIsolatedSnapshotNamespace(this.namespace!);}catch(error){return Promise.reject(error);}
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...input } as SqliteWorkerRequest);
    });
  }
}

const testMemoryAdapterRequested = (): boolean =>
  typeof document === 'undefined'
  && (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env?.SENSA_TEST_MEMORY_LIBRARY === 'true';

function assertBrowserSqliteAvailable(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    throw new Error('sqlite_browser_environment_unavailable');
  }
  if (typeof Worker === 'undefined') throw new Error('sqlite_worker_unavailable');
  if (typeof navigator.storage?.getDirectory !== 'function') throw new Error('sqlite_opfs_unavailable');
  if (!navigator.locks) throw new Error('sqlite_web_locks_unavailable');
  if (typeof BroadcastChannel === 'undefined') throw new Error('sqlite_broadcast_channel_unavailable');
}

let adapter: Promise<SqliteRecordAdapter> | undefined;
let activeBrowserAdapter:CoordinatedSqliteAdapter|undefined;
/** Explicit isolated local generation; never changes the active pointer. */
export async function openIsolatedLocalSnapshot(snapshot:import('./sqlitePortableSnapshot').LocalPortableSnapshot){
 const namespace=crypto.randomUUID(),isolated=new WorkerSqliteAdapter(namespace);
 try{assertIsolatedSnapshotNamespace(namespace,false);const result=await isolated.initializeSnapshot(snapshot);registerIsolatedSnapshotNamespace(namespace);isolated.markIsolatedAdmitted();return {...result,namespace,adapter:isolated};}
 catch(error){await isolated.close().catch(()=>{});throw error;}
}
/** Reopen an already imported isolated generation without selecting it. */
export async function openIsolatedLocalGeneration(namespace:string){
 assertIsolatedSnapshotNamespace(namespace);
 const isolated=new WorkerSqliteAdapter(namespace,true);try{await isolated.initialize();return isolated;}catch(error){await isolated.close().catch(()=>{});throw error;}
}
export async function closeLocalLibraryStorage():Promise<void>{await activeBrowserAdapter?.close();}

async function browserAdapter(): Promise<SqliteRecordAdapter> {
  assertBrowserSqliteAvailable();
  const namespace=localLibraryNamespace();
  const coordinated = activeBrowserAdapter = new CoordinatedSqliteAdapter(()=>new WorkerSqliteAdapter(namespace),namespace,()=>assertLocalLibrarySelected(namespace));
  observeLocalLibrarySelection(namespace,()=>{void coordinated.close().catch(()=>{});});
  try {
    await coordinated.initialize();
    // Capability checks alone cannot prove that this origin can durably write.
    // Exercise the initialized database before any product operation may report
    // success, then remove the private probe row immediately.
    const probeKey = `storage-probe:${crypto.randomUUID()}`;
    const probeValue = JSON.stringify({ value: probeKey });
    let wroteProbe = false;
    try {
      await coordinated.commit({
        clears: [],
        deletes: [],
        puts: [{ table: 'meta', key: probeKey, encodedValue: probeValue }],
      });
      wroteProbe = true;
      if (await coordinated.get('meta', probeKey) !== probeValue) {
        throw new Error('sqlite_storage_probe_failed');
      }
    } finally {
      if (wroteProbe) {
        await coordinated.commit({
          clears: [],
          deletes: [{ table: 'meta', key: probeKey }],
          puts: [],
        });
      }
    }
    return coordinated;
  } catch(cause) {
    // If initialization or the durability probe fails, release the Worker and
    // document owner locks only after the backend confirms safe VFS teardown.
    try{await coordinated.close();}
    catch(cleanupCause){throw new AggregateError([cause,cleanupCause],'sqlite_storage_cleanup_unconfirmed');}
    throw cause;
  }
}

export function sqliteRecordAdapter(): Promise<SqliteRecordAdapter> {
  if (!adapter) {
    // Node smoke tests must opt in explicitly. A production browser never
    // accepts volatile storage as a successful local-library implementation.
    adapter = testMemoryAdapterRequested()
      ? import('./sqliteMemoryAdapter').then(({MemoryRecordAdapter})=>new MemoryRecordAdapter())
      : browserAdapter();
    adapter.catch(() => { adapter = undefined; });
  }
  return adapter;
}
