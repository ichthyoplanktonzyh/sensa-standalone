/**
 * The pinned language context a journey command records.
 *
 * A captured expression states the language it is in; which side of the
 * operation's roles that language fills comes from its context, resolved
 * once per command. This guards the three places that decide it: the pure intake
 * engine, which is handed the context and refuses a language it cannot place,
 * the gateway, which stamps the learner's own wording, and the route decision,
 * which must send an unplaceable language to the Inbox instead of defaulting it
 * onto one side. Expression Anchors themselves keep only the exact Language Tag.
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

const localAuthority={verify:(request:any)=>request.mode==='learner_direct'?{mode:'learner_direct',actorId:'sensa-local-learner'}:{mode:'delegated_agent',actorId:request.actorId,authorizationGrantId:request.authorizationGrantId}};

/** One located expression with a resolved sense and a verified acceptance —
 * everything the fast track needs except a language its pair can place. */
function fastTrackPayload(text:string,surfaceForm:string,languageTag:string|null):SensaIntakePayload{
  // The located expression must actually occur in the captured context, so the
  // span is derived from the text instead of asserted alongside it.
  const start=text.indexOf(surfaceForm);
  if(start<0)throw new Error('fixture surface form is not in its context');
  return sensaIntakePayloadSchema.parse({
    contractVersion:'sensa-intake-v2',
    intakeOperationId:crypto.randomUUID(),
    capturedAt:'2026-09-01T00:00:00.000Z',
    context:{modality:'text',textSegment:text,mediaReferenceIds:[],source:null},
    expression:{surfaceForm,languageTag,occurrence:{kind:'text_span',start,end:start+surfaceForm.length},expressionTypeHint:'phrase'},
    sense:{senseKey:null,resolutionStatus:'resolved',definitionSummary:'从容地花时间做一件事',wordingSource:'llm_suggested',candidates:[]},
    acceptanceRequest:{mode:'learner_direct'},
  });
}

const run=(payload:SensaIntakePayload,languages:CommandLanguages)=>{
  let counter=0;
  return executeFastTrack(
    emptyJourneyState(),
    {payload,operationId:crypto.randomUUID(),authority:localAuthority as any},
    {newId:()=>crypto.randomUUID(),nowIso:()=>new Date(1700000000000+counter++*1000).toISOString(),languages},
  );
};

const spanish:CommandLanguages={supportLanguageTag:'zh-CN',targetLanguageTag:'es'};
const english:CommandLanguages={supportLanguageTag:'zh-CN',targetLanguageTag:'en'};

const targetInSpanish=run(fastTrackPayload('Ella se tomó su tiempo.','se tomó','es'),spanish);
assert.equal(targetInSpanish.bindingInput.languageTag,'es','a target expression keeps the language it was captured in, not a fixed English');
assert.equal(targetInSpanish.bindingCandidate.languageTag,'es');
const targetInEnglish=run(fastTrackPayload('She took her time.','took','en'),english);
assert.equal(targetInEnglish.bindingInput.languageTag,'en','the same capture under an English context records English');

const record=targetInSpanish.record;
const expressionRevision=record.personalExpressionAnchorRevisions[0]!;
assert.equal(expressionRevision.languageTag,'es','the stored expression anchor carries the target language');
assert.equal(expressionRevision.surfaceForm,'se tomó');

const supportRun=run(fastTrackPayload('他想说又停住了，最后欲言又止。','欲言又止','ja'),{supportLanguageTag:'ja',targetLanguageTag:'fr'});
assert.equal(supportRun.bindingInput.languageTag,'ja','a support-language capture keeps its absolute language instead of being relabeled');
const supportRevision=supportRun.record.personalExpressionAnchorRevisions[0]!;
assert.equal(supportRevision.languageTag,'ja');
assert.equal('learnerLanguageRole' in supportRevision,false,'an Expression Anchor does not store a learner-relative role');

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

// Resolving the context is asynchronous, so two captures can overlap where
// they previously could not. A command that read the aggregate before the
// other published would drop it, so commands are gated.
const slowContext:SensaPinnedLanguageContext={supportLanguageTag:'zh-CN',targetLanguageTag:'en'};
const slowLanguages={read:async()=>{await new Promise(resolve=>setTimeout(resolve,1));return slowContext;}};
const raceStorage=new MemoryStoragePort();
const raceGateway=createJourneyGateway({storage:raceStorage,clock:createSeededClock(),languages:slowLanguages});
const captures=[
  fastTrackPayload('She took her time.','took','en'),
  fastTrackPayload('He broke the ice.','broke','en'),
];
const receipts=await Promise.all(captures.map(payload=>raceGateway.ingest(payload.intakeOperationId,payload)));
assert.deepEqual(receipts.map(receipt=>receipt.route),['fast_track','fast_track']);
const raced=JSON.parse(raceStorage.read(JOURNEY_STORE_KEY)!) as any;
assert.equal(raced.meanings.length,2,'two captures that overlap while the active context is read both survive');
assert.equal(raced.meanings.filter((meaning:any)=>meaning.personalMeaning.status==='active').length,2);

// A capture in a language the operation cannot place is undecided, not guessed. Both
// a third language and an undetermined one reach the Inbox as `pending_language`
// even though every other fast-track condition is satisfied, because neither can
// be stamped onto a side of this learner's boundary.
const third=fastTrackPayload('Il a pris son temps.','a pris','fr');
assert.equal((await raceGateway.ingest(third.intakeOperationId,third)).route,'inbox');
const undetermined=fastTrackPayload('She took her time.','took',null);
assert.equal((await raceGateway.ingest(undetermined.intakeOperationId,undetermined)).route,'inbox');
const waiting=(JSON.parse(raceStorage.read(JOURNEY_STORE_KEY)!) as any).inboxItems;
assert.deepEqual(waiting.map((item:any)=>item.status),['pending_language','pending_language'],'an unplaceable or undetermined language waits for the learner instead of being filed under a side');
assert.equal(raced.meanings.length,2,'neither waiting capture grew the semantic world');

console.log('PASS: Intake preserves absolute Expression-Anchor Language Tags, resolves contextual Target/Support roles only at the operation boundary, and leaves an unknown or unrelated language pending instead of coercing it. Pure engine and in-memory store; no browser, network or model.');
