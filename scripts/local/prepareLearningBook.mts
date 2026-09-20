/** Explicit operator media preparation. Ordinary dev startup never calls TTS. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {prepareLearningResourceFacts} from '../../apps/api/src/sensa/resources/supplements.ts';
import {edgeSpeechProvider} from './speechProvider.mts';
const sourcePath=process.argv[2],outputPath=process.argv[3];
if(!sourcePath||!outputPath)throw Error('Usage: prepareLearningBook.mts SOURCE OUTPUT [--allow-tts]');
const book=JSON.parse(await readFile(sourcePath,'utf8'));
const provider=edgeSpeechProvider(process.argv.includes('--allow-tts'));
for(const entry of book.entries){
 const sound=await provider({surface:entry.spokenForm??entry.expression,languageTag:book.targetLanguage},AbortSignal.timeout(45000));
 const {surface,languageTag,...pronunciation}=sound;
 entry.pronunciation=pronunciation;
 const prepared=await prepareLearningResourceFacts({expression:{surface:entry.expression,languageTag:book.targetLanguage,expressionKind:entry.expressionKind,...(entry.spokenForm?{spokenForm:entry.spokenForm}:{})},supportLanguageTag:book.supportLanguage,meaning:entry.meaning});
 entry.referenceFacts=[...(entry.referenceFacts??[]),...prepared.references.filter(reference=>!(entry.referenceFacts??[]).some((existing:any)=>existing.fact.factKind===reference.fact.factKind))];
 // Freeze explicit plain-text span; no runtime HTML inference or random examples.
 const scene=entry.sceneExample;
 if(!scene||!entry.sceneBridge)throw Error(`Missing binding resources: ${entry.key}`);
 const marked=scene.example.match(/<b>([^<]+)<\/b>/u);
 if(marked){
  if(![entry.expression,entry.spokenForm,...(entry.acceptedForms??[])].includes(marked[1]))throw Error(`Scene occurrence mismatch: ${entry.key}`);
  scene.targetStart=scene.example.indexOf('<b>');
  scene.example=scene.example.replace(/<\/?b>/gu,'');
  scene.targetEnd=scene.targetStart+marked[1].length;
 }
 if(![entry.expression,entry.spokenForm,...(entry.acceptedForms??[])].includes(scene.example.slice(scene.targetStart,scene.targetEnd)))throw Error(`Invalid scene span: ${entry.key}`);
 console.log(`Prepared ${entry.key}`);
}
await mkdir(dirname(resolve(outputPath)),{recursive:true});
await writeFile(outputPath,JSON.stringify(book,null,2)+'\n');
