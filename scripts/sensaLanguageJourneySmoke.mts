/**
 * Intake preserves absolute language facts without consulting the learner's
 * currently selected Route. Route selection belongs to Add-to-Learning, not to
 * capture admission.
 */
import assert from 'node:assert/strict';
import {
  sensaIntakePayloadSchema,type SensaIntakePayload,type SensaPinnedLanguageContext,
} from '@sensa/contracts/sensa';
import {emptyJourneyState,JOURNEY_STORE_KEY} from '../apps/web/src/experience/personalMeaningJourney/store.ts';
import {executeFastTrack} from '../apps/web/src/experience/personalMeaningJourney/intakeEngine.ts';
import {createJourneyGateway} from '../apps/web/src/experience/personalMeaningJourney/gateway.ts';
import {MemoryStoragePort,createSeededClock} from '../apps/web/src/experience/personalMeaningJourney/ports.ts';
import type {CommandLanguages} from '../apps/web/src/experience/personalMeaningJourney/ports.ts';

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
    sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'从容地花时间做一件事',prototypeScenes:[{summary:text,participantRoles:[],states:[],directionOrCausality:null}],includedCases:[text],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'llm_suggested'},
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

// New material resolves the active context once and records the exact language.
let context:SensaPinnedLanguageContext={supportLanguageTag:'ko',targetLanguageTag:'it'};
const storage=new MemoryStoragePort();
const gateway=createJourneyGateway({storage,clock:createSeededClock(),languages:{read:async()=>context}});
await gateway.createPersonalMeaning({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'雨后的巷子'}],familiarExpression:{surfaceForm:'欲言又止'}});
const stored=JSON.parse(storage.read(JOURNEY_STORE_KEY)!) as any;
const saved=()=>JSON.parse(storage.read(JOURNEY_STORE_KEY)!) as any;
const written=stored.meanings[0].personalExpressionAnchorRevisions;
assert.equal(written.length,1,'the learner wording becomes its own expression anchor');
assert.equal(written[0].languageTag,'ko','the learner wording uses this operation’s Support Language');
assert.equal('learnerLanguageRole' in written[0],false);
const blockAnchors=stored.meanings[0].personalSemanticAnchorRevisions;
assert.equal(blockAnchors.length,1);
assert.equal(blockAnchors[0].languageTag,'ko','a text block carries the same operation-scoped Support Language');
assert.equal(blockAnchors[0].bodyText,'雨后的巷子');

// A later independent command resolves the current context again rather than
// language that happened to be stored on the record first.
context={supportLanguageTag:'zh-CN',targetLanguageTag:'es'};
await gateway.addMaterialBlock({operationId:crypto.randomUUID(),personalMeaningId:stored.meanings[0].personalMeaning.personalMeaningId,block:{kind:'text',bodyText:'雨停了'}});
const after=saved();
assert.deepEqual(after.meanings[0].personalSemanticAnchorRevisions.map((revision:any)=>revision.languageTag),['ko','zh-CN'],'a later block uses its own resolved context without rewriting the earlier Anchor');

// Two captures may arrive together from a batch-oriented Agent. Commands stay
// serialized so neither aggregate write drops the other.
const slowContext:SensaPinnedLanguageContext={supportLanguageTag:'zh-CN',targetLanguageTag:'en'};
const slowLanguages={read:async()=>{await new Promise(resolve=>setTimeout(resolve,1));return slowContext;}};
const raceStorage=new MemoryStoragePort();
const raceGateway=createJourneyGateway({storage:raceStorage,clock:createSeededClock(),languages:slowLanguages});
const captures=[
  fastTrackPayload('She took her time.','took','en'),
  fastTrackPayload('He broke the ice.','broke','en'),
];
const receipts=await Promise.all(captures.map(payload=>raceGateway.ingest(payload.operationId,payload)));
assert.deepEqual(receipts.map(receipt=>receipt.route),['fast_track','fast_track']);
assert.equal((await raceGateway.ingest(captures[0]!.operationId,captures[0]!)).replayed,true,'an exact retry replays its durable local receipt');
await assert.rejects(
  raceGateway.ingest(captures[0]!.operationId,{...captures[0]!,capturedAt:'2026-09-01T00:01:00.000Z'}),
  /operationId/,
  'one operation id cannot silently replay a different Intake payload',
);
const raced=JSON.parse(raceStorage.read(JOURNEY_STORE_KEY)!) as any;
assert.equal(raced.meanings.length,2,'two captures that overlap while the active context is read both survive');
assert.equal(raced.meanings.filter((meaning:any)=>meaning.personalMeaning.status==='active').length,2);

// A third language is still a valid absolute language fact and goes straight
// through; the current learning Route is irrelevant. Missing a language makes
// the Expression incomplete, while a missing Context has its own slow-track state.
const third=fastTrackPayload('Il a pris son temps.','a pris','fr');
assert.equal((await raceGateway.ingest(third.operationId,third)).route,'fast_track');
const undetermined=fastTrackPayload('She took her time.','took',null);
assert.equal((await raceGateway.ingest(undetermined.operationId,undetermined)).route,'inbox');
const withoutContext={...fastTrackPayload('She backed out.','backed out','en','back out'),operationId:crypto.randomUUID(),context:null,expression:null};
assert.equal((await raceGateway.ingest(withoutContext.operationId,withoutContext)).route,'inbox');
const waiting=(JSON.parse(raceStorage.read(JOURNEY_STORE_KEY)!) as any).inboxItems;
assert.deepEqual(waiting.map((item:any)=>item.status),['pending_expression','pending_context']);
const noContextMeaning=(JSON.parse(raceStorage.read(JOURNEY_STORE_KEY)!) as any).meanings.find((meaning:any)=>meaning.personalExpressionAnchorRevisions[0]?.surfaceForm==='back out');
assert.equal(noContextMeaning,undefined,'the no-context fixture remains in the Inbox');

console.log('PASS: Intake preserves absolute language tags, ignores the active learning Route, accepts canonical/observed expression forms, and mechanically routes missing facts. Pure engine and in-memory store; no browser, network or model.');
