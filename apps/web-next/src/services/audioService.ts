/**
 * 全局高保真真人发音与高品质 TTS 语音服务
 * 优先调用权威词典原声真人 MP3 发音（美音/英音，音质纯正自然，与不背单词一致）
 * 网络受限时自动平滑回退至高品质自然 Web Speech TTS
 */
class AudioService {
  private currentAudio: HTMLAudioElement | null = null;

  /**
   * 播放单词发音
   * @param word 目标英文单词
   * @param type 'us' 美式发音 (默认) | 'uk' 英式发音
   */
  public playWord(word: string, type: 'us' | 'uk' = 'us'): Promise<void> {
    return new Promise((resolve) => {
      const cleanWord = word.trim().toLowerCase();
      if (!cleanWord) {
        resolve();
        return;
      }

      // 停止上一段可能正在播放的声音
      if (this.currentAudio) {
        try {
          this.currentAudio.pause();
          this.currentAudio.currentTime = 0;
        } catch {
          // ignore
        }
      }

      const typeCode = type === 'uk' ? 1 : 2;
      // 权威高音质真人母语原声发音源（与主流英语学习 App 一致）
      const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=${typeCode}`;
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      audio.onended = () => resolve();
      audio.onerror = () => {
        // 网络异常或离线时回退至高品质系统自然语音
        this.playSpeechSynthesis(cleanWord, type);
        resolve();
      };

      audio.play().catch(() => {
        // 浏览器 Autoplay 策略或加载受限时回退
        this.playSpeechSynthesis(cleanWord, type);
        resolve();
      });
    });
  }

  /**
   * 播放整句或短语发音（智能优选高质量人声）
   */
  public playSentence(sentence: string, type: 'us' | 'uk' = 'us'): void {
    if (!sentence) return;
    this.playSpeechSynthesis(sentence, type);
  }

  /**
   * 基于 Web Speech API 的高品质语音合成（优选高分真人自然音色）
   */
  public playSpeechSynthesis(text: string, type: 'us' | 'uk' = 'us'): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = type === 'uk' ? 'en-GB' : 'en-US';
      utterance.rate = 0.92;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const langPrefix = type === 'uk' ? 'en-GB' : 'en-US';
        // 优先匹配高质量自然人声库（如 Apple Samantha / Ava / Alex / Daniel, Google US English, Microsoft Natural）
        const preferredVoice =
          voices.find(
            (v) =>
              (v.lang === langPrefix || v.lang.replace('_', '-').startsWith(langPrefix)) &&
              (v.name.includes('Natural') ||
                v.name.includes('Google') ||
                v.name.includes('Samantha') ||
                v.name.includes('Ava') ||
                v.name.includes('Karen') ||
                v.name.includes('Daniel') ||
                v.name.includes('Alex'))
          ) ||
          voices.find((v) => v.lang.startsWith('en-US')) ||
          voices.find((v) => v.lang.startsWith('en'));

        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      }
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech errors
    }
  }
}

export const audioService = new AudioService();
