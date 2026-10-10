/** Local, immutable copies of selected evidence. No verdicts, network or credential transport. */
import {constants} from 'node:fs';
import {copyFile,chmod,lstat,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {basename,dirname,isAbsolute,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const archiveBase='output/playwright/evidence-archives';
const format='sensa-journey-evidence-archive-v1';
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const forbidden=(path:string)=>path.split('/').some(part=>/^(?:profile(?:[-_].*)?|profiles|node_modules|Default|OptimizationGuideModelsManifest|extensions_crx_cache|component_crx_cache)$/i.test(part))
 || /^(?:\.env(?:\..*)?|.*(?:credentials|mailbox|auth-message|storage-state|storageState|cookies|login-link).*\.json)$/i.test(basename(path));

function safeRelative(path:string):void{
 if(!path||isAbsolute(path)||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Expected a normalized repository-relative path');
}
function sourcePath(path:string):void{
 safeRelative(path);
 if(!/^(?:\.tmp|output\/playwright)\//.test(path)||path.startsWith(archiveBase+'/')||forbidden(path))throw Error('Source is outside the evidence boundary or is a credential/profile file');
}
function outputPath(path:string):void{
 safeRelative(path);
 if(!new RegExp(`^${archiveBase}/[a-z0-9][a-z0-9_-]{0,95}$`).test(path))throw Error('Use a new named directory under '+archiveBase);
}
async function regularFile(root:string,path:string):Promise<string>{
 const absolute=resolve(root,path);
 if(!(await lstat(absolute)).isFile()||await realpath(absolute)!==absolute)throw Error('Evidence must be a regular file without symlink traversal');
 return absolute;
}

export async function discoverJourneyEvidence(repoRoot:string):Promise<string[]>{
 const selected:string[]=[];
 const walk=async(path:string)=>{
  for(const entry of await readdir(resolve(repoRoot,path),{withFileTypes:true})){
   const child=path+'/'+entry.name;
   if(forbidden(child)||entry.isSymbolicLink())continue;
   if(entry.isDirectory())await walk(child);
   else if(entry.isFile())selected.push(child);
  }
 };
 for(const entry of await readdir(resolve(repoRoot,'output/playwright'),{withFileTypes:true})){
  if(entry.isDirectory()&&/^(?:lj\d{2}[-_]|uat-lj\d{2}[-_]|sensa-first-book-review|manual-meaning-root-|ui_personal_audit$|journey-|auth-pilot|auth-smtp-real-|learnsensa-|release-fix-)/.test(entry.name))await walk('output/playwright/'+entry.name);
 }
 for(const entry of await readdir(resolve(repoRoot,'.tmp'),{withFileTypes:true})){
  const path='.tmp/'+entry.name;
  if(forbidden(path))continue;
  if(entry.isFile()&&/^lj\d{2}-.*\.log$/.test(entry.name))selected.push(path);
  else if(entry.isFile()&&/^lj\d{2}-.*(?:native|benchmark|performance|scale|capacity|encoding|persistent|validation).*\.json$/.test(entry.name))selected.push(path);
  else if(entry.isFile()&&/^release-fix-(?:public-proof\.json|public-.*\.log|browser-shard\d\.log|final-check\.log)$/.test(entry.name))selected.push(path);
  else if(entry.isDirectory()&&/^(?:user-journey-audit|portable-book-capacity-evidence|release-fix-(?:candidate|system-manifest|plan|advisory-performance)|journey-integrated-production-release)$/.test(entry.name))await walk(path);
 }
 return [...new Set(selected)].sort();
}

type ArchiveEntry={source:string;archived:string;bytes:number;sha256:string;journeyHints:string[]};
type ArchiveManifest={format:string;createdAt:string;inventoryGitCommit:string|null;contentRedacted:false;meaning:string;entries:ArchiveEntry[]};

export async function archiveJourneyEvidence(repoRoot:string,sources:readonly string[],output:string,inventoryGitCommit:string|null=null):Promise<ArchiveManifest>{
 const root=await realpath(repoRoot);
 outputPath(output);
 if(!sources.length||new Set(sources).size!==sources.length)throw Error('Select nonempty, unique evidence files');
 if(inventoryGitCommit!==null&&!/^[a-f0-9]{40}$/.test(inventoryGitCommit))throw Error('Invalid inventory commit');
 for(const source of sources){sourcePath(source);await regularFile(root,source);}
 const base=resolve(root,archiveBase);
 await mkdir(base,{recursive:true,mode:0o700});
 if(await realpath(base)!==base)throw Error('Archive base must not traverse a symlink');
 const destination=resolve(root,output);
 await mkdir(destination,{mode:0o700}); // Existing archives are never replaced.
 const entries:ArchiveEntry[]=[];
 for(const source of [...sources].sort()){
  const original=await readFile(await regularFile(root,source));
  const archived='files/'+source;
  const target=resolve(destination,archived);
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  await copyFile(resolve(root,source),target,constants.COPYFILE_EXCL);
  await chmod(target,0o600);
  const copied=await readFile(target);
  if(!original.equals(copied))throw Error('Source changed while copying; incomplete archive has no manifest');
  const matches=[...source.matchAll(/(?:^|[\/_-])lj[-_]?(\d{2})(?=[\/_-]|$)/gi)];
  entries.push({source,archived,bytes:copied.length,sha256:digest(copied),journeyHints:[...new Set(matches.map(match=>'LJ-'+match[1]))]});
 }
 const manifest:ArchiveManifest={format,createdAt:new Date().toISOString(),inventoryGitCommit,contentRedacted:false,
  meaning:'Copies preserve original bytes. Journey hints come only from paths. Inventory commit is not the tested commit. No journey or test pass is inferred.',entries};
 await writeFile(resolve(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}

export async function verifyJourneyEvidence(repoRoot:string,manifestPath:string):Promise<{files:number;bytes:number}>{
 const root=await realpath(repoRoot);
 safeRelative(manifestPath);
 const archive=dirname(manifestPath);
 outputPath(archive);
 if(basename(manifestPath)!=='manifest.json')throw Error('Archive manifest required');
 const value=JSON.parse(await readFile(await regularFile(root,manifestPath),'utf8')) as ArchiveManifest;
 if(value.format!==format||value.contentRedacted!==false||!Array.isArray(value.entries)||!value.entries.length)throw Error('Invalid archive manifest');
 const seen=new Set<string>();
 let bytes=0;
 for(const entry of value.entries){
  sourcePath(entry.source);
  if(entry.archived!=='files/'+entry.source||seen.has(entry.source)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid archive entry');
  seen.add(entry.source);
  const actual=await readFile(await regularFile(root,archive+'/'+entry.archived));
  if(actual.length!==entry.bytes||digest(actual)!==entry.sha256)throw Error('Archive bytes or digest mismatch');
  bytes+=actual.length;
 }
 return {files:seen.size,bytes};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const options=new Map<string,string>();
 for(const arg of process.argv.slice(2)){
  const match=arg.match(/^--(discover|sources|output|verify)(?:=(.*))?$/);
  if(!match||options.has(match[1]!)||match[1]==='discover'&&match[2]!==undefined||match[1]!=='discover'&&!match[2])throw Error('Expected --discover or --sources=JSON with --output=DIR, or --verify=MANIFEST');
  options.set(match[1]!,match[2]??'true');
 }
 if(options.has('verify')){
  if(options.size!==1)throw Error('Verify cannot be combined with archive options');
  console.log(JSON.stringify(await verifyJourneyEvidence(process.cwd(),options.get('verify')!)));
 }else{
  if(!options.has('output')||options.has('sources')===options.has('discover'))throw Error('Choose one source selector and a new output directory');
  const sources=options.has('discover')?await discoverJourneyEvidence(process.cwd()):JSON.parse(await readFile(options.get('sources')!,'utf8'));
  if(!Array.isArray(sources)||!sources.every(path=>typeof path==='string'))throw Error('Sources JSON must contain an array of relative file paths');
  const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const manifest=await archiveJourneyEvidence(process.cwd(),sources,options.get('output')!,commit);
  const result=await verifyJourneyEvidence(process.cwd(),options.get('output')!+'/manifest.json');
  console.log(JSON.stringify({archive:options.get('output'),...result,contentRedacted:manifest.contentRedacted}));
 }
}
