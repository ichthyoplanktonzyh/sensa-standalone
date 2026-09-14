import {
  sensaBridgeRequestChannel,
  sensaBridgeResponseChannel,
  sensaBridgeValue,
  type SensaBridgeKind,
  type SensaBridgePayload,
  type SensaBridgeValue,
} from '@sensa/contracts/sensa';

export type LocalAgentBridgeKind = Extract<SensaBridgeKind, `web-native-${string}`>;

export function localAgentBridge<K extends LocalAgentBridgeKind>(
  kind: K,
  libraryId: string,
  signal: AbortSignal,
  payload: SensaBridgePayload<K>,
): Promise<SensaBridgeValue<K>> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = (error?: string, response?: unknown) => {
      clearTimeout(timer);
      window.removeEventListener('message', listener);
      signal.removeEventListener('abort', abort);
      if (error) reject(new Error(error));
      else {
        try { resolve(sensaBridgeValue(kind, response)); }
        catch (cause) { reject(cause); }
      }
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source === window
        && event.origin === location.origin
        && event.data?.channel === sensaBridgeResponseChannel
        && event.data.id === id
      ) finish(undefined, event.data);
    };
    const abort = () => finish('interrupted');
    const timer = setTimeout(() => finish('extension_unavailable'), 3_000);
    window.addEventListener('message', listener);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    window.postMessage({
      channel: sensaBridgeRequestChannel,
      id,
      kind,
      libraryId,
      ...payload,
    }, location.origin);
  });
}
