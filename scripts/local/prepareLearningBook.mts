/** Explicit operator media preparation. Ordinary dev startup never calls TTS. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareLearningResourceFacts} from '../../apps/api/src/sensa/resources/supplements.ts';
import {edgeSpeechProvider} from './speechProvider.mts';
import {createAuthoredMediaPackager} from '../release/authoredMedia.mts';
const sourcePath=process.argv[2],outputPath=process.argv[3];
if(!sourcePath||!outputPath)throw Error('Usage: prepareLearningBook.mts SOURCE OUTPUT [--allow-tts]');
const book=JSON.parse(await readFile(sourcePath,'utf8'));
const provider=edgeSpeechProvider(process.argv.includes('--allow-tts'));
const mediaRoot=resolve(process.env.SENSA_AUTHORED_MEDIA_ROOT??'content/data/media');
const packager=await createAuthoredMediaPackager({mediaRoot});
for(const entry of book.entries){
 const sound=await provider({surface:entry.spokenForm??entry.expression,languageTag:book.targetLanguage},AbortSignal.timeout(45000));
 const {surface,languageTag,audioUrl,...pronunciation}=sound;
 const encoded=audioUrl.match(/^data:audio\/mpeg;base64,([A-Za-z0-9+/]+={0,2})$/u)?.[1];
 if(!encoded)throw Error(`Expected MP3 pronunciation: ${entry.key}`);
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded)throw Error(`Noncanonical pronunciation bytes: ${entry.key}`);
 const audio={sha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'audio/mpeg' as const};
 await mkdir(join(mediaRoot,'audio'),{recursive:true});
 await writeFile(join(mediaRoot,'audio',`${audio.sha256}.mp3`),bytes,{flag:'wx'}).catch(cause=>{
  if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;
 });
 // Reuse the release gate for type, size and digest checks, including cache hits.
 await packager.embed(audio,`${entry.key}:pronunciation`);
 entry.pronunciation={...pronunciation,audio};
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
