import { useCallback, useSyncExternalStore } from "react";
import { sensaApi, type SensaScope } from "../api";

/*
 * Audio is addressed through the Action that referenced it. An asset the
 * current Action does not reference has no capability URL at all, which is the
 * transport-level form of the same closed-reference rule the renderers follow.
 */

export type SensaAudioState = Readonly<{
  playingAssetId: string | null;
  loadingAssetId: string | null;
  error: string | null;
}>;

type CapabilityKey = string;

const idle: SensaAudioState = { playingAssetId: null, loadingAssetId: null, error: null };

class SensaAudioPlayer {
  #state: SensaAudioState = idle;
  #listeners = new Set<() => void>();
  #element: HTMLAudioElement | null = null;
  #urls = new Map<CapabilityKey, Readonly<{ url: string; expiresAt: number }>>();
  #token = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  snapshot = (): SensaAudioState => this.#state;

  #emit(next: SensaAudioState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }

  #audio(): HTMLAudioElement {
    this.#element ??= new Audio();
    return this.#element;
  }

  stop(): void {
    this.#token += 1;
    const element = this.#element;
    if (element !== null) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.#emit(idle);
  }

  async #capabilityUrl(input: Readonly<{
    scope: SensaScope;
    encounterId: string;
    actionId: string;
    assetId: string;
  }>): Promise<string> {
    const key = `${input.encounterId}:${input.actionId}:${input.assetId}`;
    const cached = this.#urls.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now() + 5_000) return cached.url;
    const result = await sensaApi.mediaDownload(
      input.scope,
      input.encounterId,
      input.actionId,
      input.assetId,
    );
    const url = result.download.url;
    this.#urls.set(key, { url, expiresAt: Date.parse(result.download.expiresAt) });
    return url;
  }

  async play(input: Readonly<{
    scope: SensaScope;
    encounterId: string;
    actionId: string;
    assetId: string;
  }>): Promise<void> {
    if (this.#state.playingAssetId === input.assetId) {
      this.stop();
      return;
    }
    this.stop();
    const token = this.#token;
    this.#emit({ playingAssetId: null, loadingAssetId: input.assetId, error: null });
    try {
      const url = await this.#capabilityUrl(input);
      if (token !== this.#token) return;
      const element = this.#audio();
      element.src = url;
      element.onended = () => {
        if (token === this.#token) this.#emit(idle);
      };
      element.onerror = () => {
        if (token === this.#token) {
          this.#emit({ playingAssetId: null, loadingAssetId: null, error: "音频无法播放。" });
        }
      };
      await element.play();
      if (token !== this.#token) return;
      this.#emit({ playingAssetId: input.assetId, loadingAssetId: null, error: null });
    } catch (caught) {
      if (token !== this.#token) return;
      this.#emit({
        playingAssetId: null,
        loadingAssetId: null,
        error: caught instanceof Error ? `音频不可用：${caught.message}` : "音频不可用。",
      });
    }
  }
}

const player = new SensaAudioPlayer();

export function useSensaAudio(
  scope: SensaScope | null,
  encounterId: string | null,
  actionId: string | null,
): Readonly<{
  state: SensaAudioState;
  play: (assetId: string) => void;
  stop: () => void;
}> {
  const state = useSyncExternalStore(player.subscribe, player.snapshot, player.snapshot);
  const play = useCallback((assetId: string) => {
    if (scope === null || encounterId === null || actionId === null) return;
    void player.play({ scope, encounterId, actionId, assetId });
  }, [scope, encounterId, actionId]);
  const stop = useCallback(() => player.stop(), []);
  return { state, play, stop };
}

export function stopSensaAudio(): void {
  player.stop();
}
