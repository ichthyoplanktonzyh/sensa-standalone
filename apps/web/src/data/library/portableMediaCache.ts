import type {SensaPortableLightweightMedia} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';

export type PortableMediaBlob=Readonly<{
  sha256:string;
  sizeBytes:number;
  bytes:Uint8Array;
}>;

export type PortablePackageMediaWrite=Readonly<{
  packageKey:string;
  media:readonly Readonly<{
    mediaId:string;
    sha256:string;
    mimeType:string;
    kind:'audio'|'image';
    sizeBytes:number;
    bytes:Uint8Array;
  }>[];
}>;

export type PortableMediaStorageDiagnostics=Readonly<{
  blobCount:number;
  totalBytes:number;
  referenceCount:number;
}>;

type StoredMediaReference=Readonly<{
  $sensaPortableMedia:Readonly<{
    format:'sensa-portable-media-reference-v1';
    sha256:string;
    mimeType:string;
  }>;
}>;

const digestPattern=/^[a-f0-9]{64}$/u;
const dataUrlPattern=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u;

const bytesToBase64=(bytes:Uint8Array):string=>{
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000){
    binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(bytes.length,offset+0x8000)));
  }
  return btoa(binary);
};

const base64ToBytes=(value:string):Uint8Array=>{
  const binary=atob(value);
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
};

const readDataUrl=(value:string):{mimeType:string;bytes:Uint8Array}|null=>{
  const match=dataUrlPattern.exec(value);
  if(!match)return null;
  return {mimeType:match[1]!,bytes:base64ToBytes(match[2]!)};
};

const storedReference=(value:unknown):value is StoredMediaReference=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  if(keys.length!==1||keys[0]!=='$sensaPortableMedia')return false;
  const reference=(value as Partial<StoredMediaReference>).$sensaPortableMedia;
  return !!reference
    &&reference.format==='sensa-portable-media-reference-v1'
    &&typeof reference.sha256==='string'
    &&digestPattern.test(reference.sha256)
    &&typeof reference.mimeType==='string'
    &&reference.mimeType.length>0;
};

const installedPortableManifest=(value:unknown):{
  media:readonly SensaPortableLightweightMedia[];
}|null=>{
  if(!value||typeof value!=='object')return null;
  const origin=(value as {portableOrigin?:unknown}).portableOrigin;
  if(!origin||typeof origin!=='object')return null;
  const manifest=(origin as {manifest?:unknown}).manifest;
  if(!manifest||typeof manifest!=='object')return null;
  const media=(manifest as {media?:unknown}).media;
  return Array.isArray(media)?{media:media as SensaPortableLightweightMedia[]}:null;
};

/**
 * Converts only the Runtime media carried by an installed Portable Package.
 * The public InstalledPackage shape remains untouched at every read boundary;
 * this is strictly a private SQLite representation.
 */
export function externalizePortablePackageCache(
  packageKey:string,
  value:unknown,
):{storedValue:unknown;write:PortablePackageMediaWrite}{
  const manifest=installedPortableManifest(value);
  if(!manifest)throw new Error('portable_media_manifest_missing');
  const declarationsByDigest=new Map<string,SensaPortableLightweightMedia[]>();
  for(const declaration of manifest.media){
    const declarations=declarationsByDigest.get(declaration.sha256)??[];
    declarations.push(declaration);
    declarationsByDigest.set(declaration.sha256,declarations);
  }
  const bytesByDigest=new Map<string,Uint8Array>();
  const transform=(current:unknown):unknown=>{
    if(typeof current==='string'){
      const parsed=readDataUrl(current);
      if(!parsed)return current;
      const digest=sha256(parsed.bytes);
      const declarations=declarationsByDigest.get(digest);
      // InstalledPackage may carry additional Runtime-only resources (for
      // example an assurance release). Only media declared by this `.sensa`
      // belongs to the Portable content-addressed cache.
      if(!declarations)return current;
      if(!declarations.some(item=>item.mimeType===parsed.mimeType&&item.sizeBytes===parsed.bytes.byteLength)){
        throw new Error('portable_media_declaration_mismatch');
      }
      bytesByDigest.set(digest,parsed.bytes);
      return {$sensaPortableMedia:{
        format:'sensa-portable-media-reference-v1',
        sha256:digest,
        mimeType:parsed.mimeType,
      }} satisfies StoredMediaReference;
    }
    if(Array.isArray(current))return current.map(transform);
    if(current&&typeof current==='object')return Object.fromEntries(
      Object.entries(current).map(([key,item])=>[key,transform(item)]),
    );
    return current;
  };
  const storedValue=transform(value);
  const media=manifest.media.map(declaration=>{
    const bytes=bytesByDigest.get(declaration.sha256);
    if(!bytes)throw new Error('portable_media_bytes_missing');
    return {...declaration,bytes};
  });
  return {storedValue,write:{packageKey,media}};
}

export async function hydratePortablePackageCache(
  value:unknown,
  read:(digest:string)=>Promise<PortableMediaBlob|null>,
):Promise<unknown>{
  const digests=new Set<string>();
  const collect=(current:unknown):void=>{
    if(storedReference(current)){digests.add(current.$sensaPortableMedia.sha256);return;}
    if(Array.isArray(current)){current.forEach(collect);return;}
    if(current&&typeof current==='object')Object.values(current).forEach(collect);
  };
  collect(value);
  if(!digests.size)return value;
  const blobs=new Map<string,PortableMediaBlob>();
  await Promise.all([...digests].map(async digest=>{
    const blob=await read(digest);
    if(!blob||blob.sha256!==digest||blob.sizeBytes!==blob.bytes.byteLength||sha256(blob.bytes)!==digest){
      throw new Error('portable_media_blob_invalid');
    }
    blobs.set(digest,blob);
  }));
  const transform=(current:unknown):unknown=>{
    if(storedReference(current)){
      const reference=current.$sensaPortableMedia;
      const blob=blobs.get(reference.sha256);
      if(!blob)throw new Error('portable_media_blob_missing');
      return `data:${reference.mimeType};base64,${bytesToBase64(blob.bytes)}`;
    }
    if(Array.isArray(current))return current.map(transform);
    if(current&&typeof current==='object')return Object.fromEntries(
      Object.entries(current).map(([key,item])=>[key,transform(item)]),
    );
    return current;
  };
  return transform(value);
}
