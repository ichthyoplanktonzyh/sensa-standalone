/** Snapshot-local identity reads, shared by projections and learning-source resolution. */
import type {SenseRegistryState} from './store';
export type IndexedRegistryRead=<K extends keyof SenseRegistryState>(kind:K,id:string)=>SenseRegistryState[K][number]|undefined;
export type RegistryRead=SenseRegistryState|IndexedRegistryRead;
const ids={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
export function readRegistry<K extends keyof SenseRegistryState>(registry:RegistryRead,kind:K,id:string):SenseRegistryState[K][number]|undefined{
 if(typeof registry==='function')return registry(kind,id);
 return registry[kind].find(row=>(row as unknown as Record<string,string>)[ids[kind]]===id) as SenseRegistryState[K][number]|undefined;
}
/** Callers cache only for immutable committed registry snapshots, never mutable drafts. */
export function indexRegistry(registry:SenseRegistryState):IndexedRegistryRead{
 const maps=Object.fromEntries((Object.keys(ids) as Array<keyof SenseRegistryState>).map(kind=>[kind,
  new Map(registry[kind].map(row=>[(row as unknown as Record<string,string>)[ids[kind]],row]))]));
 return <K extends keyof SenseRegistryState>(kind:K,id:string)=>maps[kind].get(id) as SenseRegistryState[K][number]|undefined;
}
