import {createHash, randomUUID} from 'node:crypto';
import WebSocket from 'ws';

const token = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const version = '143.0.3650.75';
const maxAudioBytes = 2_000_000;
const endpoint = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

function connectionUrl(now: Date): URL {
  const rounded = Math.floor(now.getTime() / 1000 / 300) * 300;
  const ticks = (BigInt(rounded + 11_644_473_600) * 10_000_000n).toString();
  const url = new URL(endpoint);
  url.searchParams.set('TrustedClientToken', token);
  url.searchParams.set('Sec-MS-GEC', createHash('sha256').update(ticks + token).digest('hex').toUpperCase());
  url.searchParams.set('Sec-MS-GEC-Version', `1-${version}`);
  url.searchParams.set('ConnectionId', randomUUID().replaceAll('-', ''));
  return url;
}

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
}, signal: AbortSignal): Promise<Buffer> {
  const now = new Date();
  signal.throwIfAborted();
  const socket = new WebSocket(connectionUrl(now), {
    headers: {
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
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
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      if (error) reject(error);
      else if (!ended || size === 0) reject(new Error('edge_tts_empty_audio'));
      else resolve(Buffer.concat(chunks, size));
    };
    const cancel = () => finish(new Error('speech_cancelled'));
    signal.addEventListener('abort', cancel, {once: true});
    socket.on('open', () => {
      const timestamp = now.toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
      socket.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'false'},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}})}\r\n`);
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${input.locale}'><voice name='${input.voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(input.surface)}</prosody></voice></speak>`;
      socket.send(`X-RequestId:${randomUUID().replaceAll('-', '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`);
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
        size += audio.length;
        if (size > maxAudioBytes) throw new Error('edge_tts_audio_too_large');
        if (audio.length) chunks.push(audio);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('edge_tts_invalid_message'));
      }
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(new Error('edge_tts_connection_failed'));
    });
    socket.on('error', () => finish(new Error('edge_tts_connection_failed')));
    socket.on('close', () => {
      if (!settled) finish(new Error('edge_tts_connection_closed'));
    });
  });
}
