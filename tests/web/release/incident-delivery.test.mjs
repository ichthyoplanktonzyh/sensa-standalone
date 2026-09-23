import assert from 'node:assert/strict';
import {reportOperationalIncident} from '../../../scripts/release/reportOperationalIncident.mjs';

let issue=null;const requests=[];
const fetchImpl=async(url,init={})=>{
 requests.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});
 if(url.includes('?state=open'))return Response.json(issue?[issue]:[]);
 if(url.endsWith('/issues')&&init.method==='POST'){issue={number:17,title:JSON.parse(init.body).title};return Response.json(issue,{status:201});}
 if(url.endsWith('/issues/17/comments'))return Response.json({id:1},{status:201});
 if(url.endsWith('/issues/17')&&init.method==='PATCH'){issue=null;return Response.json({number:17,state:'closed'});}
 return Response.json({}, {status:404});
};
const common={repository:'owner/repository',checkName:'Web operational monitor',runId:'12345',release:'a'.repeat(40),token:'fixture',assignee:'owner'};
assert.deepEqual(await reportOperationalIncident({...common,status:'failure'},{fetchImpl,now:()=>new Date('2026-09-21T01:00:00Z')}),{action:'created',number:17});
assert.deepEqual(await reportOperationalIncident({...common,status:'failure',runId:'12346'},{fetchImpl,now:()=>new Date('2026-09-21T02:00:00Z')}),{action:'updated',number:17});
assert.deepEqual(await reportOperationalIncident({...common,status:'success',runId:'12347'},{fetchImpl,now:()=>new Date('2026-09-21T03:00:00Z')}),{action:'resolved',number:17});
const emitted=JSON.stringify(requests);assert(!emitted.includes('learner@example.com'));assert(!emitted.includes('secret-value'));assert(requests.some(request=>request.method==='PATCH'));
console.log('PASS: operational failures create/update one durable GitHub incident and a healthy run records recovery and closes it.');
