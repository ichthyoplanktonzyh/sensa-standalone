import { bundledLearningCatalog } from '../../learning/content/bundledLearningContent';
import { activeSpeechLanguage } from './speechLanguage';

export interface AudioPlaybackOptions {
  playbackRate?: number;
}

const normalizedPlaybackRate = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(0.5, value ?? 1));
};

/**
 * Audio service with an explicit Package path and an isolated legacy path.
 * Formal Learning/Review callers provide or resolve approved Package media;
 * Reference/legacy callers may still use the historical network/TTS adapter.
 */
class AudioService {
  private currentAudio: HTMLAudioElement | null = null;
  private currentPlaybackResolve: (() => void) | null = null;
  private currentSpeechCancel: (() => void) | null = null;

  /** Pause the current asset without completing its playback Promise. */
  public pause(): boolean {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
      return true;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const synthesis = window.speechSynthesis;
      if (synthesis.speaking && !synthesis.paused) {
        synthesis.pause();
        return true;
      }
    }
    return false;
  }

  /** Resume a paused asset. Returns false when no resumable asset exists. */
  public async resume(): Promise<boolean> {
    if (this.currentAudio?.paused) {
      try {
        await this.currentAudio.play();
        return true;
      } catch {
        return false;
      }
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const synthesis = window.speechSynthesis;
      if (synthesis.speaking && synthesis.paused) {
        synthesis.resume();
        return true;
      }
    }
    return false;
  }

  /** Stop any active HTML audio or speech-synthesis playback. */
  public stop(): void {
    const audio = this.currentAudio;
    this.currentAudio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // ignore
      }
    }

    const cancelSpeech = this.currentSpeechCancel;
    this.currentSpeechCancel = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    cancelSpeech?.();

    const resolvePlayback = this.currentPlaybackResolve;
    this.currentPlaybackResolve = null;
    resolvePlayback?.();
  }

  /**
   * 播放单词发音
   * @param word 目标语言单词
   * @param type 'us' 美式发音 (默认) | 'uk' 英式发音；仅英语有意义
   *
   * The language is the learner's active target language, read per playback.
   * Approved Package media wins; otherwise every language uses the device voice.
   * Reference playback must not depend on an unlicensed dictionary endpoint.
   */
  public async playWord(
    word: string,
    type: 'us' | 'uk' = 'us',
    options: AudioPlaybackOptions = {},
  ): Promise<void> {
    const { speechLocale } = await activeSpeechLanguage();
    const english = speechLocale.startsWith('en');
    const cleanWord = word.trim().toLocaleLowerCase(speechLocale);
    if (!cleanWord) return;
    const packagedUrl = bundledLearningCatalog.resolvePronunciationAudioUrl(
      cleanWord,
      english ? (type === 'uk' ? 'en-GB' : 'en-US') : speechLocale,
    );
    if (packagedUrl) {
      return this.playAudioAsset(packagedUrl, cleanWord, type, false, options);
    }
    this.stop();
    return this.startSpeechSynthesis(cleanWord, type, options, speechLocale);
  }

  /** Play a legacy audio URL, falling back to local speech synthesis. */
  public playAudioUrl(
    audioUrl: string,
    fallbackText: string,
    type: 'us' | 'uk' = 'us',
    options: AudioPlaybackOptions = {},
  ): Promise<void> {
    return this.playAudioAsset(audioUrl, fallbackText, type, true, options);
  }

  /**
   * Play a media URI declared by the installed Learning Package. A missing or
   * broken package asset fails closed; it must never be replaced with a
   * network dictionary URL or device TTS.
   */
  public playPackagedAudioUrl(
    audioUrl: string,
    label: string,
    type: 'us' | 'uk' = 'us',
    options: AudioPlaybackOptions = {},
  ): Promise<void> {
    return this.playAudioAsset(audioUrl, label, type, false, options);
  }

  private async playAudioAsset(
    audioUrl: string,
    fallbackText: string,
    type: 'us' | 'uk',
    allowSpeechFallback: boolean,
    options: AudioPlaybackOptions,
  ): Promise<void> {
    // The fallback voice speaks the learner's target language, so it is resolved
    // only where a fallback is actually possible; a package asset that must fail
    // closed never waits on the library.
    const speechLocale = allowSpeechFallback
      ? (await activeSpeechLanguage()).speechLocale
      : undefined;
    return new Promise((resolve) => {
      this.stop();
      const audio = new Audio(audioUrl);
      audio.playbackRate = normalizedPlaybackRate(options.playbackRate);
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        if (this.currentPlaybackResolve === finish) {
          this.currentPlaybackResolve = null;
        }
        resolve();
      };

      const fallbackToSpeech = () => {
        if (settled || this.currentPlaybackResolve !== finish) return;
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        // Keep the same Promise open while the fallback voice finishes.
        void this.startSpeechSynthesis(fallbackText, type, options, speechLocale).then(finish);
      };

      this.currentPlaybackResolve = finish;
      this.currentAudio = audio;

      audio.onended = finish;
      audio.onerror = allowSpeechFallback ? fallbackToSpeech : finish;

      audio.play().catch(allowSpeechFallback ? fallbackToSpeech : finish);
    });
  }

  /**
   * 播放整句或短语发音（智能优选高质量人声）
   * The returned Promise resolves at the end of speech or when stop() cancels it.
   */
  public async playSentence(
    sentence: string,
    type: 'us' | 'uk' = 'us',
    options: AudioPlaybackOptions = {},
  ): Promise<void> {
    if (!sentence) return;
    const { speechLocale } = await activeSpeechLanguage();
    const english = speechLocale.startsWith('en');
    const packagedUrl = bundledLearningCatalog.resolveExampleAudioUrl(
      sentence,
      english ? (type === 'uk' ? 'en-GB' : 'en-US') : speechLocale,
    );
    if (packagedUrl) {
      return this.playAudioAsset(packagedUrl, sentence, type, false, options);
    }
    this.stop();
    return this.startSpeechSynthesis(sentence, type, options, speechLocale);
  }

  /**
   * 基于 Web Speech API 的高品质语音合成（优选高分真人自然音色）
   * Existing callers may ignore the returned Promise.
   */
  public async playSpeechSynthesis(
    text: string,
    type: 'us' | 'uk' = 'us',
    options: AudioPlaybackOptions = {},
  ): Promise<void> {
    if (!text) return;
    const { speechLocale } = await activeSpeechLanguage();
    this.stop();
    return this.startSpeechSynthesis(text, type, options, speechLocale);
  }

  private startSpeechSynthesis(
    text: string,
    type: 'us' | 'uk',
    options: AudioPlaybackOptions = {},
    speechLocale = 'en-US',
  ): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve();

    return new Promise((resolve) => {
      const synthesis = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.currentSpeechCancel === cancel) {
          this.currentSpeechCancel = null;
        }
        resolve();
      };

      // stop() cancels the browser utterance first, then calls this resolver.
      const cancel = () => finish();
      this.currentSpeechCancel = cancel;
      utterance.onend = finish;
      utterance.onerror = finish;
      // A learner reads the target language, so the voice has to be one: asking
      // for English over Spanish text is a wrong pronunciation presented as the
      // word's. The accent only chooses between the two locales English has.
      const locale = speechLocale.startsWith('en')
        ? (type === 'uk' ? 'en-GB' : 'en-US')
        : speechLocale;
      utterance.lang = locale;
      utterance.rate = normalizedPlaybackRate(options.playbackRate) * 0.92;
      utterance.pitch = 1.0;

      const voices = synthesis.getVoices();
      if (voices && voices.length > 0) {
        const normalize = (lang: string) => lang.replace('_', '-');
        const primary = locale.split('-')[0]!;
        const pools = [
          voices.filter((voice) => normalize(voice.lang).startsWith(locale)),
          voices.filter((voice) => normalize(voice.lang).startsWith(primary)),
        ];
        const pool = pools[0]!.length > 0 ? pools[0]! : pools[1]!;
        // 优先匹配高质量自然人声库（如 Apple Samantha / Ava / Alex / Daniel, Google US English, Microsoft Natural）
        const preferredVoice = locale.startsWith('en')
          ? pool.find(
              (voice) =>
                voice.name.includes('Natural') ||
                voice.name.includes('Google') ||
                voice.name.includes('Samantha') ||
                voice.name.includes('Ava') ||
                voice.name.includes('Karen') ||
                voice.name.includes('Daniel') ||
                voice.name.includes('Alex'),
            ) ?? pool[0]
          : pool[0];

        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      }

      try {
        synthesis.speak(utterance);
      } catch {
        finish();
      }
    });
  }
}

export const audioService = new AudioService();
