import {learningPackageCatalogSchema,type LearningContentRegistry} from '@sensa/contracts/sensa';
import {createHash} from 'node:crypto';

const maximumRegistryBytes=1024*1024;
let cachedRemote:{url:string;registry:LearningContentRegistry}|undefined;

function registryUrl(value:string|undefined):URL|null {
 if(!value?.trim())return null;
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Invalid learning content registry URL');
 return url;
}

function verifiedRegistry(value:LearningContentRegistry):LearningContentRegistry {
 const {revision,...snapshot}=value;
 if(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')!==revision)throw new Error('Learning content registry revision mismatch');
 return value;
}

async function remoteRegistry(url:URL):Promise<LearningContentRegistry>{
 if(cachedRemote?.url===url.href)return cachedRemote.registry;
 const response=await fetch(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('Learning content registry unavailable');
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>maximumRegistryBytes)throw new Error('Learning content registry too large');
 const text=await response.text();
 if(new TextEncoder().encode(text).byteLength>maximumRegistryBytes)throw new Error('Learning content registry too large');
 const parsed=learningPackageCatalogSchema.parse(JSON.parse(text));
 if(!('format' in parsed))throw new Error('Remote learning content registry must use the current format');
 cachedRemote={url:url.href,registry:verifiedRegistry(parsed)};
 return parsed;
}

/** A remote immutable Registry snapshot takes precedence. Inline JSON remains
 * a rollout and local-preview adapter, not the long-term publication store. */
export async function readLearningContentRegistry(source:NodeJS.ProcessEnv=process.env){
 const url=registryUrl(source.SENSA_PACKAGE_REGISTRY_URL);
 if(url)return remoteRegistry(url);
 const parsed=learningPackageCatalogSchema.parse(JSON.parse(source.SENSA_PACKAGE_CATALOG_JSON??'{"items":[]}'));
 return 'format' in parsed?verifiedRegistry(parsed):parsed;
}

export function clearLearningContentRegistryCache(){cachedRemote=undefined;}
