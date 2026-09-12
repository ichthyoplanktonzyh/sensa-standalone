const env=process.env;
const releaseSha=env.SENSA_RELEASE_SHA??'';
const candidateRunId=env.CANDIDATE_RUN_ID??'';
const acceptanceRunId=env.ACCEPTANCE_RUN_ID??'';
if(!/^[a-f0-9]{40}$/.test(releaseSha)||!/^\d+$/.test(candidateRunId)||!/^\d+$/.test(acceptanceRunId))throw Error('Full release SHA and numeric candidate/acceptance run IDs are required');
if(env.CLOUDFLARE_WORKER_NAME!=='sensa-standalone')throw Error('Cloudflare Worker target mismatch');
if(!/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF??'')||!new URL(env.VITE_SENSA_API_URL).hostname.startsWith(env.SUPABASE_PROJECT_REF+'.'))throw Error('Supabase target mismatch');

async function verifyRun(id,path,label){
 const response=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/runs/${id}`,{headers:{authorization:`Bearer ${env.GH_TOKEN}`,accept:'application/vnd.github+json'}});
 if(!response.ok)throw Error(`Cannot verify ${label} run`);
 const run=await response.json();
 if(run.head_sha!==releaseSha||run.conclusion!=='success'||run.path!==path)throw Error(`${label} run was not successful for the release SHA`);
}

await Promise.all([
 verifyRun(candidateRunId,'.github/workflows/sensa-web-candidate.yml','Candidate'),
 verifyRun(acceptanceRunId,'.github/workflows/sensa-release-acceptance.yml','Release acceptance'),
]);
console.log('Candidate and release acceptance provenance verified for the same commit.');
