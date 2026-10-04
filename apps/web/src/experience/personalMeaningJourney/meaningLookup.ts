import type { SensaSenseSemanticSpec } from '@sensa/contracts/sensa';
import type { JourneyState,SenseRegistryState } from './store';
import type {JourneyReadCondition} from './repository';
import {runCooperatively,runSynchronously} from './cooperative';
import {confirmedLookupConnections,normalizeMeaningQuery,validateMeaningQuery,type LookupRegistryRead} from './meaningLookupFacts';

export interface MeaningLookupReference { senseId: string; senseVersionId: string }
export interface MeaningLookupMatch extends MeaningLookupReference {
  senseKey: string;
  semanticSpec: SensaSenseSemanticSpec;
  expressions: Array<{expression: string; languageTag: string}>;
  expressionsTruncated: boolean;
}
export interface MeaningLookupResult { meanings: MeaningLookupMatch[]; truncated: boolean }
export const MEANING_LOOKUP_MAX_BYTES = 32 * 1024;
const normalize = normalizeMeaningQuery;
const grams = (text: string): Set<string> => {
  const chars = Array.from(text);
  return new Set([...chars, ...chars.slice(1).map((char, index) => chars[index]! + char)]);
};

/** Derived, owner-local index. It never reads drafts, Anchors, media or page details. */
function* meaningLookupSteps(state: JourneyState) {
  const registry = state.registry;
  const senses = new Map(registry.senses.map(row => [row.senseId, row]));
  const senseVersions = new Map(registry.senseVersions.map(row => [row.senseVersionId, row]));
  const bindings = new Map(registry.bindings.map(row => [row.senseExpressionBindingId, row]));
  const bindingVersions = new Map(registry.bindingVersions.map(row => [row.bindingVersionId, row]));
  const expressions = new Map(registry.expressions.map(row => [row.expressionId, row]));
  const expressionVersions = new Map(registry.expressionVersions.map(row => [row.expressionVersionId, row]));
  const entries = new Map<string, Omit<MeaningLookupMatch, 'expressionsTruncated'>>();
  const versionOrdinals=new Map(registry.senseVersions.map((row,index)=>[row.senseVersionId,index]));
  const maps={senses,senseVersions,bindings,bindingVersions,expressions,expressionVersions};
  const read:LookupRegistryRead=<K extends keyof SenseRegistryState>(kind:K,id:string)=>maps[kind].get(id) as SenseRegistryState[K][number]|undefined;
  for (const record of state.meanings) {
    yield;
    for(const connection of confirmedLookupConnections(record,read)){
      const {expression,languageTag,expressionVersionId:_version,...match}=connection;
      const entry=entries.get(match.senseVersionId)??{...match,expressions:[]};
      if(!entry.expressions.some(item=>item.expression===expression&&item.languageTag===languageTag))entry.expressions.push({expression,languageTag});
      entries.set(match.senseVersionId,entry);
    }
  }
  const postings = new Map<string, Set<string>>();
  const searchable = new Map<string, string[]>();
  for (const [id, entry] of entries) {
    yield;
    const texts = [entry.semanticSpec.coreMeaningFocus, ...entry.expressions.map(item => item.expression)].map(normalize);
    searchable.set(id, texts);
    for (const gram of new Set(texts.flatMap(text => [...grams(text)]))) {
      const ids = postings.get(gram) ?? new Set<string>(); ids.add(id); postings.set(gram, ids);
    }
  }
  return {
    query(raw: string): MeaningLookupResult {
      const query = validateMeaningQuery(raw), queryGrams = [...grams(query)];
      const groups = queryGrams.map(gram => postings.get(gram));
      if (groups.some(group => !group)) return {meanings: [], truncated: false};
      const smallest = groups.sort((a, b) => a!.size - b!.size)[0];
      const candidates = smallest ?? entries.keys();
      const result: MeaningLookupResult = {meanings: [], truncated: false};
      for (const id of candidates) {
        if (!groups.every(group => group!.has(id)) || !searchable.get(id)!.some(text => text.includes(query))) continue;
        if (result.meanings.length === 5) { result.truncated = true; break; }
        const entry = entries.get(id)!;
        // Keep matching expressions first. Full semantic boundaries are never shortened for reuse.
        const ordered = [...entry.expressions].sort((a, b) => Number(normalize(b.expression).includes(query)) - Number(normalize(a.expression).includes(query)));
        const match: MeaningLookupMatch = {...entry, expressions: ordered.slice(0, 5), expressionsTruncated: ordered.length > 5};
        const next = {meanings: [...result.meanings, match], truncated: true};
        if (new TextEncoder().encode(JSON.stringify({ok: true, ...next})).byteLength > MEANING_LOOKUP_MAX_BYTES) {
          result.truncated = true; continue;
        }
        result.meanings.push(match);
      }
      return structuredClone(result);
    },
    resolve(reference: MeaningLookupReference): MeaningLookupMatch | null {
      const sense=senses.get(reference.senseId),version=senseVersions.get(reference.senseVersionId);
      if(!sense||version?.senseId!==sense.senseId)return null;
      const entry=entries.get(version.senseVersionId);
      return structuredClone({...reference,senseKey:sense.senseKey,semanticSpec:version.semanticSpec,
        expressions:entry?.expressions.slice(0,5)??[],expressionsTruncated:(entry?.expressions.length??0)>5});
    },
    /** Private commit witness: never spread into model/tool output. */
    confirmationConditions(reference:MeaningLookupReference):readonly JourneyReadCondition[]{
      const version=senseVersions.get(reference.senseVersionId);
      if(!version||version.senseId!==reference.senseId)throw new Error('semantic_reference_unavailable');
      return [{table:'semanticRegistry',key:`senseVersions:${version.senseVersionId}`,
        expected:{kind:'senseVersions',ordinal:versionOrdinals.get(version.senseVersionId)!,value:version}}];
    },
  };
}

export const createMeaningLookup=(state:JourneyState)=>runSynchronously(meaningLookupSteps(state));
export const createMeaningLookupCooperatively=(state:JourneyState)=>runCooperatively(meaningLookupSteps(state));
