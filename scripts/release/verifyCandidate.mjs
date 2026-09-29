import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {candidateRoots} from './releaseCandidate.mjs';
const report=JSON.parse(await readFile('release-candidate/manifest.json','utf8'));
let supabaseOrigin;try{supabaseOrigin=new URL(process.env.VITE_SUPABASE_URL).origin;}catch{throw Error('Candidate Supabase target missing');}
if(report.format!=='sensa-release-candidate-v2'||report.commit!==process.env.SENSA_RELEASE_SHA||report.webOrigin!==process.env.SENSA_WEB_ORIGIN||report.supabaseOrigin!==supabaseOrigin||report.apiUrl!==process.env.VITE_SENSA_API_URL||report.supportUrl!==process.env.VITE_SENSA_SUPPORT_URL)throw Error('Candidate identity or target mismatch');
for(const file of report.files){
 if(typeof file.path!=='string'||!candidateRoots.some(root=>file.path.startsWith(root+'/'))||file.path.includes('..'))throw Error('Invalid artifact path');
 const bytes=await readFile(resolve(file.path));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Candidate integrity check failed');
}
if(!report.files.some(f=>f.path==='apps/web/dist/index.html')||!report.files.some(f=>f.path==='apps/web/dist/sw.js'))throw Error('Incomplete candidate');
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(dir+'/'+e.name):dir+'/'+e.name))).flat();}
const actual=(await Promise.all(candidateRoots.map(files))).flat().sort();
if(JSON.stringify(actual)!==JSON.stringify(report.files.map(f=>f.path).sort()))throw Error('Candidate has unlisted or missing files');
const migrations=(await files('db/migrations')).filter(path=>path.endsWith('.sql')).sort();
if(report.database?.format!=='sensa-forward-migration-set-v1'||report.database.count!==migrations.length||report.database.latest!==migrations.at(-1)||JSON.stringify(report.database.migrations?.map(row=>row.path))!==JSON.stringify(migrations))throw Error('Candidate database migration identity mismatch');
for(const migration of report.database.migrations){const bytes=await readFile(resolve(migration.path));if(bytes.length!==migration.bytes||createHash('sha256').update(bytes).digest('hex')!==migration.sha256)throw Error('Candidate database migration integrity check failed');}
if(createHash('sha256').update(JSON.stringify(report.database.migrations)).digest('hex')!==report.database.sha256)throw Error('Candidate database migration set digest failed');
console.log('Candidate SHA, target and file digests verified.');
