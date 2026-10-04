import {test,expect} from 'vitest';
import {manualMeaningPayload,newManualMeaningDraft,occurrencePositions} from '../../../apps/web/src/experience/intake/manualMeaning';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';

const draft=()=>({...newManualMeaningDraft(),context:'  📝 She backed out of the trip.  ',occurrence:'backed out',canonicalForm:'back out',languageTag:'en',expressionType:'phrase' as const,meaning:'退出已经答应参加的活动。',usage:'有人答应参加一次活动，后来改变主意不再参加。'});
test('manual authoring requires genuine contextual occurrence and preserves only learner-authored meaning',async()=>{
  const value=draft(),payload=manualMeaningPayload(value);
  expect(payload.expression?.occurrence).toEqual({surfaceForm:'backed out',locator:{kind:'text_span',start:7,end:17}});
  expect(payload.expression?.surfaceForm).toBe('back out');
  expect(payload.context?.languageTag).toBeNull(); // The expression's language does not classify the entire context.
  expect(payload.sense?.resolutionProvenance).toMatchObject({resolverKind:'learner',model:null,policyVersion:null});
  expect(()=>manualMeaningPayload({...value,context:''})).toThrow('contextRequired');
  expect(()=>manualMeaningPayload({...value,occurrence:'back out'})).toThrow('occurrenceRequired');
  expect(()=>manualMeaningPayload({...value,usage:''})).toThrow('meaningRequired');
  expect(()=>manualMeaningPayload({...value,languageTag:''})).toThrow('languageRequired');
  const repeated={...value,context:'backed out, then backed out again.'};
  expect(occurrencePositions(repeated.context,repeated.occurrence)).toEqual([0,17]);
  expect(()=>manualMeaningPayload(repeated)).toThrow('occurrenceRequired');
  expect(manualMeaningPayload({...repeated,occurrenceStart:17}).expression?.occurrence?.locator).toEqual({kind:'text_span',start:17,end:27});
});
test('explicit manual save creates the complete ordinary Meaning once with no model or learning facts',async()=>{
  const repository=new MemoryJourneyRepository();
  const {semanticIntake}=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  const payload=manualMeaningPayload(draft());
  expect((await repository.load()).meanings).toHaveLength(0);
  const result=await semanticIntake.submit(payload);expect(result.route).toBe('fast_track');
  expect(await semanticIntake.submit(payload)).toEqual({...result,replayed:true});
  await expect(semanticIntake.submit({...payload,capturedAt:'2026-10-05T12:00:00Z'})).rejects.toThrow('operationId');
  const state=await repository.load();expect(state.meanings).toHaveLength(1);expect(state.inboxItems).toHaveLength(0);
  const meaning=state.meanings[0]!;
  expect(meaning.semanticAcceptances[0]).toMatchObject({resolutionProvenance:{resolverKind:'learner',provider:'sensa-web-manual',model:null},authority:{mode:'learner_direct'}});
  expect(meaning.personalExpressionAnchorRevisions[0]).toMatchObject({surfaceForm:'back out',provenanceKind:'learner_authored',occurrence:{kind:'text_span',start:7,end:17}});
  expect(meaning.bindingConfirmations).toHaveLength(1);
  expect(state.registry.senseVersions[0]?.semanticSpec).toEqual(payload.sense!.semanticSpec);
  expect(meaning.focuses).toHaveLength(0);
});
