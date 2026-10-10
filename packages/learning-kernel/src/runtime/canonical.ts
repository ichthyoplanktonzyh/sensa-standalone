function isRecord(value:unknown):value is Record<string,unknown>{
  return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

/**
 * JSON canonicalization is intentionally narrow and deterministic. It rejects
 * values that JSON.stringify would silently coerce, so an accepted fact can be
 * replayed without changing its digest.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (!isRecord(value)) throw new Error("JSON value is not canonicalizable");
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`
  )).join(",")}}`;
}

export function canonicalizeText(value: string): string {
  return value.normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("und");
}

const utf8Encoder=new TextEncoder();

function utf8Bytes(value:string):Uint8Array {
  return utf8Encoder.encode(value);
}

const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Synchronous SHA-256 over raw bytes or UTF-8 text, with no platform-specific imports. */
export function sha256(value: string | Uint8Array): string {
  const input = typeof value === "string" ? utf8Bytes(value) : value;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  // The message length is encoded as a 64-bit big-endian integer. The high
  // word expression remains exact for all practical JavaScript strings.
  const bitLength = input.length * 8;
  const high = Math.floor(input.length / 0x20000000);
  const low = bitLength >>> 0;
  const lengthOffset = padded.length - 8;
  padded[lengthOffset] = (high >>> 24) & 0xff;
  padded[lengthOffset + 1] = (high >>> 16) & 0xff;
  padded[lengthOffset + 2] = (high >>> 8) & 0xff;
  padded[lengthOffset + 3] = high & 0xff;
  padded[lengthOffset + 4] = (low >>> 24) & 0xff;
  padded[lengthOffset + 5] = (low >>> 16) & 0xff;
  padded[lengthOffset + 6] = (low >>> 8) & 0xff;
  padded[lengthOffset + 7] = low & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);

  for (let blockOffset = 0; blockOffset < padded.length; blockOffset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = blockOffset + index * 4;
      schedule[index] = (
        (padded[offset]! << 24)
        | (padded[offset + 1]! << 16)
        | (padded[offset + 2]! << 8)
        | padded[offset + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const valueA = schedule[index - 15]!;
      const valueB = schedule[index - 2]!;
      const sigma0 = rotateRight(valueA, 7)
        ^ rotateRight(valueA, 18)
        ^ (valueA >>> 3);
      const sigma1 = rotateRight(valueB, 17)
        ^ rotateRight(valueB, 19)
        ^ (valueB >>> 10);
      schedule[index] = (
        schedule[index - 16]!
        + sigma0
        + schedule[index - 7]!
        + sigma1
      ) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6)
        ^ rotateRight(e, 11)
        ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA256_K[index]! + schedule[index]!) >>> 0;
      const sigma0 = rotateRight(a, 2)
        ^ rotateRight(a, 13)
        ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

// Cache only exact immutable canonical strings, never objects or mutable bytes.
// Repeated material validation still canonicalizes the current value and checks
// its actual digest; bounded entries cannot retain an unbounded media library.
type CanonicalDigestEntry={text:string;digest:string};
const canonicalDigests=new Map<string,{reference:WeakRef<CanonicalDigestEntry>;length:number}>();
const maximumCanonicalDigestChars=2*1024*1024;
let canonicalDigestChars=0;

export function canonicalJsonDigest(value: unknown): string {
  const text=canonicalizeJson(value);
  if(typeof WeakRef==='undefined'||text.length<16*1024||text.length>256*1024)return sha256(text);
  // The bucket is not a security digest: full text equality is mandatory.
  // Weak values leave no new strong reference to cleared learner payloads.
  let fingerprint=2166136261;
  for(let index=0;index<text.length;index++)fingerprint=Math.imul(fingerprint^text.charCodeAt(index),16777619)>>>0;
  const key=`${fingerprint}:${text.length}`,cached=canonicalDigests.get(key);
  const previous=cached?.reference.deref();
  if(previous?.text===text){
    canonicalDigests.delete(key);canonicalDigests.set(key,cached!);return previous.digest;
  }
  const result=sha256(text);
  if(cached){canonicalDigests.delete(key);canonicalDigestChars-=cached.length;}
  while(canonicalDigestChars+text.length>maximumCanonicalDigestChars){
    const oldest=canonicalDigests.keys().next().value;
    if(oldest===undefined)break;
    canonicalDigestChars-=canonicalDigests.get(oldest)!.length;canonicalDigests.delete(oldest);
  }
  canonicalDigests.set(key,{reference:new WeakRef({text,digest:result}),length:text.length});canonicalDigestChars+=text.length;
  return result;
}
/** Stable UUID derived from a fact identity, with UUID v4/variant bits set. */
export function stableUuid(value: string): string {
  const digest = sha256(value);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
