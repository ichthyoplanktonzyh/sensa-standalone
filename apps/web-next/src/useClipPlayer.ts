import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Plays one time window of one embedded video.
 *
 * The real-world listening round never owns media. It hands a video id and a
 * window to an embedded YouTube player and drives it with its own controls, so
 * the surrounding UI decides what the learner sees and when.
 *
 * When there is no video id yet, or the IFrame API cannot load at all, the hook
 * falls back to a simulated clock behind the same interface. Every control in
 * the screen stays exercisable while the occurrence index is still being built.
 */

type YouTubePlayer = {
  loadVideoById(options: { videoId: string; startSeconds: number; endSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  destroy(): void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement | string, options: unknown) => YouTubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api';
const API_TIMEOUT_MS = 8000;
const TICK_MS = 100;

let apiPromise: Promise<NonNullable<Window['YT']>> | null = null;

/** Load the IFrame API once per document, and give up rather than hang. */
const loadYouTubeApi = (): Promise<NonNullable<Window['YT']>> => {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('No document'));
      return;
    }
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const timer = window.setTimeout(
      () => reject(new Error('YouTube IFrame API timed out')),
      API_TIMEOUT_MS,
    );
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube IFrame API loaded without a Player'));
    };

    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = API_SRC;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('YouTube IFrame API failed to load'));
      };
      document.head.appendChild(script);
    }
  });

  return apiPromise;
};

export type ClipPlayerStatus = 'loading' | 'embedded' | 'simulated';

export interface ClipPlayerHandle {
  status: ClipPlayerStatus;
  isPlaying: boolean;
  /** Seconds elapsed inside the clip window, not inside the source video. */
  elapsed: number;
  duration: number;
  rate: number;
  toggle(): void;
  /** Return to the entry point, which is just before the target word. */
  replay(): void;
  /** Nudge within the window. Clamped to the window, never the source video. */
  seekBy(deltaSeconds: number): void;
  /** Jump to an absolute offset inside the window. */
  seekTo(offsetSeconds: number): void;
  setRate(rate: number): void;
}

interface ClipPlayerOptions {
  /** Container the player mounts into. Unused while simulated. */
  mountRef: React.RefObject<HTMLDivElement | null>;
  videoId?: string;
  /** Window bounds, absolute in the source video. */
  startSec: number;
  endSec: number;
  /**
   * Where playback enters the window, relative to its start. The window runs
   * for a minute or more, so entering at zero would strand the listener in
   * unrelated speech well before the target word.
   */
  initialOffsetSec?: number;
  /** Tear playback down when the screen is not visible. */
  active: boolean;
}

export const useClipPlayer = ({
  mountRef,
  videoId,
  startSec,
  endSec,
  initialOffsetSec = 0,
  active,
}: ClipPlayerOptions): ClipPlayerHandle => {
  const duration = Math.max(0, endSec - startSec);
  const entry = Math.min(Math.max(0, initialOffsetSec), duration);

  const [status, setStatus] = useState<ClipPlayerStatus>(videoId ? 'loading' : 'simulated');
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRateState] = useState(1);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const rateRef = useRef(1);
  const positionRef = useRef(0);
  const entryRef = useRef(entry);
  entryRef.current = entry;

  // Create the embedded player once, only when a video id exists.
  useEffect(() => {
    if (!videoId) {
      setStatus('simulated');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    const host = mountRef.current;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host) return;
        // The API replaces the element it is given with an iframe. Mount into a
        // node React does not own, or unmounting will race with that swap.
        const inner = document.createElement('div');
        host.appendChild(inner);
        playerRef.current = new YT.Player(inner, {
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            cc_load_policy: 0,
          },
          events: {
            onReady: () => {
              if (!cancelled) setStatus('embedded');
            },
            onError: () => {
              if (!cancelled) setStatus('simulated');
            },
          },
        }) as YouTubePlayer;
      })
      .catch(() => {
        if (!cancelled) setStatus('simulated');
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // Ignore teardown races; the node is being removed anyway.
      }
      playerRef.current = null;
      if (host) host.innerHTML = '';
    };
  }, [mountRef, videoId]);

  // Point the player at the current clip whenever the occurrence changes.
  useEffect(() => {
    setIsPlaying(false);
    setElapsed(entry);
    positionRef.current = entry;

    if (status !== 'embedded' || !videoId || !playerRef.current) return;
    try {
      playerRef.current.loadVideoById({
        videoId,
        startSeconds: startSec + entry,
        endSeconds: endSec,
      });
      playerRef.current.pauseVideo();
    } catch {
      setStatus('simulated');
    }
  }, [endSec, entry, startSec, status, videoId]);

  useEffect(() => {
    if (!active) setIsPlaying(false);
  }, [active]);

  // The clock is driven by isPlaying alone. Deriving it from a callback would
  // rebuild the interval on every tick, since each tick re-renders the screen.
  useEffect(() => {
    if (!isPlaying || duration <= 0) return undefined;

    const id = window.setInterval(() => {
      let next = positionRef.current + (TICK_MS / 1000) * rateRef.current;
      if (playerRef.current) {
        try {
          next = playerRef.current.getCurrentTime() - startSec;
        } catch {
          // Keep the simulated position computed above.
        }
      }

      // The clip window is ours, not the player's. Stop at the end and stay
      // there: a finished clip never advances the round on its own.
      if (next >= duration) {
        positionRef.current = duration;
        setElapsed(duration);
        setIsPlaying(false);
        try {
          playerRef.current?.pauseVideo();
        } catch {
          // Nothing to pause while simulated.
        }
        return;
      }

      positionRef.current = Math.max(0, next);
      setElapsed(positionRef.current);
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [duration, isPlaying, startSec]);

  useEffect(() => {
    if (isPlaying) {
      try {
        playerRef.current?.playVideo();
      } catch {
        // Simulated playback needs no player.
      }
    } else {
      try {
        playerRef.current?.pauseVideo();
      } catch {
        // Same.
      }
    }
  }, [isPlaying]);

  const toggle = useCallback(() => {
    if (duration <= 0) return;
    setIsPlaying((playing) => {
      if (playing) return false;
      // Replay from the top when the previous pass already reached the end.
      if (positionRef.current >= duration) {
        positionRef.current = entryRef.current;
        setElapsed(entryRef.current);
        try {
          playerRef.current?.seekTo(startSec + entryRef.current, true);
        } catch {
          // Simulated playback restarts from the ref above.
        }
      }
      return true;
    });
  }, [duration, startSec]);

  const seekTo = useCallback((offsetSeconds: number) => {
    if (duration <= 0) return;
    const next = Math.min(duration, Math.max(0, offsetSeconds));
    positionRef.current = next;
    setElapsed(next);
    try {
      playerRef.current?.seekTo(startSec + next, true);
    } catch {
      // The simulated clock resumes from the ref above.
    }
  }, [duration, startSec]);

  const seekBy = useCallback((deltaSeconds: number) => {
    seekTo(positionRef.current + deltaSeconds);
  }, [seekTo]);

  const replay = useCallback(() => {
    if (duration <= 0) return;
    seekTo(entryRef.current);
    setIsPlaying(true);
  }, [duration, seekTo]);

  const setRate = useCallback((next: number) => {
    rateRef.current = next;
    setRateState(next);
    try {
      playerRef.current?.setPlaybackRate(next);
    } catch {
      // The simulated clock reads rateRef directly.
    }
  }, []);

  return { status, isPlaying, elapsed, duration, rate, toggle, replay, seekBy, seekTo, setRate };
};
