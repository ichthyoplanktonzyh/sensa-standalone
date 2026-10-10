/** Configuration-only migration: refuse to change the already-tested application version. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {desiredAuthRedirectConfig} from './supabaseAuthConfig.mjs';
import {candidateArtifactName} from './candidateSource.mjs';

export function domainMigrationBaseline(manifest,environment){
 const desired=desiredAuthRedirectConfig(environment),app=manifest?.components?.application;
 if(desired.siteUrl!=='https://learnsensa.com'||environment.CLOUDFLARE_WORKER_NAME!=='sensa-standalone'||!/^[a-f0-9]{32}$/.test(environment.CLOUDFLARE_ACCOUNT_ID??''))throw Error('Domain migration target mismatch');
 const api=`https://${desired.projectRef}.supabase.co/functions/v1/sensa-api`;
 if(manifest?.format!=='sensa-system-release-manifest-v2'||!/^[a-f0-9]{40}$/.test(app?.sourceCommit??'')||app?.api?.releaseSha!==app.sourceCommit||app?.targets?.apiUrl!==api||environment.VITE_SENSA_API_URL!==api||!/^[a-f0-9-]{36}$/.test(app?.web?.versionId??'')||!/^[a-f0-9]{64}$/.test(app?.candidate?.manifestSha256??'')||!/^[1-9][0-9]*$/.test(app?.candidate?.workflowRunId??'')||!/^[1-9][0-9]*$/.test(app?.candidate?.workflowRunAttempt??''))throw Error('Successful application baseline required');
 const previous=new URL(app.targets.webOrigin);
 if(previous.protocol!=='https:'||previous.origin!==previous.href.replace(/\/$/,''))throw Error('Baseline origin invalid');
 const validationAttempt=app.candidate.validationRunAttempt??app.candidate.workflowRunAttempt;
 if(!/^[1-9][0-9]*$/.test(validationAttempt)||Number(validationAttempt)<Number(app.candidate.workflowRunAttempt))throw Error('Baseline validation attempt invalid');
 if(app.candidate.artifactName!==undefined&&app.candidate.artifactName!==candidateArtifactName(app.sourceCommit,app.candidate.workflowRunAttempt))throw Error('Baseline artifact identity invalid');
 return {format:'sensa-domain-migration-baseline-v1',sourceCommit:app.sourceCommit,webVersionId:app.web.versionId,ciRunId:app.candidate.workflowRunId,ciRunAttempt:app.candidate.workflowRunAttempt,ciValidationAttempt:validationAttempt,candidateArtifactName:app.candidate.artifactName??`sensa-production-${app.sourceCommit}`,candidateManifestSha256:app.candidate.manifestSha256,previousWebOrigin:previous.origin,webOrigin:desired.siteUrl,apiUrl:api};
}

export async function verifyDomainBaseline(baseline,environment,fetchImpl=fetch){
 async function json(url,token){
  const response=await fetchImpl(url,{headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Error(`Baseline verification failed (${response.status})`);
  return response.json();
 }
 if(!environment.GH_TOKEN||!environment.CLOUDFLARE_API_TOKEN||!/^[^/\s]+\/[^/\s]+$/.test(environment.GITHUB_REPOSITORY??''))throw Error('Protected baseline verification credentials required');
 const ci=await json(`https://api.github.com/repos/${environment.GITHUB_REPOSITORY}/actions/runs/${baseline.ciRunId}/attempts/${baseline.ciValidationAttempt}`,environment.GH_TOKEN);
 if(ci.conclusion!=='success'||ci.status!=='completed'||ci.event!=='push'||ci.head_branch!=='main'||ci.head_sha!==baseline.sourceCommit||String(ci.run_attempt)!==baseline.ciValidationAttempt||ci.head_repository?.full_name!==environment.GITHUB_REPOSITORY)throw Error('Baseline must have successful same-repository main CI');
 const deployment=await json(`https://api.cloudflare.com/client/v4/accounts/${environment.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${environment.CLOUDFLARE_WORKER_NAME}/deployments`,environment.CLOUDFLARE_API_TOKEN);
 const versions=deployment.result?.deployments?.[0]?.versions;
 if(!deployment.success||versions?.length!==1||versions[0].version_id!==baseline.webVersionId||versions[0].percentage!==100)throw Error('Live application version differs from the green baseline');
 return baseline;
}

async function main(){
 const manifest=JSON.parse(await readFile(process.env.SENSA_BASELINE_MANIFEST,'utf8'));
 const baseline=domainMigrationBaseline(manifest,process.env);
 await verifyDomainBaseline(baseline,process.env);
 if(process.env.GITHUB_ENV){
  const {appendFile}=await import('node:fs/promises');
  await appendFile(process.env.GITHUB_ENV,`SENSA_BASELINE_APP_SHA=${baseline.sourceCommit}\nSENSA_BASELINE_CI_RUN=${baseline.ciRunId}\nSENSA_BASELINE_CANDIDATE_NAME=${baseline.candidateArtifactName}\n`);
 }
 await mkdir('release-candidate',{recursive:true});
 await writeFile('release-candidate/domain-migration-baseline.json',JSON.stringify(baseline,null,2)+'\n');
 console.log(`Verified unchanged green application ${baseline.sourceCommit} for configuration-only migration.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
