import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {
  assertCurrentLibrary,
  readLibrary,
  restoreLibraryTransaction,
  type Table,
} from '../../data/library/store';
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

const recordsFromState=(state:JourneyState):Records=>{
  const records=emptyRecords();
  records.semanticState.set('root',{version:JOURNEY_STORE_VERSION});
  for(const meaning of state.meanings)records.semanticMeanings.set(meaning.personalMeaning.personalMeaningId,meaning);
  for(const kind of Object.keys(registryIds) as RegistryKind[]){
    state.registry[kind].forEach((value,ordinal)=>{
      const id=(registryIds[kind] as (item:any)=>string)(value);
      records.semanticRegistry.set(`${kind}:${id}`,{kind,ordinal,value} satisfies RegistryRow);
    });
  }
  for(const item of state.inboxItems)records.semanticInbox.set(item.intakeId,item);
  for(const draft of state.clarificationDrafts)records.semanticDrafts.set(draft.intakeId,draft);
  for(const receipt of state.commandReceipts)records.semanticReceipts.set(receipt.operationId,receipt);
  return records;
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

export interface JourneyRepository{
  load():Promise<JourneyState>;
  save(state:JourneyState):Promise<void>;
}

/** Test adapter for the same normalized repository seam used by production. */
export class MemoryJourneyRepository implements JourneyRepository{
  private records=emptyRecords();
  writes=0;
  async load():Promise<JourneyState>{return clone(stateFromRecords(this.records));}
  async save(state:JourneyState):Promise<void>{
    const next=recordsFromState(parseJourneyState(state));
    this.writes=0;
    for(const table of semanticJourneyTables){
      const before=this.records[table],after=next[table];
      for(const key of before.keys())if(!after.has(key))this.writes++;
      for(const [key,value] of after)if(!before.has(key)||canonicalConsumerJson(before.get(key))!==canonicalConsumerJson(value))this.writes++;
    }
    this.records=cloneRecords(next);
  }
}

const cloneRecords=(records:Records):Records=>Object.fromEntries(semanticJourneyTables.map(table=>[
  table,
  new Map([...records[table]].map(([key,value])=>[key,clone(value)])),
])) as Records;

const translate=(cause:unknown,action:string):never=>{
  if(cause instanceof StoreCorruptedError||cause instanceof StorageUnavailableError)throw cause;
  const detail=cause instanceof Error?cause.message:String(cause);
  throw new StorageUnavailableError(`${action}（${detail}）`);
};

/** SQLite adapter. One save becomes one LibraryTransaction across all changed rows. */
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
  async save(state:JourneyState):Promise<void>{
    const desired=recordsFromState(parseJourneyState(state));
    try{
      await restoreLibraryTransaction(async tx=>{
        await assertCurrentLibrary(tx);
        for(const table of semanticJourneyTables){
          const current=new Map((await tx.entries(table)).map(row=>[row.key,row.value]));
          for(const key of current.keys())if(!desired[table].has(key))tx.delete(table,key);
          for(const [key,value] of desired[table])if(!current.has(key)||canonicalConsumerJson(current.get(key))!==canonicalConsumerJson(value))tx.put(table,key,value);
        }
      });
    }catch(cause){translate(cause,'无法保存本机的个人意义数据。');}
  }
}

export const loadJourneyStateFromLibrary=():Promise<JourneyState>=>new LibraryJourneyRepository().load();

/** Pure reconstruction used by full-library validation at the sync seam. */
export const journeyStateFromRows=(rows:Record<SemanticTable,Array<{key:string;value:unknown}>>):JourneyState=>{
  const records=emptyRecords();
  for(const table of semanticJourneyTables)for(const row of rows[table])records[table].set(row.key,row.value);
  return stateFromRecords(records);
};
