/** Synthetic accepted facts for deterministic scale/concurrency checks; no paid service. */
import {sensaIntakePayloadSchema,type SensaSenseSemanticSpec} from '@sensa/contracts/sensa';
import {emptyJourneyState,type JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import {digestOf} from '../../../apps/web/src/experience/personalMeaningJourney/digest';

export const semanticLookupSpec:SensaSenseSemanticSpec={schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'临时取得他人物品，并预期归还。',
  prototypeScenes:[{summary:'一个人借用同伴的物品，之后归还。',participantRoles:['借用者','所有者'],states:['临时使用'],directionOrCausality:null}],
  includedCases:['暂借物品'],excludedCases:['永久赠送'],neighborContrasts:[{label:'赠送',distinction:'不预期归还'}],openQuestions:[]};

export const semanticLookupPayload=(semanticSpec=semanticLookupSpec)=>sensaIntakePayloadSchema.parse({contractVersion:'sensa-intake-v3',operationId:crypto.randomUUID(),capturedAt:'2026-10-03T00:00:00.000Z',
  context:{modality:'text',textSegment:'Private source: May asked to borrow an umbrella.',languageTag:'en',mediaReferenceIds:[],source:null},
  expression:{surfaceForm:'borrow',languageTag:'en',expressionTypeHint:'word',occurrence:{surfaceForm:'borrow',locator:{kind:'text_span',start:29,end:35}}},
  sense:{senseKey:'temporary-borrow',semanticSpec,wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'fixture',model:'fixture',policyVersion:'fixture-v1',sourceReferenceIds:['private-provenance']}},acceptance:{mode:'learner_direct'},
});

export function syntheticSemanticWorld(seed:JourneyState,count:number):JourneyState{
  const state=emptyJourneyState();
  for(let index=0;index<count;index++){
    const ids=new Map<string,string>();
    const clone=JSON.parse(JSON.stringify(seed,(_key,value:unknown)=>{
      if(typeof value==='string'&&/^[0-9a-f-]{36}$/u.test(value)){
        if(!ids.has(value))ids.set(value,crypto.randomUUID());return ids.get(value);
      }
      return value;
    })) as JourneyState;
    // JSON replacers rewrite values, while canonical parent maps also carry
    // immutable revision IDs in their object keys. Clone both sides.
    clone.contexts.anchorRevisionParents=Object.fromEntries(Object.entries(clone.contexts.anchorRevisionParents).map(([key,parent])=>[ids.get(key)??key,parent]));
    clone.registry.senses[0]!.senseKey=`borrow-${index}`;
    clone.registry.expressionVersions[0]!.surfaceForm=`borrow-${index}`;
    clone.registry.expressionVersions[0]!.normalizedForm=`borrow-${index}`;
    clone.registry.senseVersions[0]!.semanticSpec.coreMeaningFocus=`临时借用编号${index}的物品。`;
    state.meanings.push(...clone.meanings);
    state.contexts.anchors.push(...clone.contexts.anchors);state.contexts.anchorRevisions.push(...clone.contexts.anchorRevisions);Object.assign(state.contexts.anchorRevisionParents,clone.contexts.anchorRevisionParents);state.commandReceipts.push(...clone.commandReceipts);
    for(const kind of Object.keys(state.registry) as Array<keyof JourneyState['registry']>)(state.registry[kind] as unknown[]).push(...clone.registry[kind]);
  }
  return state;
}

export function advanceSemanticHeads(state:JourneyState):JourneyState{
  const next={...state,registry:structuredClone(state.registry)};
  const sense=next.registry.senses[0]!,expression=next.registry.expressions[0]!,binding=next.registry.bindings[0]!;
  const senseVersion={...next.registry.senseVersions[0]!,senseVersionId:crypto.randomUUID(),versionNumber:2,
    semanticSpec:{...semanticLookupSpec,coreMeaningFocus:'新版有不同的边界'}};
  const expressionVersion={...next.registry.expressionVersions[0]!,expressionVersionId:crypto.randomUUID(),versionNumber:2,surfaceForm:'borrow-v2'};
  const bindingVersion={...next.registry.bindingVersions[0]!,bindingVersionId:crypto.randomUUID(),versionNumber:2,
    senseVersionId:senseVersion.senseVersionId,expressionVersionId:expressionVersion.expressionVersionId};
  next.registry.senseVersions.push(senseVersion);next.registry.expressionVersions.push(expressionVersion);next.registry.bindingVersions.push(bindingVersion);
  Object.assign(sense,{currentSenseVersionId:senseVersion.senseVersionId,currentVersionNumber:2});
  Object.assign(expression,{currentExpressionVersionId:expressionVersion.expressionVersionId,currentVersionNumber:2});
  Object.assign(binding,{currentBindingVersionId:bindingVersion.bindingVersionId,currentVersionNumber:2});
  return next;
}

export function deleteFirstMeaning(state:JourneyState):JourneyState{
  // Typed projection fixture only; the actual command/receipt is tested through
  // PersonalMeaningJourney.changeMeaningLifecycle rather than claimed here.
  const record=structuredClone(state.meanings[0]!);
  Object.assign(record.personalMeaning,{status:'deleted',lifecycleRevision:record.personalMeaning.lifecycleRevision+1,
    updatedAt:'2026-10-03T01:00:00.000Z',deletedAt:'2026-10-03T01:00:00.000Z',deletedByOperationId:crypto.randomUUID()});
  record.personalMeaning.currentRevision++;
  record.personalMeaningRevisions.push({...record.personalMeaningRevisions.at(-1)!,personalMeaningRevisionId:crypto.randomUUID(),revision:record.personalMeaning.currentRevision,createdAt:record.personalMeaning.updatedAt,
    provenance:{kind:'learner_authored',sourceReferenceIds:[record.personalMeaning.personalMeaningId],createdByOperationId:record.personalMeaning.deletedByOperationId!},lifecycle:{kind:'delete',revision:record.personalMeaning.lifecycleRevision}});
  const stamp=record.personalMeaningRevisions.at(-1)!,operationId=stamp.provenance.createdByOperationId;
  const receipt={operationId,command:'ChangeMeaningLifecycle',requestDigest:digestOf({operationId,personalMeaningId:record.personalMeaning.personalMeaningId,expectedRevision:stamp.revision-1,action:'delete'}),result:{personalMeaningId:record.personalMeaning.personalMeaningId,personalMeaningRevisionId:stamp.personalMeaningRevisionId,revision:stamp.revision,lifecycleRevision:stamp.lifecycle!.revision,status:'deleted'}};
  return {...state,meanings:[record,...state.meanings.slice(1)],commandReceipts:[...state.commandReceipts,receipt]};
}
