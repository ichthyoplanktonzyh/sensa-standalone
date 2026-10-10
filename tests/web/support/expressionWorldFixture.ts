/** Isolated accepted facts; providers, accounts and owner libraries are absent. */
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,semanticLookupSpec,syntheticSemanticWorld} from './semanticLookupFixtures';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';

export async function expressionWorldFixture(extra=0):Promise<JourneyState>{
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}),gateway=modules.personalMeaningJourney;
 const expressions=[{surfaceForm:'borrow',languageTag:'en',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const},{surfaceForm:'take on loan',languageTag:'en',expressionType:'phrase' as const,relation:'realizes' as const,semanticCoverage:'exact' as const},{surfaceForm:'emprunter',languageTag:'fr',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const}];
 const {schemaVersion:_schema,...spec}=semanticLookupSpec;
 const context={...semanticLookupPayload().context!,source:{client:'fixture',title:'隔离原文来源',url:'https://example.test/original',sourceReferenceId:'fixture-source',domSelector:null,paragraphContext:null}};
 const captured=await modules.semanticIntake.submit({...semanticLookupPayload(),context,acceptance:null,sense:null});if(captured.route!=='inbox')throw Error('expected isolated capture');const draft={intakeId:captured.intakeId};
 const accepted=await gateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:draft.intakeId,source:await gateway.captureClarificationSource('intake',draft.intakeId),context,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:{statement:'临时借用物品',distinguishingNotes:[],aspectLabel:''},sense:{proposedSenseKey:'temporary-borrow',...spec,unresolvedQuestions:[]},expression:{...expressions[0]!},expressionCandidates:expressions,confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'fixture'},semanticPolicyVersion:'fixture'});
 for(const expression of expressions.slice(1)){
  const record=(await repository.load()).meanings[0]!,focus=gateway.getDetail(accepted.personalMeaningId)!.focuses[0]!,candidate=record.proposalVersions[0]!.expressionCandidates.find(row=>row.surfaceForm===expression.surfaceForm)!;
  await gateway.confirmExpressionBinding({operationId:crypto.randomUUID(),personalMeaningId:accepted.personalMeaningId,source:await gateway.captureClarificationSource('personal_meaning',accepted.personalMeaningId),meaningFocusId:focus.meaningFocusId,senseVersionId:focus.alignment!.senseVersionId,candidateId:candidate.candidateId,...expression});
 }
 await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'尚待绑定的隔离材料'}]});
 const state=await repository.load();
 const singleRepository=new MemoryJourneyRepository(),singleModules=createJourneyModules({repository:singleRepository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
 await singleModules.semanticIntake.submit(semanticLookupPayload());
 const additions=syntheticSemanticWorld(await singleRepository.load(),4+extra);
 additions.registry.expressionVersions.forEach((version,index)=>{version.surfaceForm=index<3?'borrow':index===3?'isolated expression':`fixture expression ${index}`;version.normalizedForm=version.surfaceForm;});
 // Reuse one exact Expression/Version in a different Sense: real identity,
 // multiple interpretations. The other two same-text IDs remain distinct.
 const oldExpression=additions.registry.expressions[2]!,oldVersion=additions.registry.expressionVersions[2]!,original=state.registry.expressions[0]!,originalVersion=state.registry.expressionVersions[0]!;
 const mapped=JSON.parse(JSON.stringify(additions,(_key,value)=>value===oldExpression.expressionId?original.expressionId:value===oldVersion.expressionVersionId?originalVersion.expressionVersionId:value)) as JourneyState;
 mapped.registry.expressions.splice(2,1);mapped.registry.expressionVersions.splice(2,1);
 state.meanings.push(...mapped.meanings);
 for(const kind of Object.keys(state.registry) as Array<keyof JourneyState['registry']>)(state.registry[kind] as unknown[]).push(...mapped.registry[kind]);
 return state;
}
