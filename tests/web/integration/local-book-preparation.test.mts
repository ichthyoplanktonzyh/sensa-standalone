import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'vitest';
import {createAuthoredMediaPackager} from '../../../scripts/release/authoredMedia.mts';

test('local Book preparation produces strict, reusable media references without external TTS',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sensa-local-book-preparation-'));
 try{
  const source=join(root,'source.json'),output=join(root,'prepared.json');
  const speech=join(root,'speech-fixture.mjs'),mediaRoot=join(root,'media');
  const bytes=Buffer.from([0xff,0xfb,0x90,0x64,0,0,0,0]);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const book=JSON.parse(await readFile(resolve('content/preview/lightweight-resources-v7.json'),'utf8'));
  book.entries=book.entries.slice(0,1);
  await writeFile(source,JSON.stringify(book));
  await writeFile(speech,`#!${process.execPath}\nlet input='';for await(const chunk of process.stdin)input+=chunk;const request=JSON.parse(input);console.log(JSON.stringify({surface:request.surface,languageTag:request.languageTag,audioUrl:'data:audio/mpeg;base64,${bytes.toString('base64')}',phoneticNotation:null,accentLabel:null,method:'tts',source:'synthetic local speech adapter'}));`,{mode:0o700});
  const prepare=()=>spawnSync(process.execPath,['--import','tsx',resolve('scripts/local/prepareLearningBook.mts'),source,output],{
   cwd:resolve('.'),encoding:'utf8',env:{...process.env,SENSA_TTS_PYTHON:speech,SENSA_AUTHORED_MEDIA_ROOT:mediaRoot},
  });
  for(let attempt=0;attempt<2;attempt++){
   const result=prepare();
   assert.equal(result.status,0,result.stderr||result.stdout);
   const prepared=JSON.parse(await readFile(output,'utf8'));
   assert.deepEqual(prepared.publisher,book.publisher);
   assert.deepEqual(prepared.entries[0].pronunciation.audio,{sha256,mimeType:'audio/mpeg'});
   assert.equal(prepared.entries[0].pronunciation.audioUrl,undefined);
   const packager=await createAuthoredMediaPackager({mediaRoot});
   assert.equal(await packager.embed(prepared.entries[0].pronunciation.audio,'local Book'),'data:audio/mpeg;base64,'+bytes.toString('base64'));
  }
  // A corrupt cache must fail, rather than being silently replaced on retry.
  await mkdir(join(mediaRoot,'audio'),{recursive:true});
  await writeFile(join(mediaRoot,'audio',`${sha256}.mp3`),Buffer.from([0xff,0xfb,1]));
  const rejected=prepare();
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/digest mismatch/u);
  assert.deepEqual(await readFile(join(mediaRoot,'audio',`${sha256}.mp3`)),Buffer.from([0xff,0xfb,1]));
 }finally{await rm(root,{recursive:true,force:true});}
});
