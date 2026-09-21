import {pathToFileURL} from 'node:url';

const headers=(token)=>({
  accept:'application/vnd.github+json',
  authorization:`Bearer ${token}`,
  'content-type':'application/json',
  'user-agent':'sensa-operational-monitor',
  'x-github-api-version':'2022-11-28',
});

async function github(fetchImpl,url,token,init={}){
  const response=await fetchImpl(url,{...init,headers:{...headers(token),...init.headers}});
  if(!response.ok)throw new Error(`github_incident_delivery_${response.status}`);
  return response.status===204?null:response.json();
}

/** Create/update one durable incident per check and close it after a healthy run. */
export async function reportOperationalIncident(input,{fetchImpl=fetch,now=()=>new Date()}={}){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.repository))throw new Error('invalid_repository');
  if(!/^[A-Za-z0-9_. -]{1,80}$/u.test(input.checkName))throw new Error('invalid_check_name');
  if(!/^[0-9]+$/u.test(input.runId)||!['success','failure'].includes(input.status)||!/^(?:unknown|[a-f0-9]{40})$/u.test(input.release)||!input.token)throw new Error('invalid_incident_input');
  const api=`https://api.github.com/repos/${input.repository}`,title=`[Sensa incident] ${input.checkName}`;
  const issues=await github(fetchImpl,`${api}/issues?state=open&per_page=100`,input.token);
  const existing=issues.find(issue=>issue.title===title&&!issue.pull_request);
  const runUrl=`https://github.com/${input.repository}/actions/runs/${input.runId}`;
  const timestamp=now().toISOString();
  if(input.status==='failure'){
    const note=`Automated operational check failed at ${timestamp}.\n\nRun: ${runUrl}\nRelease: \`${input.release}\`\n\nNo user payload, email, token, user-provided URL, or database row is included. Follow the support and recovery runbook before changing production data.`;
    if(existing){await github(fetchImpl,`${api}/issues/${existing.number}/comments`,input.token,{method:'POST',body:JSON.stringify({body:note})});return {action:'updated',number:existing.number};}
    const assignee=/^[A-Za-z0-9-]{1,39}$/u.test(input.assignee??'')?[input.assignee]:undefined;
    const created=await github(fetchImpl,`${api}/issues`,input.token,{method:'POST',body:JSON.stringify({title,body:note,...(assignee?{assignees:assignee}:{})})});
    return {action:'created',number:created.number};
  }
  if(!existing)return {action:'none'};
  await github(fetchImpl,`${api}/issues/${existing.number}/comments`,input.token,{method:'POST',body:JSON.stringify({body:`Automated check recovered at ${timestamp}.\n\nRun: ${runUrl}\nRelease: \`${input.release}\``})});
  await github(fetchImpl,`${api}/issues/${existing.number}`,input.token,{method:'PATCH',body:JSON.stringify({state:'closed',state_reason:'completed'})});
  return {action:'resolved',number:existing.number};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  reportOperationalIncident({
    repository:process.env.GITHUB_REPOSITORY??'',
    checkName:process.env.SENSA_INCIDENT_CHECK??'',
    status:process.env.SENSA_CHECK_STATUS??'',
    runId:process.env.GITHUB_RUN_ID??'',
    release:process.env.GITHUB_SHA??'unknown',
    assignee:process.env.SENSA_INCIDENT_ASSIGNEE,
    token:process.env.GITHUB_TOKEN??'',
  }).then(result=>console.log(`Operational incident delivery: ${result.action}.`)).catch(error=>{console.error(error instanceof Error?error.message:'incident_delivery_failed');process.exitCode=1;});
}
