// Edge Read Aloud v2 protocol arithmetic; shared by server and browser adapters.
// Reference: hs-CN/msedge-tts src/tts/drm.rs (MIT, Copyright (c) 2024 shuai.huang).
// See THIRD_PARTY_NOTICES.md. This is protocol hashing, not a general crypto API.
const clientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const edgeSpeechVersion = '143.0.3650.75';
const initial = [
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
];
const prefixState = [
  0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
];
const prefixSchedule = [
  0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
  0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564,
];
const roundConstants = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
];
const coefficients = [
  [0xE82E91B1, 0xB32700D0],
  [0x44DE24C6, 0x88DFF51D],
  [0x3BEB65BC, 0x29514038],
  [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5],
  [0x314EF5D5, 0x26E55F3C],
  [0xE92491B1, 0x607801C6],
  [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA],
  [0xDA79FA60, 0x207CC464],
  [0xBED20560, 0x3C3C74F3],
  [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1],
  [0xCB49E3C6, 0xC5626167],
];
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
const sigma0 = (x: number) => rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
const sigma1 = (x: number) => rotate(x, 17) ^ rotate(x, 19) ^ (x >>> 10);
const hex = (bytes: Uint8Array) => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
function expand(words: number[], start: number) {
  for (let i = start; i < 64; i++) words[i] = (sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) >>> 0;
}
function rounds(state: readonly number[], words: readonly number[], start = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = start; i < 64; i++) {
    const k = start === 14 && i === 14 ? 0xC9DC06A7 : roundConstants[i];
    const t = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (g ^ (e & (f ^ g))) + k + words[i];
    const u = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) | (c & (a | b)));
    [a, b, c, d, e, f, g, h] = [(t + u) >>> 0, a, b, c, (d + t) >>> 0, e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}
function digest(data: Uint8Array) {
  const words = Array<number>(16).fill(0);
  words[14] = (data[0] << 16) | (data[1] << 8) | data[2];
  words[15] = new DataView(data.buffer, data.byteOffset).getUint32(3);
  for (let i = 16; i < 30; i++) {
    let value = prefixSchedule[i - 16];
    value += sigma1(words[i - 2]) ^ (i === 16 ? 0x000B92C0 : 0);
    if (i >= 21) value += words[i - 7];
    if (i >= 29) value += sigma0(words[i - 15]) ^ 0x059C0B80;
    words[i] = value >>> 0;
  }
  words[30] = (sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + 0xC9DC06A7 - roundConstants[14]) >>> 0;
  expand(words, 31);
  let state = rounds(prefixState, words, 14).map((x, i) => (x + initial[i]) >>> 0);
  const length = 57 + data.length;
  const padding = new Uint8Array(data.length - 7 + 1 + ((55 - length) % 64 + 64) % 64 + 8);
  padding.set(data.subarray(7));
  padding[data.length - 7] = 0x80;
  new DataView(padding.buffer).setBigUint64(padding.length - 8, BigInt(length * 8));
  const view = new DataView(padding.buffer);
  for (let offset = 0; offset < padding.length; offset += 64) {
    const block = Array.from({length: 16}, (_, i) => view.getUint32(offset + i * 4));
    expand(block, 16);
    state = rounds(state, block).map((x, i) => (x + state[i]) >>> 0);
  }
  const result = new Uint8Array(32), resultView = new DataView(result.buffer);
  state.forEach((x, i) => resultView.setUint32(i * 4, x));
  return result;
}
function checksum(data: Uint8Array, hash: Uint8Array) {
  const hashView = new DataView(hash.buffer, hash.byteOffset);
  const keys = [hashView.getUint32(0, true) | 1, hashView.getUint32(4, true) | 1];
  const factors = keys.map(x => Math.imul(x, 0x82893933));
  const terms = coefficients.map(([x], i) => Math.imul(x, factors[i % 2]));
  const offsets = coefficients.map(([, x]) => x);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / 8) * 8);
  padded.set(data, 1);
  const view = new DataView(padded.buffer);
  for (let i = 0; i < padded.length / 4; i++) {
    const word = view.getUint32(i * 4, true);
    terms.push((Math.imul(word, keys[i % 2]) + (i === 0 ? Math.imul(0xF2F90B1A, factors[0]) : 0)) >>> 0);
    offsets.push((Math.imul(rotate(word, 16), i % 2 ? 0xC31713DB : 0xEF0569FB) + (i === 0 ? 0x0B1A0000 : 0)) >>> 0);
  }
  let swappedSum = 0, swappedLast = 0, state = 0, sum = 0;
  for (let i = 0; i < terms.length; i += 2) {
    let q = Math.imul(rotate((offsets[i] + terms[i]) >>> 0, 16), 0x76F50F34);
    swappedSum = (swappedSum + Math.imul(rotate(q, 16), 0xC3EFEA97) + q) >>> 0;
    q = Math.imul(rotate((offsets[i + 1] + terms[i + 1]) >>> 0, 16), 0x1881CE3C);
    swappedLast = (Math.imul(rotate(q, 16), 0x35BD1EC9) + q) >>> 0;
    swappedSum = (swappedSum + swappedLast) >>> 0;
    state = (Math.imul(state, keys[0]) + terms[i]) >>> 0;
    for (const factor of [0xCF98B111, 0x87085B9F, 0x12CEB96D, 0x257E1D83]) state = Math.imul(rotate(state, 16), factor);
    sum = (sum + state) >>> 0;
    state = (Math.imul(state, keys[1]) + terms[i + 1]) >>> 0;
    for (const factor of [0xA27416F5, 0xD38396FF, 0x7C932B89, 0xBFA49F69]) state = Math.imul(rotate(state, 16), factor);
    sum = (sum + state) >>> 0;
  }
  const result = new Uint8Array(8), resultView = new DataView(result.buffer);
  resultView.setUint32(0, swappedLast ^ state, true);
  resultView.setUint32(4, swappedSum ^ sum, true);
  return result;
}
export function edgeSpeechConnectionUrl(now: Date, connectionId: string): URL {
  const seconds = Math.floor(now.getTime() / 1000) + 11_644_473_600;
  if (!Number.isSafeInteger(seconds)) throw new Error('edge_tts_invalid_clock');
  const ticks = BigInt(seconds - seconds % 300) * 10_000_000n;
  const data = new TextEncoder().encode(`${ticks}${clientToken}`), hash = digest(data);
  const url = new URL('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1');
  url.search = new URLSearchParams({TrustedClientToken: clientToken, 'Sec-MS-GEC': `${hex(checksum(data, hash))}-${hex(hash)}`, 'Sec-MS-GEC-Version': `2-${edgeSpeechVersion}`, ConnectionId: connectionId.replaceAll('-', '')}).toString();
  return url;
}

export function edgeSpeechWireDate(date: Date): string {
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}
