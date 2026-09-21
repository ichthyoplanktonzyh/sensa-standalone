import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export type AuthoredMediaMimeType = 'audio/mpeg' | 'image/jpeg';
export type AuthoredMediaReference = Readonly<{
  sha256: string;
  mimeType: AuthoredMediaMimeType;
}>;
export type AuthoredMediaInput = AuthoredMediaReference | string;
export type AuthoredMediaPackObject = AuthoredMediaReference & Readonly<{base64: string}>;

type MediaFormat = Readonly<{
  directory: 'audio' | 'images';
  extension: '.mp3' | '.jpg';
  maximumBytes: number;
  dataUrlPrefix: string;
  hasExpectedSignature: (bytes: Buffer) => boolean;
}>;

const formats: Record<AuthoredMediaMimeType, MediaFormat> = {
  'audio/mpeg': {
    directory: 'audio',
    extension: '.mp3',
    maximumBytes: 2 * 1024 * 1024,
    dataUrlPrefix: 'data:audio/mpeg;base64,',
    hasExpectedSignature: (bytes) =>
      bytes.subarray(0, 3).toString('ascii') === 'ID3'
      || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0),
  },
  'image/jpeg': {
    directory: 'images',
    extension: '.jpg',
    maximumBytes: 190_000,
    dataUrlPrefix: 'data:image/jpeg;base64,',
    hasExpectedSignature: (bytes) =>
      bytes.length >= 4
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff
      && bytes.at(-2) === 0xff
      && bytes.at(-1) === 0xd9,
  },
};

const sha256Pattern = /^[a-f0-9]{64}$/u;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;
const parseReference = (input: Exclude<AuthoredMediaInput, string>, label: string) => {
  if (
    Object.keys(input).sort().join(',') !== 'mimeType,sha256'
    || !sha256Pattern.test(input.sha256)
    || !Object.hasOwn(formats, input.mimeType)
  ) throw new Error(`Authored media reference is invalid: ${label}`);
  return input;
};

const mediaKey = (reference: AuthoredMediaReference) => `${reference.mimeType}:${reference.sha256}`;

const verifyBytes = (reference: AuthoredMediaReference, bytes: Buffer, label: string) => {
  const format = formats[reference.mimeType];
  if (bytes.length > format.maximumBytes) throw new Error(`Authored media is too large: ${label}`);
  if (!format.hasExpectedSignature(bytes)) throw new Error(`Authored media type does not match ${reference.mimeType}: ${label}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== reference.sha256) throw new Error(`Authored media digest mismatch for ${label}`);
  const dataUrl = format.dataUrlPrefix + bytes.toString('base64');
  if (reference.mimeType === 'image/jpeg' && dataUrl.length > 256_000) {
    throw new Error(`Authored image exceeds the saved-image limit: ${label}`);
  }
  return dataUrl;
};

const readSealedPack = async (path: string) => {
  let value: unknown;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('Sealed authored media pack is unreadable'); }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sealed authored media pack is invalid');
  const candidate = value as {format?: unknown; objects?: unknown};
  if (candidate.format !== 'sensa-authored-media-pack-v1' || !Array.isArray(candidate.objects)) throw new Error('Sealed authored media pack is invalid');
  const objects = new Map<string, AuthoredMediaPackObject>();
  let previous = '';
  for (const [index, unknownObject] of candidate.objects.entries()) {
    if (unknownObject == null || typeof unknownObject !== 'object' || Array.isArray(unknownObject)) throw new Error(`Sealed authored media object is invalid: ${index}`);
    const object = unknownObject as AuthoredMediaPackObject;
    if (Object.keys(object).sort().join(',') !== 'base64,mimeType,sha256' || !base64Pattern.test(object.base64)) throw new Error(`Sealed authored media object is invalid: ${index}`);
    const reference = parseReference({sha256:object.sha256,mimeType:object.mimeType}, `sealed-pack:${index}`),key=mediaKey(reference);
    if (key <= previous || objects.has(key)) throw new Error('Sealed authored media objects must be unique and sorted');
    const bytes=Buffer.from(object.base64,'base64');
    if(bytes.toString('base64')!==object.base64)throw new Error(`Sealed authored media base64 is not canonical: ${index}`);
    verifyBytes(reference,bytes,`sealed-pack:${index}`);objects.set(key,object);previous=key;
  }
  if(!objects.size)throw new Error('Sealed authored media pack is empty');
  return objects;
};

/**
 * Deep release boundary for authored media. Callers supply only immutable,
 * content-addressed references; this module owns lookup, type/size checks,
 * digest verification and conversion to offline bundle bytes.
 */
export const createAuthoredMediaPackager = async (options: Readonly<{mediaRoot: string; mediaPackPath?: string}>) => {
 const packed=options.mediaPackPath?await readSealedPack(options.mediaPackPath):null,used=new Set<string>();
 return {
  embed: async (input: AuthoredMediaInput | null | undefined, label: string) => {
    if (input == null) return null;
    if (typeof input === 'string') {
      const legacyAudio = input.match(/^\/golden-audio\/([a-f0-9]{64})\.mp3$/u);
      if (!legacyAudio) throw new Error(`Authored media must be content-addressed: ${label}`);
      input = {sha256: legacyAudio[1]!, mimeType: 'audio/mpeg'};
    }
    const reference = parseReference(input, label);
    const key=mediaKey(reference),format=formats[reference.mimeType],packedObject=packed?.get(key);
    if(packed&&!packedObject)throw new Error(`Missing sealed authored media for ${label}: ${reference.sha256}`);
    const bytes=packedObject?Buffer.from(packedObject.base64,'base64'):await readFile(resolve(options.mediaRoot,format.directory,reference.sha256+format.extension)).catch(()=>{throw new Error(`Missing authored media for ${label}: ${reference.sha256}`);});
    used.add(key);return verifyBytes(reference,bytes,label);
  },
  assertSealedPackFullyConsumed:()=>{
   if(!packed)return;
   const unused=[...packed.keys()].filter(key=>!used.has(key));
   if(unused.length)throw new Error(`Sealed authored media pack contains unused objects: ${unused.join(', ')}`);
  },
 };
};
