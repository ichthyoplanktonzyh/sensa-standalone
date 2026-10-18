import {
 canonicalConsumerJson,
 sensaPortableLearningContentRegistrySchema,
 type SensaPortableLearningContentRegistry,
} from '@sensa/contracts/sensa';
import {createHash} from 'node:crypto';

const maximumRegistryBytes=1024*1024;
let cachedRemote:{url:string;registry:SensaPortableLearningContentRegistry}|undefined;

function registryUrl(value:string|undefined):URL|null {
 if(!value?.trim())return null;
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Invalid learning content registry URL');
 return url;
}

function verifiedRegistry(
 value:SensaPortableLearningContentRegistry,
):SensaPortableLearningContentRegistry {
 const {revision,...snapshot}=value;
 if(createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex')!==revision)throw new Error('Learning content registry revision mismatch');
 return value;
}

async function remoteRegistry(url:URL):Promise<SensaPortableLearningContentRegistry>{
 if(cachedRemote?.url===url.href)return cachedRemote.registry;
 const response=await fetch(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('Learning content registry unavailable');
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>maximumRegistryBytes)throw new Error('Learning content registry too large');
 const text=await response.text();
 if(new TextEncoder().encode(text).byteLength>maximumRegistryBytes)throw new Error('Learning content registry too large');
 const parsed=sensaPortableLearningContentRegistrySchema.parse(JSON.parse(text));
 cachedRemote={url:url.href,registry:verifiedRegistry(parsed)};
 return parsed;
}

const emptySnapshot={
 format:'sensa-learning-content-registry-v3' as const,
 publishedAt:'1970-01-01T00:00:00.000Z',
 items:[],
};
const emptyRegistry:SensaPortableLearningContentRegistry={
 ...emptySnapshot,
 revision:createHash('sha256').update(canonicalConsumerJson(emptySnapshot)).digest('hex'),
};

/** A remote immutable Registry snapshot takes precedence. Inline JSON remains
 * a local-preview adapter, not the publication store. */
export async function readLearningContentRegistry(source:NodeJS.ProcessEnv=process.env){
 const url=registryUrl(source.SENSA_PACKAGE_REGISTRY_URL);
 if(url)return remoteRegistry(url);
 if(!source.SENSA_PACKAGE_CATALOG_JSON?.trim())return emptyRegistry;
 return verifiedRegistry(sensaPortableLearningContentRegistrySchema.parse(
  JSON.parse(source.SENSA_PACKAGE_CATALOG_JSON),
 ));
}

export function clearLearningContentRegistryCache(){cachedRemote=undefined;}

/** Keeps optional preview metadata out of responses consumed by older strict clients. */
export function registryWithoutBookPreviews(registry:SensaPortableLearningContentRegistry):SensaPortableLearningContentRegistry {
 if(!registry.items.some(item=>item.preview))return registry;
 const {revision:_,...snapshot}=registry;
 const compatible={...snapshot,items:snapshot.items.map(({preview:_,...item})=>item)};
 return {...compatible,revision:createHash('sha256').update(canonicalConsumerJson(compatible)).digest('hex')};
}
