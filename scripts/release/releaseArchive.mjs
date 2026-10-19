/** Native GitHub Releases retain tested bytes beyond Actions artifact expiry.
 * No deploy/rebuild/data access. Writes occur only in the dedicated archive job.
 */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {candidateRoots} from './releaseCandidate.mjs';

const systemTag=/^sensa-system-[a-f0-9]{12}-[1-9][0-9]*-[1-9][0-9]*$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const clone=value=>JSON.parse(JSON.stringify(value));
const sha=/^[a-f0-9]{40}$/;

export function archiveClient(environment,fetchImpl=fetch){
  const repository=environment.GITHUB_REPOSITORY,token=environment.GH_TOKEN;
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??'')||!token)throw Error('Protected GitHub archive identity required');
  const api='https://api.github.com/repos/'+repository;
  async function request(path,{method='GET',body,octets=false,missing=false,upload=false}={}){
    if(!path.startsWith('/')||path.startsWith('//')||path.includes('..'))throw Error('Repository-scoped archive path required');
    const url=(upload?'https://uploads.github.com/repos/'+repository:api)+path;
    const accept=octets&&method==='GET'&&/^\/releases\/assets\/[1-9][0-9]*$/.test(path)?'application/octet-stream':'application/vnd.github+json';
    const response=await fetchImpl(url,{method,headers:{authorization:'Bearer '+token,accept,'x-github-api-version':'2026-03-10',...(body?{'content-type':octets?'application/octet-stream':'application/json'}:{})},...(body?{body:octets?body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(60000)});
    if(missing&&response.status===404)return null;
    if(octets&&method==='GET'&&[301,302,303,307,308].includes(response.status)){
      let signed;try{signed=new URL(response.headers.get('location'));}catch{throw Error('Archive download redirect missing');}
      if(signed.protocol!=='https:'||signed.username||signed.password||!['.githubusercontent.com','.blob.core.windows.net'].some(suffix=>signed.hostname.endsWith(suffix)))throw Error('Archive download redirect outside GitHub storage');
      // Never forward the repository token to a signed storage URL.
      const downloaded=await fetchImpl(signed.href,{redirect:'error',signal:AbortSignal.timeout(60000)});
      if(!downloaded.ok)throw Error('Archive storage download failed ('+downloaded.status+')');
      return Buffer.from(await downloaded.arrayBuffer());
    }
    if(!response.ok)throw Error('GitHub archive request failed ('+response.status+')');
    return octets&&method==='GET'?Buffer.from(await response.arrayBuffer()):response.json();
  }
  async function bytes(path,expected){
    if(!/^[a-f0-9]{64}$/.test(expected.sha256??'')||!Number.isSafeInteger(expected.bytes)||expected.bytes<1||expected.bytes>512*1024*1024)throw Error('Bounded exact archive bytes required');
    const value=await request(path,{octets:true});
    if(value.length!==expected.bytes||digest(value)!==expected.sha256)throw Error('Archive bytes digest mismatch');
    return value;
  }
  async function release(tag,commit){
    const found=await request('/releases/tags/'+encodeURIComponent(tag),{missing:true});
    if(found){if(found.tag_name!==tag||found.target_commitish!==commit)throw Error('Archive release target mismatch');return found;}
    return request('/releases',{method:'POST',body:{tag_name:tag,target_commitish:commit,name:tag,draft:true,prerelease:false,make_latest:'false',body:'Verified Sensa release evidence. Recovery is forward-compatible; database rollback is not implied.'}});
  }
  async function asset(release,name,value){
    const matches=release.assets.filter(asset=>asset.name===name);
    if(matches.length>1)throw Error('Ambiguous release archive asset');
    let item=matches[0];
    if(!item){
      if(!release.draft)throw Error('Published archive is incomplete; refusing to modify it');
      item=await request(`/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,{method:'POST',body:value,octets:true,upload:true});
      release.assets.push(item);
    }
    if(item.state!=='uploaded'||item.size!==value.length)throw Error('Incomplete archive asset');
    const proof={sha256:digest(value),bytes:value.length};
    await bytes(`/releases/assets/${item.id}`,proof);
    return {format:'sensa-github-candidate-archive-v1',releaseTag:release.tag_name,assetId:item.id,assetName:name,...proof};
  }
  async function publish(release){
    const result=release.draft?await request('/releases/'+release.id,{method:'PATCH',body:{draft:false,make_latest:'false'}}):release;
    if(result.draft||result.tag_name!==release.tag_name)throw Error('Archive was not published');
    return result;
  }
  async function releases(){
    const values=[];
    for(let page=1;page<=10;page++){
      const rows=await request(`/releases?per_page=100&page=${page}`);values.push(...rows);
      if(rows.length<100)break;
      if(page===10)throw Error('Release discovery bound exceeded; specify an exact archived tag');
    }
    return values;
  }
  return {repository,request,bytes,release,asset,publish,releases};
}

function validManifest(manifest,repository){
  if(manifest?.format!=='sensa-system-release-manifest-v2'||!systemTag.test(manifest.releaseId??'')||!sha.test(manifest.source?.commit??'')
    ||manifest.evidence?.repository!==repository||!/^[1-9][0-9]*$/.test(manifest.evidence.workflowRunId??'')
    ||!/^[1-9][0-9]*$/.test(manifest.evidence.workflowRunAttempt??'')
    ||manifest.releaseId.split('-')[2]!==manifest.source.commit.slice(0,12)
    ||manifest.releaseId.split('-').at(-2)!==manifest.evidence.workflowRunId
    ||Number(manifest.releaseId.split('-').at(-1))>Number(manifest.evidence.workflowRunAttempt)
    ||!Number.isFinite(Date.parse(manifest.completedAt))||!manifest.components?.application||!manifest.components?.learningContent
    ||!['approved','no-op'].includes(manifest.authorization?.outcome))throw Error('Complete authorized same-repository system manifest required');
  return manifest;
}
function comparable(manifest){
  const value=clone(manifest);delete value.completedAt;delete value.recovery;
  delete value.evidence.workflowRunAttempt;
  delete value.components.application.candidate?.archive;
  delete value.components.application.api?.archive;
  return JSON.stringify(value);
}
async function withZip(bytes,work){
  const directory=await mkdtemp(join(tmpdir(),'sensa-archive-proof-'));
  try{
    const path=join(directory,'candidate.zip');await writeFile(path,bytes);
    const names=execFileSync('unzip',['-Z1',path],{encoding:'utf8',maxBuffer:4*1024*1024}).trim().split('\n');
    const counts=new Map();for(const name of names)counts.set(name,(counts.get(name)??0)+1);
    return await work((name,maximumBytes=4*1024*1024)=>{
      if(counts.get(name)!==1)throw Error('Exact archive member required');
      return execFileSync('unzip',['-p',path,name],{maxBuffer:maximumBytes});
    });
  }finally{await rm(directory,{recursive:true,force:true});}
}
const zipMember=(bytes,name)=>withZip(bytes,read=>read(name));

export async function persistSystemRelease(input,client){
  validManifest(input,client.repository);
  const manifest=clone(input),app=manifest.components.application;
  const existing=await client.request('/releases/tags/'+encodeURIComponent(manifest.releaseId),{missing:true});
  const existingManifest=existing?.assets?.find(asset=>asset.name==='system-release-manifest.json');
  if(existingManifest){
    const checksum=existing.assets.find(asset=>asset.name==='system-release-manifest.sha256');
    if(!checksum&&!existing.draft)throw Error('Published release checksum is missing');
    const raw=await client.request('/releases/assets/'+existingManifest.id,{octets:true});
    const saved=validManifest(JSON.parse(raw.toString()),client.repository);
    if(comparable(saved)!==comparable(manifest))throw Error('Refusing to overwrite different system release evidence');
    // Preserve the first exact receipt on a partial archive retry, not a new timestamp/attempt.
    Object.assign(manifest,saved);
  }
  if(manifest.decision.deployApplication&&!manifest.components.application.candidate.archive){
    const candidate=app.candidate;
    if(!Number.isSafeInteger(candidate.artifactId)||!/^[a-f0-9]{64}$/.test(candidate.manifestSha256??'')||!/^sha256:[a-f0-9]{64}$/.test(candidate.artifactDigest??''))throw Error('Exact CI candidate metadata required for durable recovery');
    const tag=`sensa-application-${app.sourceCommit}-${candidate.workflowRunId}-${candidate.workflowRunAttempt}`;
    const prior=await client.request('/releases/tags/'+encodeURIComponent(tag),{missing:true});
    if(prior&&prior.target_commitish!==app.sourceCommit)throw Error('Candidate archive target mismatch');
    const savedZip=prior?.assets?.find(asset=>asset.name==='candidate.zip'&&asset.state==='uploaded');
    let zip;
    if(savedZip)zip=await client.bytes('/releases/assets/'+savedZip.id,{bytes:savedZip.size,sha256:candidate.artifactDigest.slice(7)});
    else{
      const artifact=await client.request('/actions/artifacts/'+candidate.artifactId);
      if(artifact.expired||artifact.name!==candidate.artifactName||artifact.digest!==candidate.artifactDigest||artifact.workflow_run?.id!==Number(candidate.workflowRunId)||artifact.workflow_run?.head_sha!==app.sourceCommit)throw Error('Archived candidate source no longer matches CI');
      zip=await client.bytes(`/actions/artifacts/${candidate.artifactId}/zip`,{bytes:artifact.size_in_bytes,sha256:candidate.artifactDigest.slice(7)});
    }
    const candidateRaw=await zipMember(zip,'release-candidate/manifest.json');
    const sealed=JSON.parse(candidateRaw.toString());
    if(digest(candidateRaw)!==candidate.manifestSha256||sealed.commit!==app.sourceCommit||sealed.provenance?.repository!==client.repository||sealed.provenance.workflowRunId!==candidate.workflowRunId||sealed.provenance.workflowRunAttempt!==candidate.workflowRunAttempt)throw Error('Candidate ZIP does not contain the recorded seal');
    const release=await client.release(tag,app.sourceCommit);
    const archive=await client.asset(release,'candidate.zip',zip);
    await client.asset(release,'candidate-manifest.json',candidateRaw);
    await client.publish(release);
    manifest.components.application.candidate.archive=archive;
    if(manifest.decision.applicationMode==='full')manifest.components.application.api.archive=clone(archive);
  }
  manifest.recovery={format:'sensa-system-recovery-archive-v1',releaseTag:manifest.releaseId,applicationCandidateAvailable:!!manifest.components.application.candidate?.archive,apiCandidateAvailable:!!manifest.components.application.api?.archive};
  const release=await client.release(manifest.releaseId,manifest.source.commit);
  const raw=jsonBytes(manifest);
  await client.asset(release,'system-release-manifest.json',raw);
  await client.asset(release,'system-release-manifest.sha256',Buffer.from(digest(raw)+'\n'));
  const published=await client.publish(release);
  return {manifest,receipt:{format:'sensa-native-release-archive-v1',releaseTag:manifest.releaseId,manifestSha256:digest(raw),githubReleaseId:published.id,platformImmutable:published.immutable===true,applicationCandidateAvailable:manifest.recovery.applicationCandidateAvailable,apiCandidateAvailable:manifest.recovery.apiCandidateAvailable}};
}

export async function readArchivedSystem(release,client){
  if(release.draft||!systemTag.test(release.tag_name??''))throw Error('Published exact system archive required');
  const rawAsset=release.assets.find(asset=>asset.name==='system-release-manifest.json');
  const checksum=release.assets.find(asset=>asset.name==='system-release-manifest.sha256');
  if(!rawAsset||!checksum||checksum.size!==65||rawAsset.size>4*1024*1024)throw Error('System archive assets incomplete');
  const checksumBytes=await client.request('/releases/assets/'+checksum.id,{octets:true});
  const expected=checksumBytes.toString().trim();
  const raw=await client.bytes('/releases/assets/'+rawAsset.id,{bytes:rawAsset.size,sha256:expected});
  const manifest=validManifest(JSON.parse(raw.toString()),client.repository);
  if(manifest.releaseId!==release.tag_name||manifest.source.commit!==release.target_commitish||manifest.recovery?.releaseTag!==release.tag_name)throw Error('System archive lineage mismatch');
  return manifest;
}

export async function restoreSystemBaseline(client,{runId,releaseTag}={}){
  let selected=null;
  if(releaseTag){
    if(!systemTag.test(releaseTag))throw Error('Exact system archive tag required');
    selected=await readArchivedSystem(await client.request('/releases/tags/'+encodeURIComponent(releaseTag)),client);
    if(runId&&selected.evidence.workflowRunId!==runId)throw Error('Archive does not belong to the selected system run');
    return selected;
  }
  const published=(await client.releases()).filter(release=>!release.draft&&systemTag.test(release.tag_name)&&(!runId||release.tag_name.split('-').at(-2)===runId)).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at));
  for(const release of published){
    const manifest=await readArchivedSystem(release,client);
    if(!runId||manifest.evidence.workflowRunId===runId){selected=manifest;break;}
  }
  // A verified release whose archive failed must remain the baseline. The next
  // run must not silently roll its state back to an older published archive.
  const runs=runId?[await client.request('/actions/runs/'+runId)]:[];
  if(!runId)for(let page=1;page<=10;page++){
    const result=await client.request(`/actions/workflows/sensa-release.yml/runs?per_page=20${page===1?'':'&page='+page}`);
    if(!Array.isArray(result.workflow_runs))throw Error('Invalid system run listing');
    runs.push(...result.workflow_runs);
    // Runs are ordered by creation, not last rerun; an old run may have a newer record.
    if(result.workflow_runs.length<20)break;
    if(page===10)throw Error('System baseline lookup exhausted; select an exact verified system archive tag');
  }
  for(const run of runs??[]){
    if(run.path!=='.github/workflows/sensa-release.yml'||run.head_repository?.full_name!==client.repository)throw Error('System baseline run belongs to a different workflow or repository');
    if(selected&&Date.parse(run.updated_at)<=Date.parse(selected.completedAt))continue;
    const listing=await client.request(`/actions/runs/${run.id}/artifacts?per_page=100`);
    if(!Array.isArray(listing.artifacts)||listing.artifacts.length>=100)throw Error('System artifact lookup saturated; select an exact verified archive tag');
    const artifacts=listing.artifacts
      .filter(artifact=>!artifact.expired&&artifact.name.startsWith('sensa-system-release-')).sort((a,b)=>b.id-a.id);
    for(const artifact of artifacts){
      if(!/^sha256:[a-f0-9]{64}$/.test(artifact.digest??''))throw Error('System artifact checksum unavailable');
      const zip=await client.bytes(`/actions/artifacts/${artifact.id}/zip`,{bytes:artifact.size_in_bytes,sha256:artifact.digest.slice(7)});
      const raw=await zipMember(zip,'system-release-manifest.json');
      const manifest=validManifest(JSON.parse(raw.toString()),client.repository);
      assertSystemArtifactIdentity(artifact,manifest,run);
      if(!selected||Date.parse(manifest.completedAt)>Date.parse(selected.completedAt))selected=manifest;
      break;
    }
  }
  if(runId&&!selected)throw Error('Selected system baseline has no recoverable complete manifest');
  return selected;
}

export function assertSystemArtifactIdentity(artifact,manifest,run){
  const exact=artifact.name===`sensa-system-release-${manifest.source.commit}-${run.id}-${manifest.evidence.workflowRunAttempt}`;
  // Before attempt-scoped names, the workflow emitted one SHA-only record.
  // Accept it only for a completed first-attempt main run of that exact SHA;
  // reruns and new plan-provenance records must use the current exact identity.
  const legacy=artifact.name===`sensa-system-release-${manifest.source.commit}`
    &&run.run_attempt===1&&manifest.evidence.workflowRunAttempt==='1'
    &&manifest.evidence.planWorkflowRunAttempt===undefined
    &&run.head_sha===manifest.source.commit&&run.head_branch==='main'
    &&run.status==='completed'&&run.conclusion==='success'
    &&artifact.workflow_run?.id===run.id&&artifact.workflow_run?.head_sha===run.head_sha;
  if(manifest.evidence.workflowRunId!==String(run.id)||!exact&&!legacy)throw Error('System artifact run/attempt identity mismatch');
}

export async function downloadArchivedCandidate(archive,client){
  if(archive?.format!=='sensa-github-candidate-archive-v1'||!/^sensa-application-[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*$/.test(archive.releaseTag??'')||archive.assetName!=='candidate.zip'||!Number.isSafeInteger(archive.assetId))throw Error('Exact candidate recovery reference required');
  const release=await client.request('/releases/tags/'+encodeURIComponent(archive.releaseTag));
  const asset=release.assets.find(asset=>asset.id===archive.assetId&&asset.name===archive.assetName);
  if(release.draft||release.tag_name!==archive.releaseTag||release.target_commitish!==archive.releaseTag.split('-')[2]||!asset||asset.state!=='uploaded'||asset.size!==archive.bytes)throw Error('Candidate recovery asset not published or mismatched');
  return client.bytes('/releases/assets/'+archive.assetId,archive);
}

/** Read only explicitly sealed members; never extract ZIP paths or symlinks. */
export async function restoreCandidateFiles(baseline,client,directory){
  validManifest(baseline,client.repository);
  const component=baseline.components.application;
  const zip=await downloadArchivedCandidate(component.candidate.archive,client);
  const raw=await zipMember(zip,'release-candidate/manifest.json');
  const manifest=JSON.parse(raw.toString());
  if(digest(raw)!==component.candidate.manifestSha256||manifest.commit!==component.sourceCommit||manifest.provenance?.repository!==client.repository||manifest.provenance.workflowRunId!==component.candidate.workflowRunId||manifest.provenance.workflowRunAttempt!==component.candidate.workflowRunAttempt)throw Error('Recovery seal differs from the selected baseline');
  const entries=manifest.files;
  if(!entries?.length||new Set(entries.map(file=>file.path)).size!==entries.length||entries.some(file=>file.path.includes('..')||!candidateRoots.some(root=>file.path.startsWith(root+'/'))||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256)))throw Error('Unsafe or incomplete recovery manifest');
  await withZip(zip,async read=>{
    // Refuse to overwrite retained recovery files, including an existing empty directory.
    await mkdir(dirname(directory),{recursive:true});await mkdir(directory);
    for(const file of entries){
      const value=read(file.path,Math.max(1,file.bytes)+1);
      if(value.length!==file.bytes||digest(value)!==file.sha256)throw Error('Recovery member digest mismatch');
      const path=resolve(directory,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});
    }
    const path=resolve(directory,'release-candidate/manifest.json');await mkdir(dirname(path),{recursive:true});await writeFile(path,raw,{flag:'wx'});
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const command=process.argv[2],client=archiveClient(process.env);
    await mkdir('release-candidate',{recursive:true});
    if(command==='persist'){
      const input=JSON.parse(await readFile('.tmp/system-release-record/system-release-manifest.json','utf8'));
      const result=await persistSystemRelease(input,client);
      await writeFile('release-candidate/system-release-manifest.json',jsonBytes(result.manifest));
      await writeFile('release-candidate/native-release-archive.json',jsonBytes(result.receipt));
      console.log('Published verified native release archive; platform immutability: '+result.receipt.platformImmutable+'.');
    }else if(command==='baseline'){
      const result=await restoreSystemBaseline(client,{runId:process.env.SENSA_BASELINE_RUN,releaseTag:process.env.SENSA_BASELINE_RELEASE_TAG});
      if(result){
        const path='.tmp/previous-system-release/system-release-manifest.json';await mkdir('.tmp/previous-system-release',{recursive:true});await writeFile(path,jsonBytes(result));
        if(process.env.GITHUB_ENV){const {appendFile}=await import('node:fs/promises');await appendFile(process.env.GITHUB_ENV,`SENSA_PREVIOUS_RELEASE_MANIFEST=${path}\nSENSA_BASELINE_MANIFEST=${path}\n`);}
        console.log('Restored verified system baseline '+result.releaseId+'.');
      }else console.log('No complete system baseline exists; an explicitly authorized full bootstrap is required.');
    }else if(command==='candidate'){
      const baseline=JSON.parse(await readFile(process.env.SENSA_BASELINE_MANIFEST,'utf8'));
      await restoreCandidateFiles(baseline,client,resolve('.tmp/domain-baseline-candidate'));
      console.log('Restored exact sealed candidate members; digest verified, no ZIP path extraction.');
    }else throw Error('Expected persist, baseline or candidate');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
