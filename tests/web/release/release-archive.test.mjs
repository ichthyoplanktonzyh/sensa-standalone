import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {archiveClient,persistSystemRelease,restoreSystemBaseline,downloadArchivedCandidate,restoreCandidateFiles} from '../../../scripts/release/releaseArchive.mjs';
const repository='fixture/sensa',commit='b'.repeat(40),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const env={GITHUB_REPOSITORY:repository,GH_TOKEN:'fixture-private-token'};

async function world(){
  const directory=await mkdtemp(join(tmpdir(),'sensa-archive-test-'));
  const input=join(directory,'input');await mkdir(input);
  const bodies={'apps/web/dist/index.html':'<html>fixture</html>','apps/web/dist/sw.js':'// fixture'};
  const sealed={format:'sensa-release-candidate-v2',commit,provenance:{repository,workflowRunId:'100',workflowRunAttempt:'1'},files:Object.entries(bodies).map(([path,body])=>({path,bytes:Buffer.byteLength(body),sha256:hash(body)}))};
  for(const [path,body] of [...Object.entries(bodies),['release-candidate/manifest.json',json(sealed)]]){const file=join(input,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,body);}
  const zipPath=join(directory,'candidate.zip');execFileSync('zip',['-q','-r',zipPath,'.'],{cwd:input});
  const zip=await readFile(zipPath),releases=[],assets=new Map(),artifactBodies=new Map([[9,zip]]),calls=[];
  const artifacts=new Map([[9,{id:9,name:`sensa-production-${commit}-attempt-1`,digest:'sha256:'+hash(zip),size_in_bytes:zip.length,expired:false,workflow_run:{id:100,head_sha:commit}}]]);
  const runs=[];let id=50,failName=null;
  const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method});
    const parsed=new URL(url),path=parsed.pathname.replace('/repos/'+repository,'');
    if(options.headers.authorization!=='Bearer '+env.GH_TOKEN)throw Error('Fixture credential boundary mismatch');
    if(path.startsWith('/actions/')&&options.headers.accept!=='application/vnd.github+json')return new Response('',{status:415});
    if(path.startsWith('/releases/assets/')&&options.headers.accept!=='application/octet-stream')return new Response('',{status:415});
    if(path.startsWith('/releases/tags/'))return releases.find(release=>release.tag_name===decodeURIComponent(path.slice('/releases/tags/'.length)))?response(releases.find(release=>release.tag_name===decodeURIComponent(path.slice('/releases/tags/'.length)))):new Response('',{status:404});
    if(path==='/releases'&&options.method==='POST'){
      const release={...JSON.parse(options.body),id:++id,assets:[],immutable:false};releases.push(release);return response(release);
    }
    if(path==='/releases')return response(releases);
    if(/^\/releases\/\d+$/.test(path)&&options.method==='PATCH'){
      const release=releases.find(release=>release.id===Number(path.split('/').at(-1)));Object.assign(release,JSON.parse(options.body),{published_at:'2026-10-10T10:01:00.000Z'});return response(release);
    }
    if(/^\/releases\/\d+\/assets$/.test(path)&&options.method==='POST'){
      const name=parsed.searchParams.get('name');if(name===failName)return new Response('',{status:500});
      const value=Buffer.from(options.body),asset={id:++id,name,size:value.length,state:'uploaded',digest:'sha256:'+hash(value)};
      releases.find(release=>release.id===Number(path.split('/')[2])).assets.push(asset);assets.set(asset.id,value);return response(asset);
    }
    if(path.startsWith('/releases/assets/'))return new Response(assets.get(Number(path.split('/').at(-1))));
    if(path==='/actions/workflows/sensa-release.yml/runs')return response({workflow_runs:runs});
    if(/^\/actions\/runs\/\d+$/.test(path))return response(runs.find(run=>run.id===Number(path.split('/').at(-1))));
    if(/^\/actions\/runs\/\d+\/artifacts$/.test(path))return response({artifacts:[...artifacts.values()].filter(artifact=>artifact.workflow_run.id===Number(path.split('/')[3]))});
    if(/^\/actions\/artifacts\/\d+\/zip$/.test(path))return new Response(artifactBodies.get(Number(path.split('/')[3])));
    if(/^\/actions\/artifacts\/\d+$/.test(path))return artifacts.has(Number(path.split('/').at(-1)))?response(artifacts.get(Number(path.split('/').at(-1)))):new Response('',{status:404});
    throw Error('Unexpected fixture request');
  };
  const client=archiveClient(env,fetchImpl);
  const manifest={format:'sensa-system-release-manifest-v2',releaseId:`sensa-system-${commit.slice(0,12)}-123-1`,completedAt:'2026-10-10T10:00:00.000Z',source:{commit},authorization:{outcome:'approved'},decision:{deployApplication:true,applicationMode:'full'},evidence:{repository,workflowRunId:'123',workflowRunAttempt:'1'},components:{application:{sourceCommit:commit,candidate:{workflowRunId:'100',workflowRunAttempt:'1',artifactId:9,artifactName:artifacts.get(9).name,artifactDigest:artifacts.get(9).digest,manifestSha256:hash(json(sealed))},api:{releaseSha:commit},web:{versionId:'11111111-1111-4111-8111-111111111111'}},learningContent:{registry:{revision:'d'.repeat(64)}}}};
  return {directory,client,manifest,sealed,zip,releases,assets,artifacts,artifactBodies,runs,calls,fail:name=>{failName=name;},cleanup:()=>rm(directory,{recursive:true,force:true})};
}

test('native archives retain exact sealed bytes, restore after Actions expiry, and refuse overwrite or retained-file clearing',async()=>{
  const w=await world();try{
    const result=await persistSystemRelease(w.manifest,w.client);
    expect(result.receipt).toMatchObject({platformImmutable:false,applicationCandidateAvailable:true,apiCandidateAvailable:true});
    w.artifacts.get(9).expired=true;
    const again=await persistSystemRelease({...w.manifest,completedAt:'2026-10-10T10:02:00.000Z',evidence:{...w.manifest.evidence,workflowRunAttempt:'2'}},w.client);
    expect(again.manifest).toEqual(result.manifest);
    expect(w.releases).toHaveLength(2);
    const baseline=await restoreSystemBaseline(w.client,{releaseTag:result.manifest.releaseId,runId:'123'});
    expect(baseline).toEqual(result.manifest);
    expect(await downloadArchivedCandidate(baseline.components.application.candidate.archive,w.client)).toEqual(w.zip);
    const target=join(w.directory,'recovery');await restoreCandidateFiles(baseline,w.client,target);
    expect(await readFile(join(target,'apps/web/dist/index.html'),'utf8')).toBe('<html>fixture</html>');
    await expect(restoreCandidateFiles(baseline,w.client,target)).rejects.toThrow();
    expect(await readFile(join(target,'apps/web/dist/index.html'),'utf8')).toBe('<html>fixture</html>');
    await expect(persistSystemRelease({...w.manifest,components:{...w.manifest.components,application:{...w.manifest.components.application,web:{versionId:'different'}}}},w.client)).rejects.toThrow(/overwrite/);
    const checksum=w.releases.find(release=>release.tag_name===baseline.releaseId).assets.find(asset=>asset.name==='system-release-manifest.sha256');
    w.assets.set(checksum.id,Buffer.from('f'.repeat(64)+'\n'));
    await expect(restoreSystemBaseline(w.client,{releaseTag:baseline.releaseId})).rejects.toThrow(/digest mismatch/);
  }finally{await w.cleanup();}
});

test('a partial system archive resumes from already stored candidate bytes without rerunning deployment or depending on an expired Actions ZIP',async()=>{
  const w=await world();try{
    w.fail('system-release-manifest.json');await expect(persistSystemRelease(w.manifest,w.client)).rejects.toThrow(/500/);
    expect(w.releases.find(release=>release.tag_name.startsWith('sensa-application-')).draft).toBe(false);
    w.artifacts.get(9).expired=true;w.fail(null);w.calls.length=0;
    const result=await persistSystemRelease(w.manifest,w.client);
    expect(result.receipt.applicationCandidateAvailable).toBe(true);
    expect(w.calls.some(call=>call.url.includes('/actions/artifacts/'))).toBe(false);
    expect(w.calls.some(call=>/deploy|migration|functions/.test(call.url))).toBe(false);
  }finally{await w.cleanup();}
});

test('newer complete production state survives a failed archive instead of falling back to an older published release',async()=>{
  const w=await world();try{
    const old=(await persistSystemRelease(w.manifest,w.client)).manifest;
    const newer={...old,releaseId:`sensa-system-${'c'.repeat(12)}-999-1`,source:{commit:'c'.repeat(40)},completedAt:'2026-10-10T10:03:00.000Z',evidence:{...old.evidence,workflowRunId:'999'},decision:{deployApplication:false},authorization:{outcome:'no-op'}};delete newer.recovery;
    const input=join(w.directory,'record');await mkdir(input);await writeFile(join(input,'system-release-manifest.json'),json(newer));
    const zipPath=join(w.directory,'record.zip');execFileSync('zip',['-q',zipPath,'system-release-manifest.json'],{cwd:input});const bytes=await readFile(zipPath);
    w.artifacts.set(20,{id:20,name:`sensa-system-release-${'c'.repeat(40)}-999-1`,expired:false,digest:'sha256:'+hash(bytes),size_in_bytes:bytes.length,workflow_run:{id:999}});w.artifactBodies.set(20,bytes);
    w.runs.push({id:999,path:'.github/workflows/sensa-release.yml',head_repository:{full_name:repository},updated_at:'2026-10-10T10:04:00.000Z',conclusion:'failure'});
    expect((await restoreSystemBaseline(w.client)).releaseId).toBe(newer.releaseId);
    w.artifacts.get(20).expired=true;
    await expect(restoreSystemBaseline(w.client,{runId:'999'})).rejects.toThrow(/no recoverable/);
  }finally{await w.cleanup();}
});

test('signed download redirects never receive the GitHub token and arbitrary origins are refused',async()=>{
  const value=Buffer.from('fixture'),calls=[];
  const client=archiveClient(env,async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/fixture?signature=opaque'}}):new Response(value);});
  expect(await client.bytes('/releases/assets/1',{bytes:value.length,sha256:hash(value)})).toEqual(value);
  expect(calls[1].options.headers).toBeUndefined();expect(calls[1].options.redirect).toBe('error');
  const refused=archiveClient(env,async()=>new Response(null,{status:302,headers:{location:'https://evil.example/collect'}}));
  await expect(refused.bytes('/releases/assets/1',{bytes:value.length,sha256:hash(value)})).rejects.toThrow(/outside GitHub/);
});
