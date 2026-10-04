import {test} from 'vitest';
/**
 * Intake preserves absolute language facts without consulting the learner's
 * currently selected Route. Route selection belongs to Add-to-Learning, not to
 * capture admission.
 */
import assert from 'node:assert/strict';
import {
  sensaIntakePayloadSchema,type SensaIntakePayload,type SensaPinnedLanguageContext,
} from '@sensa/contracts/sensa';
import {emptyJourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store.ts';
import {executeFastTrack} from '../../../apps/web/src/experience/personalMeaningJourney/intakeEngine.ts';
import {createJourneyGateway,createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway.ts';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports.ts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository.ts';
import type {CommandLanguages} from '../../../apps/web/src/experience/personalMeaningJourney/ports.ts';

test("language-journey", async () => {

const localAuthority={verify:(request:any)=>request.mode==='learner_direct'?{mode:'learner_direct',actorId:'sensa-local-learner'}:{mode:'delegated_agent',actorId:request.actorId,basis:request.basis,authorizationReference:request.authorizationReference}};

/** One located expression with a resolved sense and a verified acceptance —
 * everything the fast track needs except a language its pair can place. */
function fastTrackPayload(text:string,observedForm:string,languageTag:string|null,rememberedForm=observedForm):SensaIntakePayload{
  // The located expression must actually occur in the captured context, so the
  // span is derived from the text instead of asserted alongside it.
  const start=text.indexOf(observedForm);
  if(start<0)throw new Error('fixture surface form is not in its context');
  return sensaIntakePayloadSchema.parse({
    contractVersion:'sensa-intake-v3',
    operationId:crypto.randomUUID(),
    capturedAt:'2026-09-01T00:00:00.000Z',
    context:{modality:'text',textSegment:text,mediaReferenceIds:[],languageTag,source:null},
    expression:{surfaceForm:rememberedForm,languageTag,occurrence:{surfaceForm:observedForm,locator:{kind:'text_span',start,end:start+observedForm.length}},expressionTypeHint:'phrase'},
    sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'从容地花时间做一件事',prototypeScenes:[{summary:text,participantRoles:[],states:[],directionOrCausality:null}],includedCases:[text],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'fixture',model:'fixture',policyVersion:'fixture-v1',sourceReferenceIds:['language-journey-smoke']}},
    acceptance:{mode:'learner_direct'},
  });
}

const run=(payload:SensaIntakePayload)=>{
  let counter=0;
  return executeFastTrack(
    emptyJourneyState(),
    {payload,operationId:payload.operationId,authority:localAuthority as any},
    {newId:()=>crypto.randomUUID(),nowIso:()=>new Date(1700000000000+counter++*1000).toISOString()},
  );
};

const targetInSpanish=run(fastTrackPayload('Ella se tomó su tiempo.','se tomó','es'));
assert.equal(targetInSpanish.bindingInput.languageTag,'es','a target expression keeps the language it was captured in, not a fixed English');
assert.equal(targetInSpanish.bindingCandidate.languageTag,'es');
const targetInEnglish=run(fastTrackPayload('She took her time.','took','en'));
assert.equal(targetInEnglish.bindingInput.languageTag,'en','the same capture under an English context records English');

const record=targetInSpanish.record;
const expressionRevision=record.personalExpressionAnchorRevisions[0]!;
assert.equal(expressionRevision.languageTag,'es','the stored expression anchor carries the target language');
assert.equal(expressionRevision.surfaceForm,'se tomó');

const supportRun=run(fastTrackPayload('他想说又停住了，最后欲言又止。','欲言又止','ja'));
assert.equal(supportRun.bindingInput.languageTag,'ja','a support-language capture keeps its absolute language instead of being relabeled');
const supportRevision=supportRun.record.personalExpressionAnchorRevisions[0]!;
assert.equal(supportRevision.languageTag,'ja');
assert.equal('learnerLanguageRole' in supportRevision,false,'an Expression Anchor does not store a learner-relative role');
const inflectedRun=run(fastTrackPayload('She backed out at the last minute.','backed out','en','back out'));
assert.equal(inflectedRun.record.personalExpressionAnchorRevisions[0]!.surfaceForm,'back out','the remembered form may differ from the observed occurrence');
assert.equal(inflectedRun.record.personalSemanticAnchorRevisions[0]!.structuredPayload.occurrenceSurfaceForm,'backed out');

// Web creation remains an Inbox clarification draft. Only one final confirmation
// atomically creates a complete, learnable Personal Meaning.
let context:SensaPinnedLanguageContext={supportLanguageTag:'ko',targetLanguageTag:'it'};
const repository=new MemoryJourneyRepository();
const gateway=createJourneyGateway({repository,clock:createSeededClock(),languages:{read:async()=>context}});
const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'雨后的巷子'}],familiarExpression:{surfaceForm:'欲言又止'},startingPoint:'from_expression'});
assert.equal(repository.writes,4,'a new clarification writes normalized state, Inbox, draft and receipt rows');
assert.equal(repository.reads,4,'the command reads only the version row and its three changed records');
let stored=await repository.load() as any;
const saved=async()=>repository.load() as Promise<any>;
assert.equal(stored.meanings.length,0,'saving material does not create a partial Personal Meaning');
assert.equal(stored.inboxItems.length,1);assert.equal(gateway.getWorldItems().length,0);
assert.equal(gateway.getClarificationDraft(draft.intakeId)?.startingPoint,'from_expression');
context={supportLanguageTag:'zh-CN',targetLanguageTag:'es'};
await gateway.addClarificationMaterial(crypto.randomUUID(),draft.intakeId,{kind:'text',bodyText:'雨停了'});
assert.equal(repository.writes,2,'editing one draft rewrites only its Inbox row and command receipt');
assert.equal(repository.reads,3,'editing a draft does not scan unrelated meanings or registry facts');
assert.equal((await saved()).meanings.length,0,'editing the slow-track draft still does not leak it into the world');
const clarifiedContext=gateway.getClarificationDraft(draft.intakeId)!.context!;
assert.equal(clarifiedContext.languageTag,null,'adding raw material must not classify its language from a changed Route');
assert.equal(clarifiedContext.languageObservation,null);
const completed=await gateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:draft.intakeId,source:await gateway.captureClarificationSource('intake',draft.intakeId),context:clarifiedContext,languageContext:{supportLanguageTag:'ko',targetLanguageTag:'it'},focus:null,sense:{proposedSenseKey:'hesitate-to-speak',coreMeaningFocus:'想说某件事却因为犹豫而停住',prototypeScenes:[{summary:'一个人准备开口，犹豫后停住。',participantRoles:['说话者'],states:['准备开口','犹豫'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[],unresolvedQuestions:[]},expression:{surfaceForm:'esitare a parlare',expressionType:'phrase',languageTag:'it',relation:'realizes',semanticCoverage:'exact'},expressionCandidates:[{surfaceForm:'esitare a parlare',expressionType:'phrase',languageTag:'it',relation:'realizes',semanticCoverage:'exact'}],confirmExpression:true,transcript:[{messageId:crypto.randomUUID(),role:'learner',body:'就是想说但停住的感觉。',occurredAt:'2026-09-01T00:00:01.000Z'}],provenance:{provider:'fixture',model:'fixture',promptVersion:'v1'},semanticPolicyVersion:'fixture-v1'});
stored=await saved();assert.equal(stored.inboxItems.length,0);assert.equal(stored.clarificationDrafts.length,0);assert.equal(stored.meanings.length,1);
assert.equal(completed.meaningFocusId,null,'an unambiguous Context completes without manufacturing a Focus');
assert.equal(stored.meanings[0].focuses.length,0);assert.equal(stored.meanings[0].focusAcceptances.length,0);
assert.equal(stored.meanings[0].constructions[0].meaningFocusId,null);assert.equal(stored.meanings[0].alignments[0].basis.meaningFocusId,null);
const written=stored.meanings[0].personalExpressionAnchorRevisions;
assert.equal(written.at(-1).languageTag,'it','the confirmed expression uses the clarification’s pinned Target Language');
const blockAnchors=stored.meanings[0].personalSemanticAnchorRevisions;
assert.equal(blockAnchors.length,1);assert.equal(blockAnchors[0].languageTag,null,'unclassified raw material remains unresolved, not stamped with a Support Route');assert.equal(blockAnchors[0].bodyText,'雨后的巷子\n\n雨停了');
assert.equal(gateway.getWorldItems().length,1);assert.equal(gateway.getLearningSources(completed.personalMeaningId).length,1,'the atomic result is immediately eligible for the one Add-to-Learning path');
const acceptedDetail=gateway.getDetail(completed.personalMeaningId)!;
const acceptedSource=gateway.getLearningSources(completed.personalMeaningId)[0]!;
const revised=await gateway.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:completed.personalMeaningId,expectedRevision:acceptedDetail.revision,blocks:[{kind:'text',bodyText:'雨停以后，我在巷口想开口却又停下。'}]});
assert.equal(revised.revision,acceptedDetail.revision+1);
assert.equal(gateway.getDetail(completed.personalMeaningId)?.materialBlocks[0]?.bodyText,'雨停以后，我在巷口想开口却又停下。','accepted expression details expose the current Context revision');
assert.equal(gateway.getLearningSources(completed.personalMeaningId)[0]?.context.text,acceptedSource.context.text,'editing Context preserves the originally accepted learning source rather than silently rewriting it');
await assert.rejects(gateway.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:completed.personalMeaningId,expectedRevision:acceptedDetail.revision,blocks:[{kind:'text',bodyText:'过期页面的覆盖'}]}),/meaningChanged/,'a stale expression detail cannot overwrite a newer Context revision');

// Two captures may arrive together from a batch-oriented Agent. Commands stay
// serialized so neither aggregate write drops the other.
const slowContext:SensaPinnedLanguageContext={supportLanguageTag:'zh-CN',targetLanguageTag:'en'};
const slowLanguages={read:async()=>{await new Promise(resolve=>setTimeout(resolve,1));return slowContext;}};
const raceRepository=new MemoryJourneyRepository();
const raceModules=createJourneyModules({repository:raceRepository,clock:createSeededClock(),languages:slowLanguages});
const raceGateway=raceModules.personalMeaningJourney;
const raceIntake=raceModules.semanticIntake;
const captures=[
  fastTrackPayload('She took her time.','took','en'),
  fastTrackPayload('He broke the ice.','broke','en'),
];
const receipts=await Promise.all(captures.map(payload=>raceIntake.submit(payload)));
assert.deepEqual(receipts.map(receipt=>receipt.route),['fast_track','fast_track']);
assert.equal((await raceIntake.submit(captures[0]!)).replayed,true,'an exact retry replays its durable local receipt');
await assert.rejects(
  raceIntake.submit({...captures[0]!,capturedAt:'2026-09-01T00:01:00.000Z'}),
  /operationId/,
  'one operation id cannot silently replay a different Intake payload',
);
const raced=await raceRepository.load() as any;
assert.equal(raced.meanings.length,2,'two captures that overlap while the active context is read both survive');
assert.equal(raced.meanings.filter((meaning:any)=>meaning.personalMeaning.status==='active').length,2);

// Separate tabs may start from the same snapshot. Record-scoped commits must
// preserve unrelated rows instead of replacing the second tab's whole world.
const sharedRepository=new MemoryJourneyRepository();
const tabA=createJourneyGateway({repository:sharedRepository,clock:createSeededClock(),languages:{read:async()=>slowContext}});
const tabB=createJourneyGateway({repository:sharedRepository,clock:createSeededClock(),languages:{read:async()=>slowContext}});
await Promise.all([
  tabA.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'tab A context'}]}),
  tabB.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'tab B context'}]}),
]);
assert.equal((await sharedRepository.load()).inboxItems.length,2,'independent tabs commit distinct Inbox records without a lost update');

// A rejected stale command is still a command failure, but a successful reload
// keeps the semantic world readable instead of replacing it with a global error.
const recoverableBase=new MemoryJourneyRepository();
let rejectCommit=true;
const recoverableGateway=createJourneyGateway({
  repository:{
    load:()=>recoverableBase.load(),
    commit:change=>rejectCommit
      ?Promise.reject(new Error('localFlow.meaningChanged'))
      :recoverableBase.commit(change),
  },
  clock:createSeededClock(),
  languages:{read:async()=>slowContext},
});
await assert.rejects(
  recoverableGateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'stale command'}]}),
  /meaningChanged/,
);
assert.deepEqual(recoverableGateway.getStatus(),{ok:true,error:null,errorKind:null,loading:false},'a successful conflict reload leaves the gateway usable');
assert.deepEqual(recoverableGateway.getWorldItems(),[],'the reloaded semantic world remains visible after the rejected command');
rejectCommit=false;
await recoverableGateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'retry after reload'}]});

// A third language is still a valid absolute language fact and goes straight
// through; the current learning Route is irrelevant. Missing a language makes
// the Expression incomplete, while a missing Context has its own slow-track state.
const third=fastTrackPayload('Il a pris son temps.','a pris','fr');
assert.equal((await raceIntake.submit(third)).route,'fast_track');
const pendingAcceptance={...fastTrackPayload('They broke the ice.','broke','en'),operationId:crypto.randomUUID(),acceptance:null};
const acceptanceQueued=await raceIntake.submit(pendingAcceptance);
assert.equal(acceptanceQueued.route,'inbox');
if(acceptanceQueued.route!=='inbox')throw new Error('fixture must enter Inbox');
const acceptedLater=await raceIntake.resolve({operationId:crypto.randomUUID(),intakeId:acceptanceQueued.intakeId,sense:pendingAcceptance.sense!});
assert.equal(acceptedLater.route,'fast_track');
if(acceptedLater.route!=='fast_track')throw new Error('fixture must commit');
const acceptedRecord=(await raceRepository.load() as any).meanings.find((meaning:any)=>meaning.personalMeaning.personalMeaningId===acceptedLater.personalMeaningId);
assert.equal(acceptedRecord.semanticAcceptances[0].resolutionProvenance.provider,'fixture','later learner Acceptance must not rewrite the original Sense resolver');
assert.equal(acceptedRecord.semanticAcceptances[0].authority.mode,'learner_direct','Acceptance authority remains a separate fact');
const undetermined=fastTrackPayload('She took her time.','took',null);
assert.equal((await raceIntake.submit(undetermined)).route,'inbox');
const withoutContext={...fastTrackPayload('She backed out.','backed out','en','back out'),operationId:crypto.randomUUID(),context:null,expression:null};
const noContextQueued=await raceIntake.submit(withoutContext);
assert.equal(noContextQueued.route,'inbox');
const waiting=(await raceRepository.load() as any).inboxItems;
assert.deepEqual(waiting.map((item:any)=>item.status),['pending_expression','pending_context']);
assert.equal((await raceRepository.load() as any).meanings.find((meaning:any)=>meaning.personalExpressionAnchorRevisions[0]?.surfaceForm==='back out'),undefined,'a missing Context cannot leak into the semantic world');
if(noContextQueued.route!=='inbox')throw new Error('fixture must enter Inbox');
const suppliedContext={modality:'text' as const,textSegment:'I planned to attend, but then changed my mind.',mediaReferenceIds:[],languageTag:'en',source:{client:'sensa-web',url:null,title:'Inbox clarification',sourceReferenceId:noContextQueued.intakeId,domSelector:null,paragraphContext:null}};
const supplied=await raceGateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:noContextQueued.intakeId,source:await raceGateway.captureClarificationSource('intake',noContextQueued.intakeId),context:suppliedContext,languageContext:slowContext,focus:null,sense:{proposedSenseKey:'back-out',coreMeaningFocus:'原本准备做某事，后来决定退出或取消',prototypeScenes:[{summary:'一个人原先准备参与，之后改变决定。',participantRoles:['行动者'],states:['原计划参与','决定退出'],directionOrCausality:'决定变化导致退出'}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[],unresolvedQuestions:[]},expression:{surfaceForm:'back out',expressionType:'phrase',languageTag:'en',relation:'realizes',semanticCoverage:'exact'},expressionCandidates:[{surfaceForm:'back out',expressionType:'phrase',languageTag:'en',relation:'realizes',semanticCoverage:'exact'}],confirmExpression:true,transcript:[{messageId:crypto.randomUUID(),role:'learner',body:suppliedContext.textSegment,occurredAt:'2026-09-01T00:00:02.000Z'}],provenance:{provider:'fixture',model:'fixture',promptVersion:'v1'},semanticPolicyVersion:'fixture-v1'});
assert.equal(raceGateway.getLearningSources(supplied.personalMeaningId)[0]?.context.text,suppliedContext.textSegment,'clarification must supply and preserve a formerly missing Context');

console.log('PASS: Intake preserves absolute language tags, ignores the active learning Route, accepts canonical/observed expression forms, and mechanically routes missing facts. Pure engine and in-memory store; no browser, network or model.');

});
