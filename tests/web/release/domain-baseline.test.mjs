import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {domainMigrationBaseline,verifyDomainBaseline} from '../../../scripts/release/domainBaseline.mjs';
const env={SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',SENSA_WEB_ORIGIN:'https://learnsensa.com',VITE_SENSA_API_URL:'https://abcdefghijklmnopqrst.supabase.co/functions/v1/sensa-api',CLOUDFLARE_ACCOUNT_ID:'c'.repeat(32),CLOUDFLARE_WORKER_NAME:'sensa-standalone',GITHUB_REPOSITORY:'fixture/sensa',GH_TOKEN:'fixture',CLOUDFLARE_API_TOKEN:'fixture'};
const manifest={format:'sensa-system-release-manifest-v2',components:{application:{sourceCommit:'a'.repeat(40),api:{releaseSha:'a'.repeat(40)},web:{versionId:'11111111-1111-4111-8111-111111111111'},candidate:{workflowRunId:'12',workflowRunAttempt:'1',manifestSha256:'b'.repeat(64)},targets:{webOrigin:'https://old.example.com',apiUrl:env.VITE_SENSA_API_URL}}}};
test('configuration migration retains the green application identity and rejects target drift',()=>{
 const baseline=domainMigrationBaseline(manifest,env);
 expect(baseline.sourceCommit).toBe(manifest.components.application.sourceCommit);
 expect(baseline.webOrigin).toBe('https://learnsensa.com');
 for(const change of [{SENSA_WEB_ORIGIN:'https://other.example.com'},{VITE_SENSA_API_URL:'https://wrong.supabase.co/functions/v1/sensa-api'},{CLOUDFLARE_WORKER_NAME:'other'}])expect(()=>domainMigrationBaseline(manifest,{...env,...change})).toThrow();
 expect(()=>domainMigrationBaseline({...manifest,format:'unapproved'},env)).toThrow();
});
test('baseline preflight requires green main CI and the exact live Cloudflare version',async()=>{
 const baseline=domainMigrationBaseline(manifest,env);
 let ci={conclusion:'success',status:'completed',event:'push',head_branch:'main',head_sha:baseline.sourceCommit,run_attempt:1,head_repository:{full_name:env.GITHUB_REPOSITORY}};
 let version=baseline.webVersionId;
 const fetchImpl=async url=>new Response(JSON.stringify(url.startsWith('https://api.github.com/')?ci:{success:true,result:{deployments:[{versions:[{version_id:version,percentage:100}]}]}}));
 await expect(verifyDomainBaseline(baseline,env,fetchImpl)).resolves.toEqual(baseline);
 ci={...ci,conclusion:'failure'};await expect(verifyDomainBaseline(baseline,env,fetchImpl)).rejects.toThrow(/successful/);
 ci={...ci,conclusion:'success',head_branch:'feature'};await expect(verifyDomainBaseline(baseline,env,fetchImpl)).rejects.toThrow(/successful/);
 ci={...ci,head_branch:'main'};version='different';await expect(verifyDomainBaseline(baseline,env,fetchImpl)).rejects.toThrow(/Live application/);
});
test('configuration workflow cannot deploy new app code, migrate data or change other service secrets',async()=>{
 const workflow=await readFile(new URL('../../../.github/workflows/sensa-web-domain.yml',import.meta.url),'utf8');
 expect(workflow).toMatch(/group: sensa-production/);
 expect(workflow).toMatch(/wrangler triggers deploy/);
 expect(workflow).toMatch(/ALLOWED_ORIGINS=\$SENSA_WEB_ORIGIN/);
 expect(workflow).not.toMatch(/versions (upload|deploy)|functions deploy|db:migrate|npm run build\s*$/m);
 expect(workflow).toMatch(/git diff --exit-code/);
 expect(workflow.indexOf('name: Refuse application source drift')).toBeLessThan(workflow.indexOf('name: Change only API origin'));
 expect(workflow).toMatch(/Baseline contracts digest mismatch/);
});
