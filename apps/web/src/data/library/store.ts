/** Production local-library storage: SQLite WASM in an OPFS Worker. */
import {canonicalConsumerJson} from '@sensa/contracts/sensa/canonical-json';
import {hasLocalLibraryHint,markLocalLibraryPresent} from './localLibraryHint';
import {assertLocalLibrarySelected,localLibraryScopedName} from './localLibraryLocation';

import { decodeBackupValue, encodeBackupValue } from "./backupCodec";
import { sqliteRecordAdapter } from "./sqliteAdapter";
import type {ReplicaCandidateRequest,ReplicaCandidateResponse,ReplicaCandidateValidation} from './replicaCandidateProtocol';
import type {PackageCacheProjectionQuery,PackageCacheProjectionResult} from './packageCacheProjection';
import type {InstalledPackageSummary} from './packageRecords';
import type {
  PortableMediaStorageDiagnostics,
  PortablePackageMediaWrite,
} from './portableMediaCache';
import {
  type HomeLearningStorageProjection,
  sqliteLibraryFile,
  sqliteLibraryTables,
  type SqliteLibraryTable,
  type SqliteMutation,
  type SqliteRecordChange,
  type SqliteStorageDiagnostics,
} from "./sqliteProtocol";

export const libraryDatabaseName = sqliteLibraryFile.slice(1);
export const libraryTables = sqliteLibraryTables;
export type Table = SqliteLibraryTable;
export type LibraryRecordTransition<Tables extends readonly Table[]=readonly Table[]>={
  table:Tables[number];
  key:string;
  before:unknown|null;
  after:unknown|null;
};
export const localLibraryRevisionKey = "local-content-revision";
export const cloudCheckpointRequestEvent = "sensa-cloud-checkpoint-requested";

let sessionIncarnation: string | undefined;
let serial: Promise<unknown> = Promise.resolve();
const libraryNotificationSender=crypto.randomUUID();

const recordKey = (key: string): string => {
  if (key.length === 0 || key.length > 2000) {
    throw new Error("libraryBackup.errors.recordKey");
  }
  return key;
};

const decode = (encoded: string): unknown => decodeBackupValue(JSON.parse(encoded));
const encode = (value: unknown): string => JSON.stringify(encodeBackupValue(value));
const clone = <T>(value: T): T => structuredClone(value);

const storageCall = async <T>(
  work: () => Promise<T>,
  fallback: 'localFlow.storageOpen' | 'localFlow.storageWrite' = 'localFlow.storageWrite',
): Promise<T> => {
  try {
    return await work();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/full|quota/iu.test(message)) throw new Error("localFlow.storageFull", { cause });
    if (/^sqlite_(?:browser_environment|worker|opfs|web_locks|broadcast_channel)_unavailable$/u.test(message)) {
      throw new Error('localFlow.storageUnsupported', { cause });
    }
    if (message === 'sqlite_storage_probe_failed') {
      throw new Error('localFlow.storageOpen', { cause });
    }
    if (message === 'sqlite_owner_incompatible') {
      throw new Error('localFlow.closeOldTabs', { cause });
    }
    if (/coordination|lock|busy|AbortError|TimeoutError|timed out/iu.test(message)) {
      throw new Error("localFlow.storageBusy", { cause });
    }
    if (message.startsWith("localFlow.")) throw cause;
    if(['library_sync_history','library_sync_local_changed','account_changed'].includes(message))throw cause;
    throw new Error(fallback, { cause });
  }
};

/**
 * A transaction is an isolated logical record view. Writes stay in memory
 * while domain code executes, then cross the Worker seam as one SQLite
 * transaction. No caller holds a database lock across network or model work.
 */
export class LibraryTransaction {
  wrote = false;
  private readonly clears = new Set<Table>();
  private readonly deletes = new Map<Table, Set<string>>();
  private readonly puts = new Map<Table, Map<string, unknown>>();
  private readonly knownMissing=new Map<Table,Set<string>>();
  private readonly commitSignals:Array<{
    signal:AbortSignal;
    code:string;
    onCommitStart?:()=>void;
  }> = [];
  private syncBaseReplacement: Array<{ table: Table; key: string; valueJson: string; blockRefs: string[] }> | undefined;
  private syncBasePatch:SqliteMutation['syncBasePatch'];
  private replicaCandidateRestore:SqliteMutation['replicaCandidateRestore'];

  constructor(
    private readonly mode: "readonly" | "readwrite",
    private readonly adapter: Awaited<ReturnType<typeof sqliteRecordAdapter>>,
  ) {}

  restoreReplicaCandidate(candidate:ReplicaCandidateValidation):void{
    this.assertWritable();
    if(this.replicaCandidateRestore||this.syncBaseReplacement!==undefined||this.syncBasePatch)throw Error('library_sync_base_mutation_conflict');
    this.replicaCandidateRestore={id:candidate.id,tables:candidate.tables};this.wrote=true;
  }

  async get<T>(table: Table, inputKey: string): Promise<T | undefined> {
    const key = recordKey(inputKey);
    const pending = this.puts.get(table);
    if (pending?.has(key)) return clone(pending.get(key) as T);
    if (this.clears.has(table) || this.deletes.get(table)?.has(key)) return undefined;
    const encoded = await this.storedValue(table,key);
    if(encoded===null)return undefined;
    // Decoding creates a new owned value on every read.
    return this.decodeStored<T>(table,encoded);
  }

  private async storedValue(table:Table,key:string):Promise<string|null>{
    if(this.knownMissing.get(table)?.has(key))return null;
    return storageCall(()=>this.adapter.get(table,key));
  }

  async entries(table: Table): Promise<Array<{ key: string; value: any }>> {
    const values = new Map<string, unknown>();
    if (!this.clears.has(table)) {
      for (const row of await storageCall(() => this.adapter.entries(table))) {
        if (!this.deletes.get(table)?.has(row.key))values.set(
          row.key,
          await this.decodeStored(table,row.encodedValue),
        );
      }
    }
    for (const [key, value] of this.puts.get(table) ?? []) values.set(key, value);
    return [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value: clone(value) }));
  }

  /** Bounded transport/decode batches for a coherent large semantic snapshot. */
  async *entryBatches(table:Table,afterKey:string|null=null):AsyncGenerator<Array<{key:string;value:unknown}>>{
    if(this.wrote)throw new Error('library_entries_require_snapshot');
    for(;;){
      const rows=await storageCall(()=>this.adapter.entriesPage(table,afterKey,128));
      if(!rows.length)return;
      const decoded:Array<{key:string;value:unknown}>=[];
      let until=performance.now()+8;
      for(const row of rows){
        decoded.push({key:row.key,value:await this.decodeStored(table,row.encodedValue)});
        if(performance.now()>=until){await new Promise<void>(resolve=>setTimeout(resolve,0));until=performance.now()+8;}
      }
      yield decoded;afterKey=rows.at(-1)!.key;
      if(rows.length<128)return;
    }
  }
  /** Coherent, bounded key-only projection; no record/media decoding. */
  async *recordKeyBatches(table:Table):AsyncGenerator<string[]>{
    if(this.wrote)throw new Error('library_entries_require_snapshot');
    let afterKey:string|null=null;
    for(;;){
      const keys=await storageCall(()=>this.adapter.recordKeysPage(table,afterKey,128));
      if(!keys.length)return;
      yield keys;afterKey=keys.at(-1)!;
      if(keys.length<128)return;
    }
  }
  async lookupMeanings(query:string):Promise<import('./sqliteProtocol').MeaningLookupResult>{
    if(this.wrote)throw new Error('library_projection_requires_snapshot');
    return storageCall(()=>this.adapter.lookupMeanings(query));
  }
  async worldBrowse(query:import('./sqliteProtocol').WorldBrowseQuery):Promise<import('./sqliteProtocol').WorldBrowsePage>{
    if(this.wrote)throw new Error('library_projection_requires_snapshot');
    return storageCall(()=>this.adapter.worldBrowse(query));
  }
  async worldSceneMeaning(sceneId:string):Promise<string|null>{
    if(this.wrote)throw new Error('library_projection_requires_snapshot');
    return storageCall(()=>this.adapter.worldSceneMeaning(sceneId));
  }
  async registrySelection(query:import('./sqliteProtocol').RegistrySelectionQuery):Promise<import('./sqliteProtocol').RegistrySelection>{
    if(this.wrote)throw new Error('library_projection_requires_snapshot');
    return storageCall(()=>this.adapter.registrySelection(query));
  }
  async worldLearningChoices(query:import('./sqliteProtocol').WorldLearningChoiceQuery):Promise<import('./sqliteProtocol').WorldLearningChoicePage>{
    if(this.wrote)throw new Error('library_projection_requires_snapshot');
    return storageCall(()=>this.adapter.worldLearningChoices(query));
  }
  async practiceExpressions(query:import('./sqliteProtocol').PracticeExpressionQuery):Promise<import('./sqliteProtocol').PracticeExpressionPage>{
    if(this.wrote)throw new Error('library_projection_requires_snapshot');
    return storageCall(()=>this.adapter.practiceExpressions(query));
  }
  async existingJourneyIdentities(ids:readonly string[]):Promise<Set<string>>{
    if(this.wrote)throw new Error('library_projection_requires_snapshot');
    return new Set(await storageCall(()=>this.adapter.existingJourneyIdentities(ids)));
  }

  /** Batch existence checks use only record keys, not resource payloads. */
  async existingRecordKeys(table:Table,keys:readonly string[]):Promise<Set<string>>{
    const requested=[...new Set(keys.map(recordKey))];
    const present=new Set(this.clears.has(table)?[]:
      await storageCall(()=>this.adapter.existingRecordKeys(table,requested)));
    if(!this.clears.has(table)){
      const missing=this.knownMissing.get(table)??new Set<string>();
      for(const key of requested)if(!present.has(key))missing.add(key);
      this.knownMissing.set(table,missing);
    }
    for(const key of requested){
      if(this.deletes.get(table)?.has(key))present.delete(key);
      if(this.puts.get(table)?.has(key))present.add(key);
    }
    return present;
  }

  /** Read the derived index, including this transaction's pending cache writes. */
  async packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):Promise<PackageCacheProjectionResult<Query>>{
    if(query.kind==='route_counts'||query.kind==='learning_choices'||query.kind==='publication_identities'||query.kind==='summaries_by_keys'){
      if(this.wrote)throw new Error('library_projection_requires_snapshot');
      return storageCall(()=>this.adapter.packageCacheProjection(query));
    }
    const table='packageCache' as const;
    const values=new Map<string,{key:string;digest:string}|InstalledPackageSummary>();
    if(!this.clears.has(table)){
      const stored=query.kind==='identities'
        ?await storageCall(()=>this.adapter.packageCacheProjection({kind:'identities'}))
        :await storageCall(()=>this.adapter.packageCacheProjection({kind:'summaries',packageId:query.packageId}));
      for(const item of stored){
        if(!this.deletes.get(table)?.has(item.key))values.set(item.key,item);
      }
    }
    const pending=this.puts.get(table);
    if(pending?.size){
      const {createPackageCacheSummary,isPackageCacheProjectionSource}=await import('./packageCacheProjection');
      for(const [key,value] of pending){
        if(!isPackageCacheProjectionSource(value)){values.delete(key);continue;}
        if(query.kind==='summaries'&&query.packageId!==undefined&&value.portableOrigin.manifest.metadata.packageId!==query.packageId){values.delete(key);continue;}
        values.set(key,query.kind==='identities'?{key,digest:value.digest}:createPackageCacheSummary(value));
      }
    }
    return clone([...values.values()].sort((left,right)=>left.key.localeCompare(right.key))) as PackageCacheProjectionResult<Query>;
  }

  /** Coherent metadata-only invalidation probe, including deletion tombstones. */
  async hasChangesSince(contentRevision:number,tables:readonly Table[]):Promise<boolean>{
    if(this.wrote)throw new Error('library_changes_require_snapshot');
    return storageCall(()=>this.adapter.hasChangesSince(contentRevision,tables));
  }

  async changesSince<Tables extends readonly Table[]>(contentRevision: number, tables: Tables): Promise<Array<{
    table: Tables[number];
    key: string;
    value: unknown | null;
    contentRevision: number;
  }>> {
    if (this.wrote) throw new Error('library_changes_require_snapshot');
    const changes: SqliteRecordChange[] = await storageCall(
      () => this.adapter.changesSince(contentRevision, tables),
    );
    return Promise.all(changes.map(async(change) => ({
      table: change.table as Tables[number],
      key: change.key,
      value: change.encodedValue === null
        ?null
        :clone(await this.decodeStored(change.table,change.encodedValue)),
      contentRevision: change.contentRevision,
    })));
  }

  async syncBaseEntries<Tables extends readonly Table[]>(keys?: readonly {
    table: Tables[number];
    key: string;
  }[]): Promise<Array<{ table: Tables[number]; key: string; value: unknown; blocks: string[] }>> {
    if (this.wrote) throw new Error('library_sync_base_requires_snapshot');
    const normalizedKeys = keys?.map(({ table, key }) => ({ table, key: recordKey(key) }));
    const entries = await storageCall(() => this.adapter.syncBaseEntries(normalizedKeys));
    return entries.map((entry) => ({
      table: entry.table as Tables[number],
      key: entry.key,
      value: clone(JSON.parse(entry.valueJson)),
      blocks: [...entry.blockRefs],
    }));
  }

  async syncBaseReferences():Promise<import('./sqliteProtocol').SqliteSyncBaseReference[]>{
    if(this.wrote)throw new Error('library_sync_base_requires_snapshot');
    return storageCall(()=>this.adapter.syncBaseReferences());
  }
  patchSyncBase(input:{puts:readonly {table:Table;key:string;value:unknown;blocks:readonly string[]}[];deletes:readonly {table:Table;key:string}[]}):void{
    this.assertWritable();
    if(this.syncBaseReplacement!==undefined||this.syncBasePatch)throw new Error('library_sync_base_mutation_conflict');
    const puts=input.puts.map(row=>{
      const blockRefs=[...row.blocks];
      if(!blockRefs.length||blockRefs.some(ref=>!/^[a-f0-9]{64}$/u.test(ref)))throw new Error('library_sync_format');
      return {table:row.table,key:recordKey(row.key),valueJson:JSON.stringify(row.value),blockRefs};
    });
    this.syncBasePatch={puts,deletes:input.deletes.map(({table,key})=>({table,key:recordKey(key)}))};this.wrote=true;
  }
  replaceSyncBase(entries: readonly { table: Table; key: string; value: unknown; blocks?: readonly string[] }[]): void {
    this.assertWritable();
    if(this.syncBasePatch)throw new Error('library_sync_base_mutation_conflict');
    const unique = new Map<string, { table: Table; key: string; valueJson: string; blockRefs: string[] }>();
    for (const entry of entries) {
      const key = recordKey(entry.key);
      const blockRefs = [...(entry.blocks ?? [])];
      if (blockRefs.some((ref) => !/^[a-f0-9]{64}$/u.test(ref))) throw new Error('library_sync_format');
      unique.set(`${entry.table}\u0000${key}`, {
        table: entry.table,
        key,
        valueJson: JSON.stringify(entry.value),
        blockRefs,
      });
    }
    this.syncBaseReplacement = [...unique.values()]
      .sort((left, right) => left.table.localeCompare(right.table) || left.key.localeCompare(right.key));
    this.wrote = true;
  }

  async all<T>(table: Table): Promise<T[]> {
    return (await this.entries(table)).map((entry) => entry.value as T);
  }

  async count(table: Table): Promise<number> {
    if (this.clears.has(table) || this.deletes.has(table) || this.puts.has(table)) {
      return (await this.entries(table)).length;
    }
    return storageCall(() => this.adapter.count(table));
  }

  async latestLearningActionAt(inputRunId:string):Promise<string|null>{
    const runId=recordKey(inputRunId);
    if(this.hasPendingChanges('learningEvents'))return (await this.entries('learningEvents')).map(row=>row.value as {runId:string;at:string}).filter(event=>event.runId===runId).sort((left,right)=>Date.parse(right.at)-Date.parse(left.at))[0]?.at??null;
    return storageCall(()=>this.adapter.latestLearningActionAt(runId));
  }

  async learningRunIdsForTarget(
    inputTargetId: string,
    options: Readonly<{ openOnly?: boolean }> = {},
  ): Promise<string[]> {
    const targetId = recordKey(inputTargetId);
    const openOnly = options.openOnly ?? false;
    if (this.hasPendingChanges('learningRuns')) {
      return (await this.entries('learningRuns'))
        .filter(({ value }) => {
          const run = value as { targetIds: string[]; completedAt: string | null };
          return run.targetIds.includes(targetId) && (!openOnly || !run.completedAt);
        })
        .map(({ key }) => key);
    }
    return storageCall(() => this.adapter.learningRunIdsForTarget(targetId, openOnly));
  }

  async countIntroducedLearningTargets(
    languageRouteId: string,
    startedAfter: string,
    startedBefore: string,
  ): Promise<number> {
    if (this.hasPendingChanges('learningTargets')) {
      return (await this.all<{
        introducedLanguageRouteId: string | null;
        startedAt: string | null;
      }>('learningTargets'))
        .filter((target) => target.introducedLanguageRouteId === languageRouteId
          && target.startedAt !== null
          && target.startedAt >= startedAfter
          && target.startedAt < startedBefore)
        .length;
    }
    return storageCall(() => this.adapter.countIntroducedLearningTargets(
      languageRouteId,
      startedAfter,
      startedBefore,
    ));
  }

  async openLearningTargetIds(): Promise<string[]> {
    if (this.hasPendingChanges('learningRuns')) {
      const targetIds = (await this.all<{ targetIds: string[]; completedAt: string | null }>('learningRuns'))
        .filter((run) => !run.completedAt)
        .flatMap((run) => run.targetIds);
      return [...new Set(targetIds)].sort();
    }
    const links = await storageCall(() => this.adapter.openLearningRunTargets());
    return [...new Set(links.map((link) => link.targetId))].sort();
  }

  async studyScopeMember(scopeRevisionId:string,targetId:string):Promise<import('./studyScopes').LocalStudyScopeMember|null>{
    if(this.hasPendingChanges('studyScopes')){
      const scope=await this.get<import('./studyScopes').LocalStudyScope>('studyScopes',scopeRevisionId);
      return scope?.members.find(member=>member.targetId===targetId)??null;
    }
    return storageCall(()=>this.adapter.studyScopeMember(scopeRevisionId,targetId));
  }

  async countContentAttemptsSince(inputTaskId: string, createdAfter: string): Promise<number> {
    const taskId = recordKey(inputTaskId);
    if (this.hasPendingChanges('contentAttempts')) {
      return (await this.all<{ taskId: string; createdAt: string }>('contentAttempts'))
        .filter((attempt) => attempt.taskId === taskId && attempt.createdAt > createdAfter)
        .length;
    }
    return storageCall(() => this.adapter.countContentAttemptsSince(taskId, createdAfter));
  }

  async learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    if (this.hasPendingChanges('learningTargets')) {
      return (await this.entries('learningTargets'))
        .filter(({ value }) => (value as {
          curriculumMemberships: Array<{
            status?: 'active' | 'superseded';
            sourceKind: string;
            languageContext: {
              languageRouteId: string;
              targetLanguageTag: string;
              supportLanguageTag: string;
            };
            provenance: Record<string, unknown>;
          }>;
        }).curriculumMemberships.some((membership) => (
          membership.status !== 'superseded'
          && membership.sourceKind === 'sense_learning_package'
          && membership.languageContext.languageRouteId === languageRouteId
          && membership.languageContext.targetLanguageTag === targetLanguageTag
          && membership.languageContext.supportLanguageTag === supportLanguageTag
          && membership.provenance.bookId === bookId
          && membership.provenance.bookVersionId !== nextBookVersionId
        )))
        .map(({ key }) => key);
    }
    return storageCall(() => this.adapter.learningTargetIdsForBookUpgrade(
      languageRouteId,
      targetLanguageTag,
      supportLanguageTag,
      bookId,
      nextBookVersionId,
    ));
  }

  async isMediaReferenced(inputMediaId: string): Promise<boolean> {
    const mediaId = recordKey(inputMediaId);
    if (!this.hasPendingChanges('semanticMeanings') && !this.hasPendingChanges('semanticInbox')) {
      return storageCall(() => this.adapter.isMediaReferenced(mediaId));
    }
    const meanings = await this.all<{
      personalSemanticAnchorRevisions?: Array<{ personalMediaObjectId?: string | null }>;
    }>('semanticMeanings');
    if (meanings.some((meaning) => meaning.personalSemanticAnchorRevisions
      ?.some((revision) => revision.personalMediaObjectId === mediaId))) return true;
    const inbox = await this.all<{
      payload?: { context?: { mediaReferenceIds?: string[] } | null };
    }>('semanticInbox');
    return inbox.some((item) => item.payload?.context?.mediaReferenceIds?.includes(mediaId));
  }

  put(table: Table, inputKey: string, value: unknown): void {
    this.assertWritable();
    const key = recordKey(inputKey);
    const tablePuts = this.puts.get(table) ?? new Map<string, unknown>();
    tablePuts.set(key, clone(value));
    this.puts.set(table, tablePuts);
    this.deletes.get(table)?.delete(key);
    this.wrote = true;
  }

  clear(table: Table): void {
    this.assertWritable();
    this.clears.add(table);
    this.deletes.delete(table);
    this.puts.delete(table);
    this.wrote = true;
  }

  delete(table: Table, inputKey: string): void {
    this.assertWritable();
    const key = recordKey(inputKey);
    this.puts.get(table)?.delete(key);
    if (!this.clears.has(table)) {
      const tableDeletes = this.deletes.get(table) ?? new Set<string>();
      tableDeletes.add(key);
      this.deletes.set(table, tableDeletes);
    }
    this.wrote = true;
  }

  /**
   * Returns the persisted and proposed values for only the records staged by
   * this transaction. Domain authorities use this seam before SQLite commit;
   * ordinary commands never need to scan an entire logical table.
   */
  async proposedChanges<Tables extends readonly Table[]>(
    tables: Tables,
  ): Promise<Array<LibraryRecordTransition<Tables>>> {
    const selected = new Set<Table>(tables);
    const keys = new Map<Table, Set<string>>();
    const add = (table: Table, key: string) => {
      if (!selected.has(table)) return;
      const tableKeys = keys.get(table) ?? new Set<string>();
      tableKeys.add(key);
      keys.set(table, tableKeys);
    };
    for (const table of this.clears) {
      if (!selected.has(table)) continue;
      for (const row of await storageCall(() => this.adapter.entries(table))) add(table, row.key);
    }
    for (const [table, deleted] of this.deletes) for (const key of deleted) add(table, key);
    for (const [table, values] of this.puts) for (const key of values.keys()) add(table, key);

    const changes: Array<LibraryRecordTransition<Tables>> = [];
    for (const [table, tableKeys] of keys) {
      for (const key of tableKeys) {
        const beforeEncoded = await this.storedValue(table,key);
        const after = await this.get(table, key);
        const afterEncoded = after === undefined ? null : encode(after);
        const before=beforeEncoded===null?null:await this.decodeStored(table,beforeEncoded);
        const comparableBefore=before===null?null:encode(before);
        if (comparableBefore === afterEncoded) continue;
        changes.push({
          table: table as Tables[number],
          key,
          before: before===null?null:clone(before),
          after: after === undefined ? null : clone(after),
        });
      }
    }
    return changes.sort((left, right) => (
      left.table.localeCompare(right.table) || left.key.localeCompare(right.key)
    ));
  }

  async mutation():Promise<SqliteMutation>{
    const portablePackages:PortablePackageMediaWrite[]=[];
    const puts:SqliteMutation['puts']=[];
    const portablePuts=this.puts.get('packageCache');
    const externalize=portablePuts?.size
      ?(await import('./portableMediaCache')).externalizePortablePackageCache
      :null;
    let prepared=0;
    for(const [table,values] of this.puts)for(const [key,value] of values){
      this.assertCommitSignals();
      if(table!=='packageCache')puts.push({table,key,encodedValue:encode(value)});
      else{
        const externalized=await externalize!(key,value);
        portablePackages.push(externalized.write);
        puts.push({table,key,encodedValue:encode(externalized.storedValue)});
      }
      // Preparation is not a SQLite commit. Let input/paint run between bounded
      // chunks while the same write lock and single eventual commit stay intact.
      if(++prepared%8===0&&typeof document!=='undefined'){
        const scheduler=(globalThis as typeof globalThis&{scheduler?:{yield?:()=>Promise<void>}}).scheduler;
        if(scheduler?.yield)await scheduler.yield();
        else await new Promise<void>(resolve=>setTimeout(resolve,0));
        this.assertCommitSignals();
      }
    }
    return {
      clears: [...this.clears],
      deletes: [...this.deletes].flatMap(([table, keys]) =>
        [...keys].map((key) => ({ table, key }))),
      puts,
      ...(portablePackages.length?{portablePackages}:{}),
      ...(this.syncBaseReplacement === undefined
        ? {}
        : { syncBaseReplacement: this.syncBaseReplacement }),
      ...(this.syncBasePatch===undefined?{}:{syncBasePatch:this.syncBasePatch}),
      ...(this.replicaCandidateRestore===undefined?{}:{replicaCandidateRestore:this.replicaCandidateRestore}),
    };
  }

  requireCommitSignal(
    signal:AbortSignal,
    code='library_transaction_cancelled',
    onCommitStart?:()=>void,
  ):void{
    this.assertWritable();this.commitSignals.push({signal,code,onCommitStart});
  }

  beginCommit():void{
    this.assertCommitSignals();
    // Keep these callbacks synchronous with the final abort check and the
    // adapter.commit call. Once they run, the atomic storage commit has begun
    // and an AbortSignal can no longer promise to undo it.
    for(const {onCommitStart} of this.commitSignals)onCommitStart?.();
  }

  assertCommitSignals():void{
    for(const {signal,code} of this.commitSignals)if(signal.aborted)throw new Error(code);
  }

  private hasPendingChanges(table: Table): boolean {
    return this.clears.has(table) || this.deletes.has(table) || this.puts.has(table);
  }

  private async decodeStored<T>(table:Table,encoded:string):Promise<T>{
    const value=decode(encoded);
    return (table==='packageCache'
      ?await import('./portableMediaCache').then(({hydratePortablePackageCache})=>
        hydratePortablePackageCache(value,digest=>storageCall(()=>this.adapter.portableMedia(digest))))
      :value) as T;
  }

  private assertWritable(): void {
    if (this.mode !== "readwrite") throw new Error("library_readonly_transaction");
  }
}

const runSerially = <T>(work: () => Promise<T>): Promise<T> => {
  const next = serial.catch(() => undefined).then(work);
  serial = next.then(() => undefined, () => undefined);
  return next;
};

async function runAcrossPages<T>(
  mode: "readonly" | "readwrite",
  work: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return work();
  try {
    return await navigator.locks.request(
      localLibraryScopedName('sensa-library-transaction-v1'),
      {
        mode: mode === "readonly" ? "shared" : "exclusive",
        signal: AbortSignal.timeout(45_000),
      },
      work,
    );
  } catch (cause) {
    if (cause instanceof DOMException && ['AbortError', 'TimeoutError'].includes(cause.name)) {
      throw new Error('localFlow.storageBusy', { cause });
    }
    throw cause;
  }
}

/** No network work in the logical transaction; media serialization may yield before one final SQLite commit. */
async function transaction<T>(
  mode: "readonly" | "readwrite",
  work: (tx: LibraryTransaction) => Promise<T>,
  kind: "content" | "state" | "cache" = "content",
): Promise<T> {
  const execute = async () => {
    assertLocalLibrarySelected();
    const adapter = await storageCall(sqliteRecordAdapter, 'localFlow.storageOpen');
    const library = new LibraryTransaction(mode, adapter);
    const value = await work(library);
    if (mode === "readwrite" && library.wrote) {
      let contentRevision: number | undefined;
      if (kind === "content") {
        const revision = await library.get<number>("meta", localLibraryRevisionKey) ?? 0;
        contentRevision = revision + 1;
        library.put("meta", localLibraryRevisionKey, contentRevision);
      }
      const mutation = await library.mutation();
      mutation.contentRevision = contentRevision;
      library.beginCommit();
      assertLocalLibrarySelected();
      const storageStarted=performance.now();
      try{await storageCall(() => adapter.commit(mutation));}
      catch(cause){
        // A coordinator may lose the ACK after the entire source transaction
        // committed, then replay a now-consumed candidate ID. Only its durable
        // transaction receipt permits treating that uncertain outcome as success.
        let confirmed=false;
        if(mutation.replicaCandidateRestore){
          try{
            const encoded=await storageCall(()=>adapter.get('meta','cloud-sync'));
            const state=encoded===null?undefined:decode(encoded) as {restoreOperationId?:string;syncedLocalRevision?:number};
            confirmed=state?.restoreOperationId===mutation.replicaCandidateRestore.id&&state.syncedLocalRevision===mutation.contentRevision;
          }catch{/* Keep the original failure when the outcome cannot be read. */}
        }
        if(!confirmed)throw cause;
      }
      if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.library.sqlite-commit',{start:storageStarted,end:performance.now()});
      if (kind === "state") window.dispatchEvent(new Event("sensa-sync-state-changed"));
      else {
        const tables = [...new Set([
          ...mutation.clears,
          ...mutation.deletes.map((row) => row.table),
          ...mutation.puts.map((row) => row.table),
          ...(mutation.replicaCandidateRestore?.tables??[]),
          ...(mutation.replicaCandidateRestore?['operations' as const]:[]),
        ])];
        const changes={sender:libraryNotificationSender,tables,clears:[...new Set([...mutation.clears,...(mutation.replicaCandidateRestore?.tables??[])])],
          records:[...mutation.puts,...mutation.deletes].map(({table,key})=>({table,key}))};
        window.dispatchEvent(new CustomEvent("sensa-library-changed", { detail: changes }));
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel(localLibraryScopedName('sensa-local-library'));
          channel.postMessage(changes);
          channel.close();
        }
      }
    }
    assertLocalLibrarySelected();
    return value;
  };
  // Web Locks already coordinate this entire logical transaction within and
  // across pages. Shared reads may overlap; an exclusive writer still fences
  // every read/modify/write sequence. Non-browser adapters retain the serial
  // fallback so their in-memory snapshots cannot interleave.
  return typeof navigator !== "undefined" && navigator.locks
    ? runAcrossPages(mode, execute)
    : runSerially(execute);
}

/** Reserved for validated full-library restore; it remains one SQLite transaction. */
export const restoreLibraryTransaction = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work);
/** A sealed private candidate is coherent without holding the live Library's
 * Web Lock. Its Worker fence aborts if concurrent user/owner writes occur. */
export async function requestReplicaCandidate(request:ReplicaCandidateRequest):Promise<ReplicaCandidateResponse>{
  assertLocalLibrarySelected();const adapter=await storageCall(sqliteRecordAdapter,'localFlow.storageOpen');
  const result=await adapter.replicaCandidate(request);assertLocalLibrarySelected();return result;
}
/** Sync progress and baselines do not announce learner-content changes. */
export const writeLibraryState = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work, "state");
/** Device-local, reproducible caches announce UI changes without entering the
 * learner-content revision journal or scheduling a Cloud Checkpoint. */
export const writeLibraryCache = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readwrite", work, "cache");
export const readLibrary = <T>(work: (tx: LibraryTransaction) => Promise<T>) =>
  transaction("readonly", work);

/** Cheap advisory size for UI. The Worker aggregates encoded rows without
 * hydrating media, cloning the library, or running restore validation. */
export const estimateLibraryRecordBytes=async(tables:readonly Table[]):Promise<number>=>{
  const adapter=await storageCall(sqliteRecordAdapter,'localFlow.storageOpen');
  return storageCall(()=>adapter.estimateRecordBytes(tables));
};

/**
 * A Worker-owned, single-snapshot read for the home queue. It intentionally
 * bypasses the page transaction chain: the Worker returns one immutable compact
 * result, so it cannot observe a partial SQLite commit or staged page writes.
 */
export const readHomeLearningRecords = async (
  languageRouteId: string,
  clock=Date.now(),
): Promise<HomeLearningStorageProjection> => {
  const adapter = await storageCall(sqliteRecordAdapter, 'localFlow.storageOpen');
  return storageCall(() => adapter.homeLearningProjection(languageRouteId,clock));
};
export const readLearningHistoryPage=async(query:import('../../learning/system/learningHistoryModel').LearningHistoryRequest)=>{const adapter=await storageCall(sqliteRecordAdapter,'localFlow.storageOpen');return storageCall(()=>adapter.learningHistoryPage(query));};
export const readLearningSemanticMemoryRecords=async(targetId?:string)=>{const adapter=await storageCall(sqliteRecordAdapter,'localFlow.storageOpen');return storageCall(()=>adapter.learningSemanticMemory(targetId));};
export const readLearningManagementSummary=async(query:import('./runtimeLearningCandidates').LearningManagementSummaryQuery)=>{const adapter=await storageCall(sqliteRecordAdapter,'localFlow.storageOpen');return storageCall(()=>adapter.learningManagementSummary(query));};
export const readRuntimeLearningCandidates=async(query:import('./runtimeLearningCandidates').RuntimeLearningCandidateQuery)=>{const adapter=await storageCall(sqliteRecordAdapter,'localFlow.storageOpen');return storageCall(()=>adapter.runtimeLearningCandidates(query));};

export const readLocalLibraryRevision = (tx: LibraryTransaction): Promise<number> =>
  tx.get<number>("meta", localLibraryRevisionKey).then((value) => value ?? 0);

/** A meaningful product milestone asks the account adapter for an early Checkpoint. */
export function requestCloudCheckpoint(): void {
  window.dispatchEvent(new Event(cloudCheckpointRequestEvent));
}

/** A cleared/restored library fences every command from an older page instance. */
export async function assertCurrentLibrary(tx: LibraryTransaction): Promise<string> {
  const current = await tx.get<string>("meta", "local-incarnation") ?? "initial";
  sessionIncarnation ??= current;
  if (sessionIncarnation !== current) throw new Error("localFlow.libraryReplaced");
  return current;
}

export type Operation = { id: string; kind: string; input: unknown };

export async function command<T>(
  op: Operation,
  work: (tx: LibraryTransaction) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/iu.test(op.id)) throw new Error("localFlow.operationInvalid");
  const input = canonicalConsumerJson({ kind: op.kind, input: op.input });
  return transaction("readwrite", async (tx) => {
    await assertCurrentLibrary(tx);
    if(hasLocalLibraryHint()&&!await tx.get('meta','identity'))throw new Error('localFlow.libraryMissing');
    const prior = await tx.get<{ input: string; result: T; cloudReceipt?: true }>("operations", op.id);
    if (prior) {
      if (prior.input !== input) throw new Error("localFlow.operationConflict");
      // Restored domain facts already contain this command's effects. A compact cloud
      // receipt must prevent duplicate execution without pretending to carry its result.
      if (prior.cloudReceipt) throw new Error("localFlow.operationAlreadyApplied");
      return prior.result;
    }
    const value = await work(tx);
    tx.put("operations", op.id, { input, result: value, committedAt: new Date().toISOString() });
    return value;
  });
}

export type LibraryIdentity = {
  id: string;
  learnerId: string;
  deviceId: string;
  createdAt: string;
  schemaVersion: 2;
};

export async function openLibrary(): Promise<LibraryIdentity> {
  // Opening verifies current identity, not a possibly orphaned creation receipt.
  // Missing prior data is a recovery state, never an automatic empty replacement.
  const identity=await transaction('readwrite',async tx=>{
    await assertCurrentLibrary(tx);
    const key='00000000-0000-4000-8000-000000000001';
    const input=canonicalConsumerJson({kind:'library.create',input:{}});
    const prior=await tx.get<{input:string;result:unknown}>('operations',key);
    if(prior&&prior.input!==input)throw new Error('localFlow.operationConflict');
    const existing=await tx.get<LibraryIdentity>('meta','identity');
    if(existing){
      if(prior&&canonicalConsumerJson(prior.result)!==canonicalConsumerJson(existing))throw new Error('localFlow.libraryMissing');
      // Export/replica validation requires this reserved receipt. Reconstruct a
      // missing receipt from the actual identity, never the other way around.
      if(!prior)tx.put('operations',key,{input,result:existing,committedAt:existing.createdAt});
      return existing;
    }
    if(prior||hasLocalLibraryHint()||await tx.get('meta','service-owner'))throw new Error('localFlow.libraryMissing');
    const meta=await tx.entries('meta');
    const intentionalReset=meta.some(row=>row.key==='local-reset'&&row.value==='account-deletion')&&meta.some(row=>row.key==='signed-out'&&row.value===true);
    const permittedMeta=intentionalReset?['package-catalog','local-reset','signed-out','local-incarnation','local-content-revision']:['package-catalog'];
    if(meta.some(row=>!permittedMeta.includes(String(row.key))))throw new Error('localFlow.libraryMissing');
    const operations=await tx.entries('operations');
    if(operations.some(row=>JSON.parse(row.value.input).kind!=='package.catalog'))throw new Error('localFlow.libraryMissing');
    // Public caches/catalog metadata do not claim a learner library. Any owned
    // rows without identity, however, must remain intact for recovery.
    for(const table of libraryTables)if(!['meta','operations','packageCache'].includes(table)&&await tx.count(table))throw new Error('localFlow.libraryMissing');
    const identity: LibraryIdentity = {
      id: crypto.randomUUID(),
      learnerId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      schemaVersion: 2,
    };
    tx.put("meta", "identity", identity);
    tx.delete('meta','local-reset');
    tx.put('operations',key,{input,result:identity,committedAt:identity.createdAt});
    return identity;
  });
  markLocalLibraryPresent();
  return identity;
}

export function observeLibrary(listener: () => void, tables?: readonly Table[], keys?:Readonly<Partial<Record<Table,readonly string[]>>>): () => void {
  const filter = tables ? new Set<Table>(tables) : null;
  const relevant = (change: {tables?:unknown;clears?:unknown;records?:unknown}|undefined): boolean => {
    if(!filter||!Array.isArray(change?.tables))return true;
    return change.tables.some((table:Table)=>{
      if(!filter.has(table))return false;
      const selected=keys?.[table];
      if(!selected)return true;
      // Notifications are hints, never facts. An incomplete hint triggers a
      // coherent reread rather than silently missing a library replacement.
      if(!Array.isArray(change.clears)||!Array.isArray(change.records))return true;
      if(change.clears.includes(table))return true;
      const records=change.records.filter(record=>record&&typeof record==='object'
        &&record.table===table&&typeof record.key==='string');
      return !records.length||records.some(record=>selected.includes(record.key));
    });
  };
  const local = (event: Event) => {
    if (relevant((event as CustomEvent).detail)) listener();
  };
  window.addEventListener("sensa-library-changed", local);
  const channel = typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(localLibraryScopedName('sensa-local-library'));
  if (channel) channel.onmessage = (event) => {
    if(event.data?.sender===libraryNotificationSender)return;
    if (relevant(event.data)) listener();
  };
  return () => {
    window.removeEventListener("sensa-library-changed", local);
    channel?.close();
  };
}

export function observeCloudSync(listener: () => void): () => void {
  window.addEventListener("sensa-sync-state-changed", listener);
  const stop = observeLibrary(listener);
  return () => {
    window.removeEventListener("sensa-sync-state-changed", listener);
    stop();
  };
}

export function observeCloudSyncState(listener: () => void): () => void {
  window.addEventListener("sensa-sync-state-changed", listener);
  return () => window.removeEventListener("sensa-sync-state-changed", listener);
}

export async function readLibraryStorageDiagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): Promise<SqliteStorageDiagnostics> {
  const adapter = await storageCall(sqliteRecordAdapter, 'localFlow.storageOpen');
  return storageCall(() => adapter.diagnostics(options),'localFlow.storageOpen');
}

export async function readPortableMediaStorageDiagnostics():Promise<PortableMediaStorageDiagnostics>{
  const adapter=await storageCall(sqliteRecordAdapter,'localFlow.storageOpen');
  return storageCall(()=>adapter.portableMediaDiagnostics());
}
