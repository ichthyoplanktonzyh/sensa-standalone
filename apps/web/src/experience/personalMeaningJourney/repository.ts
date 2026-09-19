import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {
  assertCurrentLibrary,
  readLibrary,
  restoreLibraryTransaction,
  type Table,
} from '../../data/library/store';
import {parseStoredMedia,type StoredMedia} from '../../data/library/media';
import {StorageUnavailableError} from './ports';
import {
  emptyJourneyState,
  JOURNEY_STORE_VERSION,
  parseJourneyState,
  StoreCorruptedError,
  type CommandReceipt,
  type JourneyState,
  type MeaningJourneyRecord,
  type SenseRegistryState,
} from './store';

export const semanticJourneyTables = [
  'semanticState',
  'semanticMeanings',
  'semanticRegistry',
  'semanticInbox',
  'semanticDrafts',
  'semanticReceipts',
] as const satisfies readonly Table[];
type SemanticTable=(typeof semanticJourneyTables)[number];
type Records=Record<SemanticTable,Map<string,unknown>>;
type SemanticRecordChange={
  table:Exclude<SemanticTable,'semanticState'>;
  key:string;
  before:unknown;
  after:unknown;
};

const emptyRecords=():Records=>Object.fromEntries(semanticJourneyTables.map(table=>[table,new Map()])) as Records;
const clone=<T,>(value:T):T=>structuredClone(value);

type RegistryKind=keyof SenseRegistryState;
const registryIds:{[K in RegistryKind]:(value:SenseRegistryState[K][number])=>string}={
  senses:value=>value.senseId,
  senseVersions:value=>value.senseVersionId,
  expressions:value=>value.expressionId,
  expressionVersions:value=>value.expressionVersionId,
  bindings:value=>value.senseExpressionBindingId,
  bindingVersions:value=>value.bindingVersionId,
};
type RegistryRow={kind:RegistryKind;ordinal:number;value:SenseRegistryState[RegistryKind][number]};

type IndexedValue={value:unknown;identity:unknown};
type IndexedRecords=Record<Exclude<SemanticTable,'semanticState'>,Map<string,IndexedValue>>;

/**
 * Build only a lightweight identity index. Commands preserve object identity for
 * untouched rows, so finding the records to commit never serializes the world.
 */
const indexState=(state:JourneyState):IndexedRecords=>{
  const records={
    semanticMeanings:new Map<string,IndexedValue>(),
    semanticRegistry:new Map<string,IndexedValue>(),
    semanticInbox:new Map<string,IndexedValue>(),
    semanticDrafts:new Map<string,IndexedValue>(),
    semanticReceipts:new Map<string,IndexedValue>(),
  };
  for(const meaning of state.meanings)records.semanticMeanings.set(
    meaning.personalMeaning.personalMeaningId,
    {value:meaning,identity:meaning},
  );
  for(const kind of Object.keys(registryIds) as RegistryKind[]){
    state.registry[kind].forEach((value,ordinal)=>{
      const id=(registryIds[kind] as (item:any)=>string)(value);
      records.semanticRegistry.set(`${kind}:${id}`,{
        value:{kind,ordinal,value} satisfies RegistryRow,
        identity:value,
      });
    });
  }
  for(const item of state.inboxItems)records.semanticInbox.set(
    item.intakeId,
    {value:item,identity:item},
  );
  for(const draft of state.clarificationDrafts)records.semanticDrafts.set(
    draft.intakeId,
    {value:draft,identity:draft},
  );
  for(const receipt of state.commandReceipts)records.semanticReceipts.set(
    receipt.operationId,
    {value:receipt,identity:receipt},
  );
  return records;
};

const recordChanges=(before:JourneyState,after:JourneyState):SemanticRecordChange[]=>{
  parseJourneyState(before);parseJourneyState(after);
  const previous=indexState(before),next=indexState(after),changes:SemanticRecordChange[]=[];
  for(const table of Object.keys(previous) as Array<keyof IndexedRecords>){
    const keys=new Set([...previous[table].keys(),...next[table].keys()]);
    for(const key of keys){
      const old=previous[table].get(key),current=next[table].get(key);
      const unchanged=old&&current&&old.identity===current.identity
        && (table!=='semanticRegistry'
          || (old.value as RegistryRow).ordinal===(current.value as RegistryRow).ordinal);
      if(!unchanged)changes.push({table,key,before:old?.value,after:current?.value});
    }
  }
  return changes;
};

const referencedMediaIds=(changes:readonly SemanticRecordChange[]):string[]=>{
  const ids=new Set<string>();
  for(const change of changes){
    const before=new Set<string>();
    if(change.table==='semanticMeanings'&&change.after){
      const meaning=change.after as MeaningJourneyRecord;
      const previous=change.before as MeaningJourneyRecord|undefined;
      for(const revision of previous?.personalSemanticAnchorRevisions??[]){
        if(revision.personalMediaObjectId)before.add(revision.personalMediaObjectId);
      }
      for(const revision of meaning.personalSemanticAnchorRevisions)if(
        revision.personalMediaObjectId&&!before.has(revision.personalMediaObjectId)
      )ids.add(revision.personalMediaObjectId);
    }
    if(change.table==='semanticInbox'&&change.after){
      const item=change.after as JourneyState['inboxItems'][number];
      const previous=change.before as JourneyState['inboxItems'][number]|undefined;
      for(const id of previous?.payload.context?.mediaReferenceIds??[])before.add(id);
      for(const id of item.payload.context?.mediaReferenceIds??[])if(!before.has(id))ids.add(id);
    }
  }
  return [...ids];
};

const stateFromRecords=(records:Records):JourneyState=>{
  const root=records.semanticState.get('root');
  const hasRows=semanticJourneyTables.some(table=>records[table].size>0);
  if(!root){
    if(hasRows)throw new StoreCorruptedError('本机的个人意义数据缺少版本记录。');
    return emptyJourneyState();
  }
  if(!root||typeof root!=='object'||(root as {version?:unknown}).version!==JOURNEY_STORE_VERSION){
    throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
  }
  const registry=Object.fromEntries((Object.keys(registryIds) as RegistryKind[]).map(kind=>[kind,[]])) as unknown as SenseRegistryState;
  const registryRows=[...records.semanticRegistry.values()] as RegistryRow[];
  for(const kind of Object.keys(registryIds) as RegistryKind[]){
    (registry[kind] as unknown[]).push(...registryRows.filter(row=>row.kind===kind).sort((a,b)=>a.ordinal-b.ordinal).map(row=>row.value));
  }
  return parseJourneyState({
    version:JOURNEY_STORE_VERSION,
    meanings:[...records.semanticMeanings.values()] as MeaningJourneyRecord[],
    registry,
    inboxItems:[...records.semanticInbox.values()],
    clarificationDrafts:[...records.semanticDrafts.values()],
    commandReceipts:[...records.semanticReceipts.values()] as CommandReceipt[],
  });
};

export interface JourneyCommit{
  /** Previous and next snapshots must share references for untouched records. */
  before:JourneyState;
  after:JourneyState;
  /** Prepared bytes are admitted only when a changed semantic row references them. */
  preparedMedia?:readonly StoredMedia[];
}

export interface JourneyCommitResult{committedMediaIds:string[]}

export interface JourneyRepository{
  load():Promise<JourneyState>;
  commit(change:JourneyCommit):Promise<JourneyCommitResult>;
}

/** Test adapter for the same normalized repository seam used by production. */
export class MemoryJourneyRepository implements JourneyRepository{
  private records=emptyRecords();
  writes=0;
  reads=0;
  async load():Promise<JourneyState>{return clone(stateFromRecords(this.records));}
  async commit(input:JourneyCommit):Promise<JourneyCommitResult>{
    const changes=recordChanges(input.before,input.after);
    this.writes=0;this.reads=1+changes.length;
    const root=this.records.semanticState.get('root');
    if(!root){this.records.semanticState.set('root',{version:JOURNEY_STORE_VERSION});this.writes++;}
    else if((root as {version?:unknown}).version!==JOURNEY_STORE_VERSION){
      throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
    }
    for(const change of changes){
      const current=this.records[change.table].get(change.key);
      if(!same(current,change.before))throw new JourneyConflictError();
      if(change.after===undefined)this.records[change.table].delete(change.key);
      else this.records[change.table].set(change.key,clone(change.after));
      this.writes++;
    }
    const prepared=new Set((input.preparedMedia??[]).map(item=>item.mediaId));
    return {committedMediaIds:referencedMediaIds(changes).filter(id=>prepared.has(id))};
  }
}

const translate=(cause:unknown,action:string):never=>{
  if(cause instanceof StoreCorruptedError||cause instanceof StorageUnavailableError||cause instanceof JourneyConflictError)throw cause;
  const detail=cause instanceof Error?cause.message:String(cause);
  throw new StorageUnavailableError(`${action}（${detail}）`);
};

const same=(left:unknown,right:unknown):boolean=>left===undefined||right===undefined
  ? left===right
  : canonicalConsumerJson(left)===canonicalConsumerJson(right);

export class JourneyConflictError extends Error{
  constructor(){super('localFlow.meaningChanged');this.name='JourneyConflictError';}
}

/** SQLite adapter. A command reads and writes only its changed logical rows. */
export class LibraryJourneyRepository implements JourneyRepository{
  async load():Promise<JourneyState>{
    try{
      const records=await readLibrary(async tx=>{
        const result=emptyRecords();
        for(const table of semanticJourneyTables)for(const row of await tx.entries(table))result[table].set(row.key,row.value);
        return result;
      });
      return stateFromRecords(records);
    }catch(cause){return translate(cause,'无法读取本机的个人意义数据。');}
  }
  async commit(input:JourneyCommit):Promise<JourneyCommitResult>{
    const changes=recordChanges(input.before,input.after);
    const prepared=new Map((input.preparedMedia??[]).map(raw=>{
      const media=parseStoredMedia(raw);
      return [media.mediaId,media] as const;
    }));
    const mediaIds=referencedMediaIds(changes);
    const committedMediaIds:string[]=[];
    try{
      await restoreLibraryTransaction(async tx=>{
        await assertCurrentLibrary(tx);
        const root=await tx.get<{version?:unknown}>('semanticState','root');
        if(!root)tx.put('semanticState','root',{version:JOURNEY_STORE_VERSION});
        else if(root.version!==JOURNEY_STORE_VERSION){
          throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
        }
        for(const mediaId of mediaIds){
          const current=await tx.get<StoredMedia>('media',mediaId);
          const candidate=prepared.get(mediaId);
          if(current){
            const stored=parseStoredMedia(current);
            if(candidate&&!same(stored,candidate))throw new JourneyConflictError();
          }else if(candidate){
            tx.put('media',mediaId,candidate);
            committedMediaIds.push(mediaId);
          }else{
            throw new StorageUnavailableError('图片材料尚未准备完成。');
          }
        }
        for(const change of changes){
          const current=await tx.get(change.table,change.key);
          if(!same(current,change.before))throw new JourneyConflictError();
          if(change.after===undefined)tx.delete(change.table,change.key);
          else tx.put(change.table,change.key,change.after);
        }
      });
    }catch(cause){translate(cause,'无法保存本机的个人意义数据。');}
    return {committedMediaIds};
  }
}

export const loadJourneyStateFromLibrary=():Promise<JourneyState>=>new LibraryJourneyRepository().load();

/** Pure reconstruction used by full-library validation at the sync seam. */
export const journeyStateFromRows=(rows:Record<SemanticTable,Array<{key:string;value:unknown}>>):JourneyState=>{
  const records=emptyRecords();
  for(const table of semanticJourneyTables)for(const row of rows[table])records[table].set(row.key,row.value);
  return stateFromRecords(records);
};
