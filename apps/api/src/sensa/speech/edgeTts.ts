import {randomUUID} from 'node:crypto';
import {edgeSpeechConnectionUrl, edgeSpeechWireDate} from '@sensa/contracts/speech/edge-read-aloud';
import {Buffer} from 'node:buffer';
import WebSocket from 'ws';

const maxAudioBytes = 2_000_000;

type SpeechPhase = 'connect' | 'synthesis' | 'audio';
function speechFailure(message: string, code: string, phase: SpeechPhase, details: {upstreamStatus?: number; upstreamCloseCode?: number} = {}): Error {
  return Object.assign(new Error(message), {code, failurePhase: phase, ...details});
}
const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);
const tlsCodes = new Set(['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT']);


function escapeXml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, ' ')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function frameAudio(data: Buffer): Buffer {
  if (data.length < 2) throw new Error('edge_tts_invalid_audio_frame');
  const headerLength = data.readUInt16BE(0);
  if (headerLength + 2 > data.length) throw new Error('edge_tts_invalid_audio_frame');
  const header = data.subarray(2, headerLength + 2).toString('utf8');
  if (!/(?:^|\r\n)Path:audio(?:\r\n|$)/u.test(header)
    || /(?:^|\r\n)Content-Type:(?!audio\/mpeg(?:\r\n|$))/u.test(header)) {
    throw new Error('edge_tts_invalid_audio_frame');
  }
  return data.subarray(headerLength + 2);
}

/** Bounded server transport for Edge Read Aloud; returns audio bytes only. */
export async function synthesizeEdgeSpeech(input: {
  surface: string;
  voice: string;
  locale: string;
}, signal: AbortSignal, dependencies: {socket?: (url: URL, options: WebSocket.ClientOptions) => WebSocket; clock?: () => Date} = {}): Promise<Buffer> {
  const now = dependencies.clock?.() ?? new Date();
  signal.throwIfAborted();
  const socket = (dependencies.socket ?? ((url, options) => new WebSocket(url, options)))(edgeSpeechConnectionUrl(now, randomUUID()), {
    headers: {
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
      Cookie: `muid=${randomUUID().replaceAll('-', '').toUpperCase()};`,
      'Accept-Language': 'en-US,en;q=0.9',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
    },
    perMessageDeflate: true,
    handshakeTimeout: 10_000,
  });
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let ended = false;
    let settled = false;
    let phase: SpeechPhase = 'connect';
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      if (error) reject(error);
      else if (!ended || size === 0) reject(speechFailure('edge_tts_empty_audio', 'EDGE_TTS_EMPTY_AUDIO', phase));
      else resolve(Buffer.concat(chunks, size));
    };
    const cancel = () => finish(speechFailure('speech_cancelled', signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'EDGE_TTS_TIMEOUT' : 'EDGE_TTS_CANCELLED', phase));
    signal.addEventListener('abort', cancel, {once: true});
    socket.on('open', () => {
      if (settled) return;
      phase = 'synthesis';
      try {
        const timestamp = edgeSpeechWireDate(now);
        socket.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'false'},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}})}\r\n`);
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${input.locale}'><voice name='${input.voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(input.surface)}</prosody></voice></speak>`;
        socket.send(`X-RequestId:${randomUUID().replaceAll('-', '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`);
      } catch { finish(speechFailure('edge_tts_connection_failed', 'EDGE_TTS_SEND_FAILED', phase)); }
    });
    socket.on('message', (data, binary) => {
      if (settled) return;
      try {
        if (!binary) {
          if (String(data).includes('Path:turn.end')) {
            ended = true;
            finish();
          }
          return;
        }
        const frame = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        const audio = frameAudio(frame);
        if (audio.length) phase = 'audio';
        size += audio.length;
        if (size > maxAudioBytes) throw new Error('edge_tts_audio_too_large');
        if (audio.length) chunks.push(audio);
      } catch (error) {
        finish(speechFailure(error instanceof Error && error.message === 'edge_tts_audio_too_large' ? 'edge_tts_audio_too_large' : 'edge_tts_invalid_audio_frame', error instanceof Error && error.message === 'edge_tts_audio_too_large' ? 'EDGE_TTS_AUDIO_LIMIT' : 'EDGE_TTS_INVALID_AUDIO', phase));
      }
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(speechFailure('edge_tts_connection_failed', 'EDGE_TTS_HANDSHAKE_REJECTED', phase, {upstreamStatus: response.statusCode}));
    });
    socket.on('error', error => {
      const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
      finish(speechFailure('edge_tts_connection_failed', networkCodes.has(code) ? code : tlsCodes.has(code) ? 'EDGE_TTS_TLS_FAILED' : error.message === 'Opening handshake has timed out' ? 'EDGE_TTS_HANDSHAKE_TIMEOUT' : 'EDGE_TTS_CONNECTION_FAILED', phase));
    });
    socket.on('close', code => {
      if (!settled) finish(speechFailure('edge_tts_connection_closed', 'EDGE_TTS_CONNECTION_CLOSED', phase, {upstreamCloseCode: code}));
    });
  });
}
