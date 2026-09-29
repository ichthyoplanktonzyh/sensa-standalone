/** Release preparation only: never deploys, migrates, uploads or calls a provider. */
import {readFile,readdir,writeFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export const candidateCsp=()=>`default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://youglish.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https: wss:; frame-src 'self' https://youglish.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
export const candidateRoots=[
 'apps/web/dist',
 'apps/browser-extension/dist',
 'apps/api/dist',
 'packages/contracts/dist',
 'packages/learning-kernel/dist',
 'packages/content-validator/dist',
 'packages/model-runtime/dist',
 'packages/mcp-server/dist',
];
export function validateReleaseEnvironment(env){
 const errors=[];
 const https=name=>{try{const u=new URL(env[name]);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.invalid')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':'))throw Error();return u;}catch{errors.push(`${name}: public HTTPS URL required`);return null;}};
 const support=()=>{try{const u=new URL(env.VITE_SENSA_SUPPORT_URL);if(u.protocol==='mailto:'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(decodeURIComponent(u.pathname)))return u;if(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.hostname!=='localhost'&&!u.hostname.endsWith('.localhost')&&!u.hostname.endsWith('.invalid')&&!/^[\d.]+$/u.test(u.hostname)&&!u.hostname.includes(':'))return u;throw Error();}catch{errors.push('VITE_SENSA_SUPPORT_URL: public HTTPS support form or mailto mailbox required');return null;}};
 const web=https('SENSA_WEB_ORIGIN'),auth=https('VITE_SUPABASE_URL'),api=https('VITE_SENSA_API_URL');
 const supportUrl=support();
 if(web&&web.pathname!=='/')errors.push('SENSA_WEB_ORIGIN: root origin required');
 if(auth&&(auth.pathname!=='/'||!auth.hostname.endsWith('.supabase.co')))errors.push('VITE_SUPABASE_URL: hosted Supabase project origin required');
 if(api&&auth&&(api.origin!==auth.origin||api.pathname.replace(/\/$/,'')!=='/functions/v1/sensa-api'))errors.push('VITE_SENSA_API_URL: must reference this project’s sensa-api function');
 if(env.VITE_SENSA_MODE!=='production')errors.push('VITE_SENSA_MODE: production required');
 const key=env.VITE_SUPABASE_PUBLISHABLE_KEY??'';
 let publicKey=/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
 if(!publicKey)try{const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());publicKey=payload.role==='anon'&&typeof payload.exp==='number'&&payload.exp>Date.now()/1000;}catch{}
 if(!publicKey)errors.push('VITE_SUPABASE_PUBLISHABLE_KEY: publishable/anon key required; never use a secret/service-role key');
 const allowed=new Set(['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_SENSA_API_URL','VITE_SENSA_MODE','VITE_SENSA_SUPPORT_URL']);
 for(const name of Object.keys(env))if(name.startsWith('VITE_')&&!allowed.has(name))errors.push(`${name}: unexpected browser-exposed variable`);
 if(env.SENSA_EXTENSION_WEB_URL!==web?.origin)errors.push('SENSA_EXTENSION_WEB_URL: must match Web origin');
 if(env.SENSA_EXTENSION_API_URL!==env.VITE_SENSA_API_URL)errors.push('SENSA_EXTENSION_API_URL: must match API URL');
 if(!/^[a-f0-9]{40}$/.test(env.SENSA_RELEASE_SHA??''))errors.push('SENSA_RELEASE_SHA: full Git commit required');
 if(errors.length)throw new Error(errors.join('\n'));
 return {webOrigin:web.origin,supabaseOrigin:auth.origin,apiUrl:api.href,supportUrl:supportUrl.href,commit:env.SENSA_RELEASE_SHA};
}
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(resolve(dir,e.name)):[resolve(dir,e.name)]))).flat();}
async function removeSourceMaps(dir){
 for(const path of await files(dir)){
  if(path.endsWith('.map')){await unlink(path);continue;}
  if(!path.endsWith('.js')&&!path.endsWith('.css')&&!path.endsWith('.d.ts'))continue;
  const source=await readFile(path,'utf8');
  const clean=source.replace(/\n?\/\/[#@] sourceMappingURL=.*?(?:\r?\n|$)/gu,'\n').replace(/\/\*# sourceMappingURL=.*?\*\//gu,'');
  if(clean!==source)await writeFile(path,clean);
 }
}
async function databaseMigrationSet(root){
 const directory=resolve(root,'db/migrations');
 const migrations=[];
 for(const path of (await files(directory)).filter(path=>path.endsWith('.sql')).sort()){
  const bytes=await readFile(path);
  migrations.push({path:relative(root,path),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 if(migrations.length===0)throw new Error('Release contains no database migrations');
 return {
  format:'sensa-forward-migration-set-v1',
  count:migrations.length,
  latest:migrations.at(-1).path,
  sha256:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),
  migrations,
 };
}
export async function prepareCandidate(env,root=process.cwd()){
 const config=validateReleaseEnvironment(env);
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(head!==config.commit)throw new Error('Release SHA does not match checked-out HEAD');
 const dist=resolve(root,'apps/web/dist'),extension=resolve(root,'apps/browser-extension/dist');
 await readFile(resolve(dist,'index.html'));await readFile(resolve(dist,'sw.js'));
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
 if(!manifest.host_permissions.includes(new URL(config.apiUrl).origin+'/*')||!manifest.content_scripts.some(s=>s.matches.includes(config.webOrigin+'/*')))throw new Error('Extension does not target release services');
 await writeFile(resolve(dist,'_headers'),`/*\n  Content-Security-Policy: ${candidateCsp()}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), geolocation=()\n/sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/integrations/*\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
 const browserFiles=(await files(resolve(dist,'assets'))).filter(p=>p.endsWith('.js'));
 const browserCode=(await Promise.all(browserFiles.map(p=>readFile(p,'utf8')))).join('\n');
 for(const value of [env.VITE_SUPABASE_URL,env.VITE_SENSA_API_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,env.VITE_SENSA_SUPPORT_URL])if(!browserCode.includes(value))throw new Error('Web bundle does not contain the release configuration; rebuild with the release environment');
 const entries=[];
 for(const rootPath of candidateRoots){
  await removeSourceMaps(resolve(root,rootPath));
  for(const path of (await files(resolve(root,rootPath))).sort()){
  if(path.endsWith('.map')||path.split('/').some(p=>p.startsWith('.env')))throw new Error('Candidate contains source maps or environment files');
  const bytes=await readFile(path);
  // Do not emit matching values: a failed scan must not turn logs into another leak.
  if(/sb_secret_[A-Za-z0-9_-]+/.test(bytes.toString()))throw new Error('Candidate contains a secret key marker');
  entries.push({path:relative(root,path),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
 }
 const database=await databaseMigrationSet(root);
 const report={format:'sensa-release-candidate-v2',...config,createdAt:new Date().toISOString(),scope:'Web, browser extension and compiled API; local-first library with ordinary account cloud sync',promotion:'requires an explicit owner-authorized production workflow for this exact SHA and artifact; user-flow acceptance is deferred until those flows are confirmed',database,files:entries};
 await mkdir(resolve(root,'release-candidate'),{recursive:true});await writeFile(resolve(root,'release-candidate/manifest.json'),JSON.stringify(report,null,2)+'\n');
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.includes('--check')){validateReleaseEnvironment(process.env);console.log('Release configuration validated; no deployment performed.');}else{const r=await prepareCandidate(process.env);console.log(`Prepared ${r.files.length} files for ${r.commit}; deployment still requires explicit owner authorization.`);}}catch(e){console.error(e.message);process.exitCode=1;}
}
