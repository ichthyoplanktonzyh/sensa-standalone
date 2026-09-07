import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives one embedded YouGlish widget.
 *
 * YouGlish owns the player. We hand it a single word and it streams real spoken
 * occurrences of that word from across YouTube, one track after another. Unlike
 * the Sensa variant we do not own the media window, the timeline or the caption
 * layout — the widget is a black box that we create, point at a word, and step
 * through with its own API.
 *
 * The widget searches by surface string, so it is sense-agnostic by nature.
 * That is exactly why it is kept as the YouGlish baseline: it shows what raw
 * YouGlish gives for a word, against which the sense-filtered Sensa variant is
 * judged. This hook never claims a Sense assignment for what it plays.
 */

type YouglishWidget = {
  fetch(query: string, lang: string, accent?: string): void;
  play(): void;
  pause(): void;
  replay(): void;
  /** Move the playhead by a signed number of seconds within the video. */
  move(seconds: number): void;
  next(): void;
  previous(): void;
  setSpeed(rate: number): void;
  close(): void;
};

/** YouGlish player states, from the onPlayerStateChange event. */
const PLAYER_STATE_PLAYING = 1;

interface WidgetEvent {
  totalResult?: number;
  video?: string;
  trackNumber?: number;
  caption?: string;
  state?: number;
  code?: number;
}

declare global {
  interface Window {
    YG?: {
      Widget: new (element: HTMLElement | string, options: unknown) => YouglishWidget;
    };
    onYouglishAPIReady?: () => void;
  }
}

const API_SRC = 'https://youglish.com/public/emb/widget.js';
const API_TIMEOUT_MS = 8000;

let apiPromise: Promise<NonNullable<Window['YG']>> | null = null;

/** Load the widget API once per document, and give up rather than hang. */
const loadYouglishApi = (): Promise<NonNullable<Window['YG']>> => {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('No document'));
      return;
    }
    if (window.YG?.Widget) {
      resolve(window.YG);
      return;
    }

    const timer = window.setTimeout(
      () => reject(new Error('YouGlish widget API timed out')),
      API_TIMEOUT_MS,
    );
    // The API announces itself through a single global callback. Chain any
    // existing one so a second consumer on the page is not silently dropped.
    const previous = window.onYouglishAPIReady;
    window.onYouglishAPIReady = () => {
      window.clearTimeout(timer);
      previous?.();
      if (window.YG?.Widget) resolve(window.YG);
      else reject(new Error('YouGlish API loaded without a Widget'));
    };

    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = API_SRC;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('YouGlish widget API failed to load'));
      };
      document.head.appendChild(script);
    }
  });

  apiPromise = apiPromise.catch(error => {
    apiPromise = null;
    document.querySelector(`script[src="${API_SRC}"]`)?.remove();
    throw error;
  });
  return apiPromise;
};

export type YouglishStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface YouglishWidgetHandle {
  status: YouglishStatus;
  /** Total tracks the current word returned. */
  totalResults: number;
  /** Caption of the line now voiced, decoded; target terms in `[[[ ]]]`. */
  caption: string | null;
  /** Whether the player is currently playing, for the play/pause control. */
  isPlaying: boolean;
  /** Play or pause the current track. */
  toggle(): void;
  /** Nudge the playhead by a signed number of seconds (e.g. -5, +5). */
  move(seconds: number): void;
  /** Restart the current occurrence from the top. */
  replay(): void;
  /** Step to the next / previous occurrence (track). */
  next(): void;
  previous(): void;
  setSpeed(rate: number): void;
}

interface UseYouglishWidgetOptions {
  /** Container the widget mounts into. */
  mountRef: React.RefObject<HTMLDivElement | null>;
  /** The word to search. Sense-agnostic: only the surface form is used. */
  query: string | undefined;
  lang?: string;
  accent?: string;
  /**
   * YouGlish component bitmask. Bit 0 (1) is their search box, bit 3 (8) is the
   * caption. We default to 8 — player + caption only — so their search box and
   * promo chrome give way to our own picker and controls.
   */
  components?: number;
  /** Create/keep the widget only while the screen is visible. */
  active: boolean;
}

export const useYouglishWidget = ({
  mountRef,
  query,
  lang = 'english',
  accent,
  components = 8,
  active,
}: UseYouglishWidgetOptions): YouglishWidgetHandle => {
  const [status, setStatus] = useState<YouglishStatus>('idle');
  const [totalResults, setTotalResults] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  const widgetRef = useRef<YouglishWidget | null>(null);
  // Mirror of isPlaying so the play/pause toggle reads the latest value without
  // being re-created — and re-bound to the button — on every state change.
  const isPlayingRef = useRef(false);
  // The widget outlives every effect re-run; its event handlers must keep
  // firing across word and accent changes. Gate them on real unmount only,
  // never on an effect's own cleanup, or a re-render would deafen the widget.
  const mountedRef = useRef(true);

  // Re-arm on every mount so a StrictMode unmount/remount (or any remount) does
  // not leave the flag stuck false and permanently deafen a fresh widget.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Create the widget once, the first time the screen is active with a slot to
  // mount into. Media only loads for learners who open the YouGlish variant.
  // `query` is deliberately not a dependency: switching words must re-fetch on
  // the existing widget, not tear this effect down and silence its handlers.
  useEffect(() => {
    if (!active || widgetRef.current) return;
    const host = mountRef.current;
    if (!host) return;

    let disposed = false;
    setStatus('loading');

    loadYouglishApi()
      .then((YG) => {
        if (disposed || !mountedRef.current || widgetRef.current || !host) return;
        // The API replaces the element it is handed. Mount into a node React
        // does not own so unmounting will not race the swap. The widget (v4.3)
        // resolves its host by id, so the inner node must carry one.
        const inner = document.createElement('div');
        inner.id = `yg-widget-${Math.random().toString(36).slice(2)}`;
        host.appendChild(inner);
        // The widget takes a fixed pixel width; match the phone-sized card so
        // it neither overflows nor leaves a gutter.
        const width = Math.round(host.clientWidth) || 360;
        widgetRef.current = new YG.Widget(inner.id, {
          width,
          // Widget 4.3 replaces numeric 0 with its default mask (255).
          // A string zero survives that truthiness check and emits e_comp=0.
          components: components === 0 ? '0' : components,
          events: {
            onFetchDone: (event: WidgetEvent) => {
              if (!mountedRef.current) return;
              const total = event.totalResult ?? 0;
              setTotalResults(total);
              setStatus(total > 0 ? 'ready' : 'empty');
            },
            onCaptionChange: (event: WidgetEvent) => {
              if (!mountedRef.current) return;
              // The caption arrives URL-encoded (spaces as %20, the [[[ ]]]
              // markers as %5B/%5D); decode before it is rendered.
              let text = event.caption ?? null;
              if (text) {
                try {
                  text = decodeURIComponent(text);
                } catch {
                  // Leave a malformed caption as-is rather than dropping it.
                }
              }
              setCaption(text);
            },
            onPlayerStateChange: (event: WidgetEvent) => {
              if (!mountedRef.current) return;
              const playing = event.state === PLAYER_STATE_PLAYING;
              isPlayingRef.current = playing;
              setIsPlaying(playing);
            },
            onError: () => {
              if (mountedRef.current) setStatus('error');
            },
          },
        });
        if (mountedRef.current) setReady(true);
      })
      .catch(() => {
        if (!disposed && mountedRef.current) setStatus('error');
      });

    return () => {
      disposed = true;
    };
  }, [active, components, mountRef]);

  // Point the widget at the current word whenever it (or the accent) changes.
  useEffect(() => {
    if (!ready || !query || !widgetRef.current) return;
    setStatus('loading');
    setCaption(null);
    setTotalResults(0);
    try {
      widgetRef.current.fetch(query, lang, accent);
    } catch {
      setStatus('error');
    }
  }, [ready, query, lang, accent]);

  // Provider fetches can stall even after the API script has loaded.
  useEffect(() => {
    if (status !== 'loading') return;
    const timer = window.setTimeout(() => setStatus(current => current === 'loading' ? 'error' : current), 15000);
    return () => window.clearTimeout(timer);
  }, [status, query, accent]);

  // Stop audio when the screen is not visible; keep the widget for re-entry.
  useEffect(() => {
    if (!active) {
      try {
        widgetRef.current?.pause();
      } catch {
        // Nothing to pause if the widget never came up.
      }
    }
  }, [active]);

  // Tear the widget down on unmount so the iframe does not linger.
  useEffect(() => () => {
    try {
      widgetRef.current?.close();
    } catch {
      // Ignore teardown races; the node is being removed anyway.
    }
    widgetRef.current = null;
  }, []);

  const next = useCallback(() => {
    try {
      widgetRef.current?.next();
    } catch {
      // The widget may not be ready yet; the button is a no-op until it is.
    }
  }, []);

  const previous = useCallback(() => {
    try {
      widgetRef.current?.previous();
    } catch {
      // Same.
    }
  }, []);

  const replay = useCallback(() => {
    try {
      widgetRef.current?.replay();
    } catch {
      // Same.
    }
  }, []);

  const toggle = useCallback(() => {
    try {
      if (isPlayingRef.current) widgetRef.current?.pause();
      else widgetRef.current?.play();
    } catch {
      // Same.
    }
  }, []);

  const move = useCallback((seconds: number) => {
    try {
      widgetRef.current?.move(seconds);
    } catch {
      // Same.
    }
  }, []);

  const setSpeed = useCallback((rate: number) => {
    try {
      widgetRef.current?.setSpeed(rate);
    } catch {
      // Same.
    }
  }, []);

  return { status, totalResults, caption, isPlaying, toggle, move, replay, next, previous, setSpeed };
};
