import {test, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {releasePreflight, preflightTargets, assertDatabaseTarget} from '../../../scripts/release/releasePreflight.mjs';
import {compareMigrationLedger, assertMigrationCompatibility, readMigrationLedger} from '../../../scripts/release/migrationLedger.mjs';
import {contentCandidate} from '../../../scripts/release/contentCandidate.mjs';
import {applicationReleaseStatus, contentReleaseStatus, mergeApplicationPhases, systemReleaseStatus} from '../../../scripts/release/releaseStatus.mjs';
import {promoteWebVersion} from '../../../scripts/release/promoteWebVersion.mjs';
import {verifyContentPromotion} from '../../../scripts/release/verifyContentPromotion.mjs';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';

const hash = value => createHash('sha256').update(value).digest('hex');
const commit='b'.repeat(40), project='a'.repeat(20), secret='fixture-never-log-this-secret';
const env={SENSA_RELEASE_SHA:commit,GITHUB_REPOSITORY:'fixture/sensa',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',
 SUPABASE_PROJECT_REF:project,VITE_SUPABASE_URL:`https://${project}.supabase.co`,SENSA_WEB_ORIGIN:'https://sensa.example',
 VITE_SENSA_API_URL:`https://${project}.supabase.co/functions/v1/sensa-api`,SENSA_APPLICATION_MODE:'full',
 SUPABASE_ACCESS_TOKEN:secret,SUPABASE_SECRET_KEY:secret,CLOUDFLARE_API_TOKEN:secret,CLOUDFLARE_ACCOUNT_ID:'1'.repeat(32),CLOUDFLARE_WORKER_NAME:'sensa-standalone',
 MIGRATION_DATABASE_URL:`postgresql://postgres:fixture@db.${project}.supabase.co/postgres?sslmode=verify-full`,
 SENSA_RUNTIME_DATABASE_URL:`postgresql://backend_app:fixture@db.${project}.supabase.co/postgres?sslmode=verify-full`,DEEPSEEK_API_KEY:secret,SENSA_PROVIDER_VAULT_KEY:'c'.repeat(64),SENSA_MEDIA_PACK_SHA256:'d'.repeat(64)};
const plan={releaseId:`sensa-system-${commit.slice(0,12)}-123-1`,source:{commit},authorization:{outcome:'approved'},
 decision:{deployApplication:true,publishLearningContent:true},inputs:{learningContent:{sha256:env.SENSA_MEDIA_PACK_SHA256}}};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const inspectDatabaseImpl=async(_url,files,runtime)=>runtime?{restrictedRole:true}:{ledgerExists:true,appliedCount:files.length,pending:[]};
const fetchReady=async url=>json(url.includes('api.cloudflare.com')?{success:true,result:{deployments:[]}}
 :url.endsWith('/secrets')?[]:url.endsWith('/config/auth')?{}:url.endsWith('/sensa/packages?bookPreview=1')?{revision:'e'.repeat(64)}
 :url.includes('/storage/v1/bucket/')?{id:'sensa-learning-content',public:true,allowed_mime_types:['application/json','application/zip']}
 :{ref:project,status:'ACTIVE_HEALTHY'});

test('preflight uses only GET/read-only DB inspection, stops on a named failure and never retains credentials or provider bodies',async()=>{
 const calls=[],db=[];
 const result=await releasePreflight({component:'application',environment:env,plan,
  fetchImpl:async(url,init)=>{calls.push({url,init});return fetchReady(url);},
  inspectDatabaseImpl:async(...args)=>{db.push(args);return inspectDatabaseImpl(...args);},validateRegistryImpl:()=>{}});
 expect(result.status).toBe('ready');expect(calls.every(call=>call.init.method==='GET'&&call.init.redirect==='error')).toBe(true);
 expect(db).toHaveLength(2);expect(db[0][1].length).toBeGreaterThan(0);expect(db[1][2]).toBe(true);
 expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify(result)).not.toContain('postgresql:');
 const failed=await releasePreflight({component:'application',environment:env,plan,
  fetchImpl:async()=>new Response(secret,{status:403}),inspectDatabaseImpl:()=>{throw Error('must not reach database');}});
 expect(failed).toMatchObject({status:'failed',failure:{check:'supabase-management-access'}});
 expect(JSON.stringify(failed)).not.toContain(secret);
 const missing=await releasePreflight({component:'application',environment:{...env,SENSA_RUNTIME_DATABASE_URL:''},plan,fetchImpl:()=>{throw Error('must not call providers');}});
 expect(missing).toMatchObject({status:'failed',failure:{check:'configuration'}});
});

test('target, credential encoding and content-only application boundary reject drift before provider calls',async()=>{
 expect(()=>preflightTargets({...env,VITE_SUPABASE_URL:'https://other.supabase.co'},'application')).toThrow();
 expect(()=>preflightTargets({...env,DEEPSEEK_API_KEY:"bad'encoding"},'application')).toThrow();
 for(const url of [`postgresql://postgres:fixture@attacker.invalid/postgres?sslmode=require`,env.MIGRATION_DATABASE_URL.replace('verify-full','disable')])expect(()=>assertDatabaseTarget(url,project)).toThrow();
 const contentPlan={...plan,decision:{...plan.decision,deployApplication:false},previousRelease:{components:{application:{targets:{supabaseOrigin:env.VITE_SUPABASE_URL,webOrigin:'https://wrong.example'}}}}};
 const report=await releasePreflight({component:'content',environment:env,plan:contentPlan,fetchImpl:()=>{throw Error('must not call providers');}});
 expect(report).toMatchObject({status:'failed',failure:{check:'configuration'}});
 const ready=await releasePreflight({component:'content',environment:env,plan,fetchImpl:fetchReady});expect(ready.status).toBe('ready');
 const webOnly={...env,SENSA_APPLICATION_MODE:'web-only'};delete webOnly.SUPABASE_ACCESS_TOKEN;
 expect(()=>preflightTargets(webOnly,'application')).not.toThrow();
});

test('migration ledger rejects holes, duplicates and unknown files; successful baseline source bytes cannot be rewritten',async()=>{
 const files=['0001_one.sql','0002_two.sql','0003_three.sql'];
 expect(compareMigrationLedger(files,files.slice(0,2))).toMatchObject({appliedCount:2,pending:[files[2]]});
 for(const applied of [[files[1]],[files[0],files[0]],['9999_unknown.sql']])expect(()=>compareMigrationLedger(files,applied)).toThrow();
 await expect(readMigrationLedger({query:async sql=>({rows:sql.includes('to_regclass')?[{ledger:null}]:[{count:1}]})},files)).rejects.toThrow('nonempty application database');
 const rows=files.map((path,index)=>({path:'db/migrations/'+path,bytes:index+1,sha256:'a'.repeat(64)}));
 const baseline={migrationCount:2,latestMigration:rows[1].path,migrationSetSha256:hash(JSON.stringify(rows.slice(0,2)))};
 expect(assertMigrationCompatibility({migrations:rows},baseline).baseline).toBe('source-prefix-verified');
 expect(()=>assertMigrationCompatibility({migrations:[{...rows[0],sha256:'f'.repeat(64)},...rows.slice(1)]},baseline)).toThrow();
 expect(()=>assertMigrationCompatibility({migrations:rows.slice(0,1)},baseline)).toThrow();
});

test('content retries restore original build attempt, plan, target and exact files rather than rebuilding',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sensa-release-content-contract-'));
 try {
  const files={'.tmp/learning-content/releases/book.sensa-book':'sealed-book','release-candidate/portable-catalog.json':JSON.stringify({revision:'e'.repeat(64)}),
   '.tmp/system-release-plan/system-release-plan.json':JSON.stringify(plan),...Object.fromEntries(['contracts','learning-kernel','content-validator','model-runtime'].map(name=>[`packages/${name}/dist/index.js`,'sealed-module']))};
  for(const [path,bytes]of Object.entries(files)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);}
  await contentCandidate('seal',env,root);
  await expect(contentCandidate('verify',{...env,GITHUB_RUN_ATTEMPT:'2',SENSA_CONTENT_BUILD_ATTEMPT:'1'},root)).resolves.toMatchObject({buildAttempt:'1',releaseId:plan.releaseId});
  await expect(contentCandidate('verify',{...env,GITHUB_RUN_ATTEMPT:'2'},root)).rejects.toThrow();
  await expect(contentCandidate('verify',{...env,SUPABASE_PROJECT_REF:'z'.repeat(20)},root)).rejects.toThrow();
  await writeFile(join(root,'.tmp/learning-content/releases/book.sensa-book'),'different');await expect(contentCandidate('verify',env,root)).rejects.toThrow();
  await writeFile(join(root,'.tmp/learning-content/releases/book.sensa-book'),'sealed-book');
  await writeFile(join(root,'.tmp/learning-content/releases/.hidden'),'unsealed');await expect(contentCandidate('verify',env,root)).rejects.toThrow('hidden');
  await rm(join(root,'.tmp/learning-content/releases/.hidden'));
  await symlink('/etc/hosts',join(root,'.tmp/learning-content/releases/extra'));await expect(contentCandidate('verify',env,root)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});

test('native job resume combines original successful phase attempts and rejects another run; content upload is never promotion proof',()=>{
 const identity={commit,runId:'123',mode:'full'};
 const backend=applicationReleaseStatus({...identity,attempt:'1',stage:'backend',steps:Object.fromEntries(['preflight','migrations','auth_config','service_config','api_deploy'].map(phase=>[phase,{outcome:'success'}]))});
 const upload=applicationReleaseStatus({...identity,attempt:'2',stage:'web-upload',steps:{web_version:{outcome:'success'}}});
 const merged=mergeApplicationPhases([backend,upload],{...identity,attempt:'3'});
 expect(merged.phaseSources).toEqual([{stage:'backend',executionAttempt:'1'},{stage:'web-upload',executionAttempt:'2'}]);
 expect(()=>mergeApplicationPhases([{...backend,workflowRunId:'999'},upload],{...identity,attempt:'3'})).toThrow();
 expect(contentReleaseStatus({...identity,attempt:'3',steps:{upload:{outcome:'success'},promote:{outcome:'failure'}}})).toMatchObject({status:'partial-or-unverified',productionMayHaveChanged:true,failedPhases:['promote']});
 expect(systemReleaseStatus(plan,{preflight:'failure',application:'skipped',learning_content:'skipped',record:'skipped'}).status).toBe('incomplete');
});

test('promotion retry skips the already active exact version and refuses unreadable traffic before writing',async()=>{
 const version={format:'sensa-cloudflare-version-v1',releaseSha:commit,versionId:'11111111-1111-4111-8111-111111111111'};
 let writes=0;
 const traffic=percentage=>async()=>json({success:true,result:{deployments:[{versions:[{version_id:version.versionId,percentage}]}]}});
 expect(await promoteWebVersion(version,env,traffic(100),()=>writes++)).toEqual({alreadyPromoted:true});expect(writes).toBe(0);
 expect(await promoteWebVersion(version,env,traffic(50),()=>writes++)).toEqual({alreadyPromoted:false});expect(writes).toBe(1);
 await expect(promoteWebVersion(version,env,async()=>new Response('',{status:403}),()=>writes++)).rejects.toThrow();expect(writes).toBe(1);
});

test('public content verification requires canonical snapshot bytes, not only revision and item count',async()=>{
 const snapshot={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-19T00:00:00.000Z',items:[]},catalog={...snapshot,revision:hash(canonicalConsumerJson(snapshot))};
 await expect(verifyContentPromotion(catalog,project,async()=>json(catalog))).resolves.toMatchObject({verified:true});
 await expect(verifyContentPromotion(catalog,project,async()=>json({...catalog,revision:'f'.repeat(64)}))).rejects.toThrow();
 const otherSnapshot={...snapshot,publishedAt:'2026-10-18T00:00:00.000Z'},other={...otherSnapshot,revision:hash(canonicalConsumerJson(otherSnapshot))};
 await expect(verifyContentPromotion(catalog,project,async()=>json(other),{requireMatch:false})).resolves.toMatchObject({verified:false});
});

test('all production writers depend on preflight; retries keep exact artifact IDs and retired owner entry cannot bypass CI',async()=>{
 const read=path=>readFile(path,'utf8'),workflow=await read('.github/workflows/sensa-release.yml');
 expect(workflow).toContain('needs: [plan, preflight]');expect(workflow).toContain('needs: [plan, preflight, application]');
 expect(workflow.match(/needs\.preflight\.result == 'success'/g)).toHaveLength(2);
 expect(workflow).toContain('artifact-ids: ${{ needs.plan.outputs.plan_artifact_id }}');
 expect(workflow).toContain('Do not rerun a successful plan or rerun all jobs.');
 const preparation=await read('.github/workflows/sensa-release-preflight.yml');
 expect(preparation).toContain('npm run build:shared');expect(preparation).toContain('node scripts/release/contentCandidate.mjs seal');
 expect(preparation).toContain('artifact-ids: ${{ needs.application.outputs.receipt_id }},${{ needs.content.outputs.receipt_id }}');
 expect(preparation).not.toContain('pattern:');
 const app=await read('.github/workflows/sensa-web-deploy.yml');
 expect(app).toContain('needs: [backend, upload]');expect(app.match(/wrangler versions upload/g)).toHaveLength(1);
 expect(app).toContain('node scripts/release/promoteWebVersion.mjs');
 const content=await read('.github/workflows/sensa-learning-content-publish.yml');
 expect(content).not.toContain('npm run build');expect(content).toContain('artifact-ids: ${{ inputs.content_artifact_id }}');
 expect(content).toContain('SENSA_CONTENT_BUILD_ATTEMPT: ${{ inputs.content_build_attempt }}');
 expect(content).toContain('node scripts/release/verifyContentPromotion.mjs');
 await expect(read('.github/workflows/sensa-owner-deploy-8957424f.yml')).rejects.toThrow();
 const exception=JSON.parse(await read('docs/release-exceptions/2026-10-18-8957424f.json'));
 expect(exception).toMatchObject({ciPassed:false,ciGateWaived:true,standardGreenCiSystemManifestCreated:false});
});
