/** Explicit production publication for immutable public learning content.
 * Uploads every Book release, verifies public bytes, uploads the immutable
 * Registry snapshot last, then writes a one-line env candidate for promotion.
 * It never changes the active API Registry pointer itself. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {learningContentRegistrySchema} from '@sensa/contracts/sensa';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const required=name=>{const value=process.env[name]?.trim();if(!value)throw Error(`${name} is required`);return value;};
const safeSegment=(value,name)=>{if(!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(value))throw Error(`${name} is invalid`);return value;};
const fetchBytes=async url=>{
 const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Published learning content is not readable');
 return Buffer.from(await response.arrayBuffer());
};

if(process.env.SENSA_CONTENT_PUBLISH!=='true')throw Error('Set SENSA_CONTENT_PUBLISH=true only in the authorized content publication environment');
const supabaseUrl=new URL(required('SUPABASE_URL')),projectRef=required('SUPABASE_PROJECT_REF');
if(supabaseUrl.protocol!=='https:'||supabaseUrl.hostname!==`${projectRef}.supabase.co`||!/^[a-z0-9]{20}$/u.test(projectRef))throw Error('Supabase publication target mismatch');
const secret=required('SUPABASE_SECRET_KEY'),bucket=safeSegment(process.env.SENSA_PACKAGE_BUCKET?.trim()||'sensa-learning-content','SENSA_PACKAGE_BUCKET');
const packageRoot=resolve(process.env.SENSA_PACKAGE_OUTPUT??'.tmp/learning-content/releases'),catalogPath=resolve(process.env.SENSA_PACKAGE_CATALOG??'release-candidate/catalog.json'),registryBytes=await readFile(catalogPath),registry=learningContentRegistrySchema.parse(JSON.parse(registryBytes.toString('utf8')));
const {revision,...registrySnapshot}=registry;
if(sha256(Buffer.from(JSON.stringify(registrySnapshot)))!==revision)throw Error('Learning content Registry revision does not match its canonical snapshot');
const client=createClient(supabaseUrl.href,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
let bucketResult=await client.storage.getBucket(bucket);
if(bucketResult.error){
 const created=await client.storage.createBucket(bucket,{public:true,allowedMimeTypes:['application/json'],fileSizeLimit:64*1024*1024});
 if(created.error)throw Error('Learning content bucket is unavailable');
 bucketResult=await client.storage.getBucket(bucket);
}
if(bucketResult.error||!bucketResult.data?.public)throw Error('Learning content bucket must be public');

const storage=client.storage.from(bucket);
async function publishObject(path,bytes){
 const publicUrl=storage.getPublicUrl(path).data.publicUrl;
 const uploaded=await storage.upload(path,bytes,{cacheControl:'31536000',contentType:'application/json',upsert:false});
 if(uploaded.error){
  const existing=await fetchBytes(publicUrl);
  if(sha256(existing)!==sha256(bytes))throw Error('An immutable learning content path already has different bytes');
  return publicUrl;
 }
 const delivered=await fetchBytes(publicUrl);
 if(sha256(delivered)!==sha256(bytes))throw Error('Uploaded learning content failed public digest verification');
 return publicUrl;
}

for(const descriptor of registry.items){
 const relative=`${descriptor.book.bookId}/${descriptor.book.bookVersionId}/${descriptor.sha256}.json`,bytes=await readFile(resolve(packageRoot,relative));
 if(bytes.length!==descriptor.byteLength||sha256(bytes)!==descriptor.sha256)throw Error('Book release bytes do not match the Registry descriptor');
 const url=await publishObject(`releases/${relative}`,bytes);
 if(url!==descriptor.url)throw Error('Book release URL does not match the publication target');
}

const registryPath=`registries/${registry.revision}.json`,registryUrl=await publishObject(registryPath,registryBytes);
const envOutput=resolve(required('SENSA_REGISTRY_ENV_OUTPUT')),reportOutput=resolve(process.env.SENSA_REGISTRY_REPORT_OUTPUT??'release-candidate/learning-content-publication.json');
if(/[\r\n']/u.test(registryUrl))throw Error('Registry URL cannot be encoded safely');
await mkdir(dirname(envOutput),{recursive:true});await writeFile(envOutput,`SENSA_PACKAGE_REGISTRY_URL='${registryUrl}'\n`,{mode:0o600});
await mkdir(dirname(reportOutput),{recursive:true});await writeFile(reportOutput,JSON.stringify({format:'sensa-learning-content-publication-v1',projectRef,bucket,registryRevision:registry.revision,registryUrl,bookVersions:registry.items.map(item=>({bookId:item.book.bookId,bookVersionId:item.book.bookVersionId,sha256:item.sha256}))},null,2)+'\n');
console.log(`Published and verified ${registry.items.length} immutable Book release(s); Registry ${registry.revision} is ready for promotion.`);
