import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const report=JSON.parse(await readFile('release-candidate/manifest.json','utf8'));
if(report.format!=='sensa-web-candidate-v1'||report.commit!==process.env.SENSA_RELEASE_SHA||report.webOrigin!==process.env.SENSA_WEB_ORIGIN||report.apiUrl!==process.env.VITE_SENSA_API_URL)throw Error('Candidate identity or target mismatch');
if(!report.catalogSha256||createHash('sha256').update(await readFile('release-candidate/catalog.json')).digest('hex')!==report.catalogSha256)throw Error('Missing or altered release catalog');
for(const file of report.files){
 if(typeof file.path!=='string'||!/^apps\/(web|browser-extension)\/dist\//.test(file.path)||file.path.includes('..'))throw Error('Invalid artifact path');
 const bytes=await readFile(resolve(file.path));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Candidate integrity check failed');
}
if(!report.files.some(f=>f.path==='apps/web/dist/index.html')||!report.files.some(f=>f.path==='apps/web/dist/sw.js'))throw Error('Incomplete candidate');
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(dir+'/'+e.name):dir+'/'+e.name))).flat();}
const actual=(await Promise.all(['apps/web/dist','apps/browser-extension/dist'].map(files))).flat().sort();
if(JSON.stringify(actual)!==JSON.stringify(report.files.map(f=>f.path).sort()))throw Error('Candidate has unlisted or missing files');
console.log('Candidate SHA, target and file digests verified.');
