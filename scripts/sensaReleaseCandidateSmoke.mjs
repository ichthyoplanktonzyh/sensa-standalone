import assert from 'node:assert/strict';
import {validateReleaseEnvironment,prepareCandidate} from './release/webCandidate.mjs';
const env={SENSA_WEB_ORIGIN:'https://learn.example.com',VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SENSA_API_URL:'https://fixture.supabase.co/functions/v1/sensa-api',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),VITE_SENSA_MODE:'production',SENSA_EXTENSION_WEB_URL:'https://learn.example.com',SENSA_EXTENSION_API_URL:'https://fixture.supabase.co/functions/v1/sensa-api',SENSA_RELEASE_SHA:'a'.repeat(40)};
assert.equal(validateReleaseEnvironment(env).webOrigin,env.SENSA_WEB_ORIGIN);
for(const change of [{SENSA_WEB_ORIGIN:'http://127.0.0.1:3000'},{VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_never-print-this'},{VITE_DEEPSEEK_API_KEY:'never-print-this'},{VITE_SENSA_MODE:'legacy-account'},{SENSA_EXTENSION_LEGACY_WEB:'1'},{SENSA_EXTENSION_API_URL:'http://localhost:4319'},{VITE_SENSA_API_URL:'https://another.supabase.co/functions/v1/sensa-api'},{SENSA_RELEASE_SHA:'main'}]){
 assert.throws(()=>validateReleaseEnvironment({...env,...change}),e=>!e.message.includes('never-print-this'));
}
const serviceJwt='e30.'+Buffer.from(JSON.stringify({role:'service_role',exp:9999999999})).toString('base64url')+'.signature';
assert.throws(()=>validateReleaseEnvironment({...env,VITE_SUPABASE_PUBLISHABLE_KEY:serviceJwt}));
console.log('PASS: release config rejects loopback, secret/service keys, unexpected VITE variables, wrong project/extension, legacy mode and floating revisions without logging values.');

const {mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises');
const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
const root=await mkdtemp(join(tmpdir(),'sensa-candidate-'));
try{
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture'],{cwd:root});
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const web=join(root,'apps/web/dist'),extension=join(root,'apps/browser-extension/dist');await mkdir(join(web,'assets'),{recursive:true});await mkdir(extension,{recursive:true});
 await writeFile(join(web,'index.html'),'<html></html>');await writeFile(join(web,'sw.js'),'// fixture');
 await writeFile(join(web,'assets/app.js'),JSON.stringify([env.VITE_SUPABASE_URL,env.VITE_SENSA_API_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY]));
 await writeFile(join(extension,'manifest.json'),JSON.stringify({host_permissions:['https://fixture.supabase.co/*'],content_scripts:[{matches:[env.SENSA_WEB_ORIGIN+'/*']}]}));
 const releaseEnv={...env,SENSA_RELEASE_SHA:sha};const candidate=await prepareCandidate(releaseEnv,root);
 assert.equal(candidate.commit,sha);assert(candidate.files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));
 assert(!(await readFile(join(root,'release-candidate/manifest.json'),'utf8')).includes(env.VITE_SUPABASE_PUBLISHABLE_KEY));
 await assert.rejects(prepareCandidate(env,root),/HEAD/);
 await writeFile(join(web,'assets/app.js'),'// stale local build');await assert.rejects(prepareCandidate(releaseEnv,root),/rebuild/);
 console.log('PASS: isolated candidate manifest, hashes, secret-free report and stale SHA/build rejection; no deployment.');
}finally{await rm(root,{recursive:true,force:true});}
