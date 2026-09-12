/**
 * The language pair a journey command records.
 *
 * A captured expression carries only a role — familiar or target — so the
 * language it is written in comes from the learner's profile, resolved once per
 * command. This guards the two places that decide it: the pure intake engine,
 * which is handed the pair, and the gateway, which stamps the learner's own
 * wording. Values are the profile's, never a constant that happens to match the
 * shipped pair.
 */
import assert from 'node:assert/strict';
import {
  sensaIntakePayloadSchema,type SensaIntakePayload,type SensaLanguageProfile,
} from '@sensa/contracts/sensa';
import {emptyJourneyState,JOURNEY_STORE_KEY} from '../apps/web/src/experience/personalMeaningJourney/store.ts';
import {executeFastTrack} from '../apps/web/src/experience/personalMeaningJourney/intakeEngine.ts';
import {createJourneyGateway} from '../apps/web/src/experience/personalMeaningJourney/gateway.ts';
import {MemoryStoragePort,createSeededClock} from '../apps/web/src/experience/personalMeaningJourney/ports.ts';
import type {CommandLanguages} from '../apps/web/src/experience/personalMeaningJourney/ports.ts';

const localAuthority={verify:(request:any)=>request.mode==='learner_direct'?{mode:'learner_direct',actorId:'sensa-local-learner'}:{mode:'delegated_agent',actorId:request.actorId,authorizationGrantId:request.authorizationGrantId}};

/** One located target-language expression with a resolved sense, which is
 * exactly what the fast track needs. */
function fastTrackPayload(text:string,surfaceForm:string,languageRole:'target'|'familiar'):SensaIntakePayload{
  // The located expression must actually occur in the captured context, so the
  // span is derived from the text instead of asserted alongside it.
  const start=text.indexOf(surfaceForm);
  if(start<0)throw new Error('fixture surface form is not in its context');
  return sensaIntakePayloadSchema.parse({
    contractVersion:'sensa-intake-v2',
    intakeOperationId:crypto.randomUUID(),
    capturedAt:'2026-09-01T00:00:00.000Z',
    context:{modality:'text',textSegment:text,mediaReferenceIds:[],source:null},
    expression:{surfaceForm,languageRole,occurrence:{kind:'text_span',start,end:start+surfaceForm.length},expressionTypeHint:'phrase'},
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

const spanish:CommandLanguages={familiarLanguageTag:'zh-CN',targetLanguageTag:'es'};
const english:CommandLanguages={familiarLanguageTag:'zh-CN',targetLanguageTag:'en'};

const targetInSpanish=run(fastTrackPayload('Ella se tomó su tiempo.','se tomó','target'),spanish);
assert.equal(targetInSpanish.bindingInput.languageTag,'es','a target expression takes the active target language, not a fixed English');
assert.equal(targetInSpanish.bindingCandidate.languageTag,'es');
const targetInEnglish=run(fastTrackPayload('She took her time.','took','target'),english);
assert.equal(targetInEnglish.bindingInput.languageTag,'en','the same capture under an English profile records English');

const record=targetInSpanish.record;
const expressionRevision=record.personalExpressionAnchorRevisions[0]!;
assert.equal(expressionRevision.languageTag,'es','the stored expression anchor carries the target language');
assert.equal(expressionRevision.learnerLanguageRole,'target');
assert.equal(expressionRevision.surfaceForm,'se tomó');

const familiarRun=run(fastTrackPayload('他想说又停住了，最后欲言又止。','欲言又止','familiar'),{familiarLanguageTag:'ja',targetLanguageTag:'fr'});
assert.equal(familiarRun.bindingInput.languageTag,'ja','a familiar expression takes the familiar language, even when it is not the shipped one');
const familiarRevision=familiarRun.record.personalExpressionAnchorRevisions[0]!;
assert.equal(familiarRevision.languageTag,'ja');
assert.equal(familiarRevision.learnerLanguageRole,'familiar');

// A learner's own wording is stamped from the profile, and no caller can claim
// a language for it: the seam that let the UI disagree with the profile is gone.
let profile:SensaLanguageProfile={familiarLanguageTag:'ko',targetLanguageTags:['it'],activeTargetLanguageTag:'it'};
const storage=new MemoryStoragePort();
const gateway=createJourneyGateway({storage,clock:createSeededClock(),languages:{read:async()=>profile}});
await gateway.createPersonalMeaning({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'雨后的巷子'}],familiarExpression:{surfaceForm:'欲言又止'}});
const stored=JSON.parse(storage.read(JOURNEY_STORE_KEY)!) as any;
const saved=()=>JSON.parse(storage.read(JOURNEY_STORE_KEY)!) as any;
const written=stored.meanings[0].personalExpressionAnchorRevisions;
assert.equal(written.length,1,'the familiar wording becomes its own expression anchor');
assert.equal(written[0].languageTag,'ko','the learner’s own wording is recorded in their familiar language');
assert.equal(written[0].learnerLanguageRole,'familiar');
const blockAnchors=stored.meanings[0].personalSemanticAnchorRevisions;
assert.equal(blockAnchors.length,1);
assert.equal(blockAnchors[0].languageTag,'ko','a text block is the learner’s own wording too, and carries the same familiar language');
assert.equal(blockAnchors[0].bodyText,'雨后的巷子');

// A later command re-reads the profile: it follows the learner rather than the
// language that happened to be stored on the record first.
profile={familiarLanguageTag:'zh-CN',targetLanguageTags:['es'],activeTargetLanguageTag:'es'};
await gateway.addMaterialBlock({operationId:crypto.randomUUID(),personalMeaningId:stored.meanings[0].personalMeaning.personalMeaningId,block:{kind:'text',bodyText:'雨停了'}});
const after=saved();
assert.deepEqual(after.meanings[0].personalSemanticAnchorRevisions.map((revision:any)=>revision.languageTag),['ko','zh-CN'],'a block appended after a language change follows the profile, not the language recorded earlier');

// Resolving the profile is asynchronous, so two captures can now overlap where
// they previously could not. A command that read the aggregate before the
// other published would drop it, so commands are gated.
const slowProfile:SensaLanguageProfile={familiarLanguageTag:'zh-CN',targetLanguageTags:['en'],activeTargetLanguageTag:'en'};
const slowLanguages={read:async()=>{await new Promise(resolve=>setTimeout(resolve,1));return slowProfile;}};
const raceStorage=new MemoryStoragePort();
const raceGateway=createJourneyGateway({storage:raceStorage,clock:createSeededClock(),languages:slowLanguages});
const captures=[
  fastTrackPayload('She took her time.','took','target'),
  fastTrackPayload('He broke the ice.','broke','target'),
];
const receipts=await Promise.all(captures.map(payload=>raceGateway.ingest(payload.intakeOperationId,payload)));
assert.deepEqual(receipts.map(receipt=>receipt.route),['fast_track','fast_track']);
const raced=JSON.parse(raceStorage.read(JOURNEY_STORE_KEY)!) as any;
assert.equal(raced.meanings.length,2,'two captures that overlap while the profile is read both survive');
assert.equal(raced.meanings.filter((meaning:any)=>meaning.personalMeaning.status==='active').length,2);

console.log('PASS: the intake engine and the journey gateway take every expression language from the learner’s profile; familiar and target roles resolve independently and a captured target expression records the active target language. Pure engine and in-memory store; no browser, network or model.');
