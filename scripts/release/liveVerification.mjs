/** Read-only deployment proof. Never invokes a model, writes data or promotes a version. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const fullSha = /^[a-f0-9]{40}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function hasVerifiedApplicationBaseline(app){
  const proof=app?.verification;
  return proof?.format==='sensa-application-live-verification-v1'
    && proof.trafficPercentage===100 && fullSha.test(app.api?.releaseSha??'')
    && proof.apiCommit===app.api.releaseSha && proof.webVersionId===app.web?.versionId
    && proof.webOrigin===app.targets?.webOrigin && proof.apiUrl===app.targets?.apiUrl
    && proof.candidateManifestSha256===app.candidate?.manifestSha256
    && /^[a-f0-9]{64}$/.test(proof.candidateManifestSha256??'')
    && Number.isInteger(proof.verifiedFileCount)&&proof.verifiedFileCount>=2;
}
export function verificationFiles(candidate) {
  const files = candidate.files?.filter(file => /^apps\/web\/dist\/(?:index\.html|sw\.js|(?:assets|integrations)\/[^?\s]+\.(?:js|css|wasm|html))$/.test(file.path));
  if (!files?.some(file => file.path === 'apps/web/dist/index.html') || !files.some(file => file.path === 'apps/web/dist/sw.js')
    || new Set(files.map(file => file.path)).size !== files.length
    || files.some(file => file.path.includes('..') || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)) {
    throw Error('Sealed public Web files required');
  }
  return files;
}

export function assertApplicationExecution(plan,candidate,environment) {
  if (plan?.format !== 'sensa-system-release-plan-v2' || plan.source?.commit !== candidate?.commit
    || !fullSha.test(candidate?.commit ?? '') || !plan.decision?.deployApplication
    || !['full','web-only'].includes(plan.decision.applicationMode) || plan.authorization?.outcome !== 'approved') throw Error('Authorized exact application execution plan required');
  for (const [field,key] of [['webOrigin','SENSA_WEB_ORIGIN'],['apiUrl','VITE_SENSA_API_URL'],['supabaseOrigin','VITE_SUPABASE_URL'],['supportUrl','VITE_SENSA_SUPPORT_URL']]) {
    if (candidate[field] !== environment[key]) throw Error('Execution target differs from the sealed candidate');
  }
  const previous = plan.previousRelease?.components.application;
  if (plan.decision.applicationMode === 'web-only') {
    const changes=plan.source.changes?.filter(change=>change.impact!=='operational');
    if (!hasVerifiedApplicationBaseline(previous)||plan.request?.scope!=='auto'||!changes?.length||changes.some(change=>!change.path.startsWith('apps/web/'))
      || candidate.database?.sha256 !== previous.database?.migrationSetSha256
      || ['webOrigin','apiUrl','supabaseOrigin','supportUrl'].some(key => candidate[key] !== previous.targets?.[key])) throw Error('Web-only execution would change an unverified backend, migration or target');
  }
  verificationFiles(candidate);
  return {mode: plan.decision.applicationMode, apiCommit: plan.decision.applicationMode === 'web-only' ? previous.api.releaseSha : candidate.commit};
}

export async function verifyPublicFiles(candidate,origin,fetchImpl=fetch) {
  const target = new URL(origin);
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw Error('Public verification origin required');
  const files = verificationFiles(candidate);
  // Bounded parallelism; the hash is of decoded response bytes, like the sealed files.
  for (let start=0;start<files.length;start+=4) await Promise.all(files.slice(start,start+4).map(async file => {
    let url = new URL(file.path.slice('apps/web/dist/'.length),target);
    url.searchParams.set('__sensa_release',candidate.commit);
    const signal=AbortSignal.timeout(20000);
    let response;
    // Cloudflare canonicalizes index.html to /. Follow only bounded same-origin
    // asset redirects; the original sealed file's bytes and hash remain required.
    for(let redirects=0;;redirects++){
      response=await fetchImpl(url.href,{headers:{'cache-control':'no-cache'},redirect:'manual',signal});
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('location');
      await response.body?.cancel();
      if(!location||redirects>=3)throw Error('Public candidate redirect is missing or exceeds its bound');
      const next=new URL(location,url);
      if(next.origin!==target.origin||next.protocol!=='https:'||next.username||next.password||next.hash)throw Error('Public candidate redirect leaves its approved origin');
      url=next;
    }
    if (!response.ok) throw Error(`Public candidate file unavailable (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw Error('Public file bytes differ from the sealed candidate: ' + file.path);
  }));
  return {verifiedFileCount:files.length,verifiedFileSetSha256:hash(JSON.stringify(files))};
}

export async function verifyApiIdentity(apiUrl,commit,fetchImpl=fetch) {
  if (!fullSha.test(commit ?? '')) throw Error('Expected API build identity required');
  const url = new URL(apiUrl.replace(/\/$/,'') + '/sensa/release');
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.supabase.co') || url.search || url.hash) throw Error('Hosted API identity target required');
  const response = await fetchImpl(url.href,{headers:{'cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw Error(`API build identity unavailable (${response.status})`);
  const identity = await response.json();
  if (identity.format !== 'sensa-api-release-v1' || identity.commit !== commit) throw Error('Actual API build identity differs from the intended deployment');
  return commit;
}

export async function verifyTraffic(versionId,environment,fetchImpl=fetch) {
  if (!/^[a-f0-9-]{36}$/.test(versionId ?? '') || !/^[a-f0-9]{32}$/.test(environment.CLOUDFLARE_ACCOUNT_ID ?? '')
    || environment.CLOUDFLARE_WORKER_NAME !== 'sensa-standalone' || !environment.CLOUDFLARE_API_TOKEN) throw Error('Approved Cloudflare version and protected read credentials required');
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${environment.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${environment.CLOUDFLARE_WORKER_NAME}/deployments`,{
    headers:{authorization:'Bearer ' + environment.CLOUDFLARE_API_TOKEN,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error(`Cloudflare deployment read failed (${response.status})`);
  const deployment = await response.json();
  const current = deployment.result?.deployments?.[0];
  if (!deployment.success || current?.versions?.length !== 1 || current.versions[0].version_id !== versionId
    || current.versions[0].percentage !== 100) throw Error('Actual Cloudflare traffic does not match the intended 100% version');
  return {webVersionId:versionId,trafficPercentage:100,deploymentId:current.id};
}

export async function preflightApplication(plan,candidate,environment,fetchImpl=fetch) {
  const execution = assertApplicationExecution(plan,candidate,environment);
  if (execution.mode === 'web-only') {
    await verifyTraffic(plan.previousRelease.components.application.web.versionId,environment,fetchImpl);
    await verifyApiIdentity(candidate.apiUrl,execution.apiCommit,fetchImpl);
  }
  return execution;
}

export async function verifyLiveApplication(plan,candidate,version,environment,fetchImpl=fetch) {
  const execution = assertApplicationExecution(plan,candidate,environment);
  if (version?.format !== 'sensa-cloudflare-version-v1' || version.releaseSha !== candidate.commit) throw Error('Uploaded version evidence required');
  const files = await verifyPublicFiles(candidate,candidate.webOrigin,fetchImpl);
  const apiCommit = await verifyApiIdentity(candidate.apiUrl,execution.apiCommit,fetchImpl);
  const traffic = await verifyTraffic(version.versionId,environment,fetchImpl);
  return {format:'sensa-application-live-verification-v1',observedAt:new Date().toISOString(),commit:candidate.commit,
    candidateManifestSha256:hash(`${JSON.stringify(candidate,null,2)}\n`),webOrigin:candidate.webOrigin,apiUrl:candidate.apiUrl,apiCommit,...files,...traffic};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const candidate = JSON.parse(await readFile('release-candidate/manifest.json','utf8'));
    const plan = JSON.parse(await readFile('.tmp/application-release-plan/system-release-plan.json','utf8'));
    const command = process.argv[2];
    if (command === 'preflight') await preflightApplication(plan,candidate,process.env);
    else if (command === 'preview') await verifyPublicFiles(candidate,process.env.SENSA_PREVIEW_URL);
    else if (command === 'live') {
      const version = JSON.parse(await readFile('release-candidate/cloudflare-version.json','utf8'));
      const report = await verifyLiveApplication(plan,candidate,version,process.env);
      await mkdir('release-candidate',{recursive:true});
      await writeFile('release-candidate/application-live-verification.json',JSON.stringify(report,null,2)+'\n');
    } else throw Error('Expected preflight, preview or live');
    console.log('Verified application ' + command + ' without changing production or calling a model.');
  } catch (error) {console.error(error.message);process.exitCode=1;}
}
