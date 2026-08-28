import { FSRSItem, Rating, initFSRSFromLearn, reviewFSRS } from './fsrs';
import type { Word } from '../types';
import { WORDS } from '../data';

const STORAGE_KEYS = {
  FSRS_ITEMS: 'bubei_fsrs_items_v1',
  SETTINGS: 'bubei_user_settings_v1',
  STATS: 'bubei_user_stats_v1',
  STARRED: 'bubei_starred_words_v1',
  KNOWN: 'bubei_known_words_v1',
};

export interface UserSettings {
  dailyNewCount: number; // 每日新学词数 (5, 10, 15, 20, 30)
  pronType: string;      // '美式' | '英式'
  autoPron: string;      // '单词、例句卡片' | '仅单词' | '关闭'
  spellMode: string;     // '全部开启' | '仅新词' | '全部关闭'
  learnPace: string;     // '20 词/组'
  reviewPace: string;    // '20 词/组'
  swAudioChoice: boolean;
  swSplitMnemo: boolean;
  swConfuse: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  dailyNewCount: 5,
  pronType: '美式',
  autoPron: '单词、例句卡片',
  spellMode: '全部开启',
  learnPace: '5 词/组',
  reviewPace: '20 词/组',
  swAudioChoice: true,
  swSplitMnemo: true,
  swConfuse: false,
};

class StorageService {
  private fsrsCache: Record<string, FSRSItem> | null = null;
  private settingsCache: UserSettings | null = null;
  private starredCache: Set<string> | null = null;
  private knownCache: Set<string> | null = null;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.initDefaultFSRSIfEmpty();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }

  /**
   * 初始化预置演示复习数据（初次使用时预置 8 个到期复习单词，便于开箱即用体验）
   */
  private initDefaultFSRSIfEmpty() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.FSRS_ITEMS);
      if (!raw) {
        const initial: Record<string, FSRSItem> = {};
        const now = Date.now();
        // 预置前 8 个词作为已学完且今天已到期的复习词
        const seedWords = WORDS.slice(0, Math.min(8, WORDS.length));
        seedWords.forEach((w, idx) => {
          const id = w.id || `w_${w.w}`;
          initial[id] = {
            wordId: id,
            state: idx % 3 === 0 ? 'review' : 'review',
            stability: 2.0 + idx * 0.5,
            difficulty: 5.0,
            reps: 1 + (idx % 3),
            lapses: 0,
            lastReview: now - 3 * 24 * 60 * 60 * 1000,
            due: idx % 2 === 0 ? now - 1000 : now + 24 * 3600 * 1000,
            scheduledDays: 2,
          };
        });
        localStorage.setItem(STORAGE_KEYS.FSRS_ITEMS, JSON.stringify(initial));
        this.fsrsCache = initial;
      }
    } catch {
      // 降级支持非浏览器/无 localStorage 环境
    }
  }

  public getFSRSItems(): Record<string, FSRSItem> {
    if (this.fsrsCache) return this.fsrsCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.FSRS_ITEMS);
      if (raw) {
        this.fsrsCache = JSON.parse(raw);
        return this.fsrsCache || {};
      }
    } catch (e) {
      console.warn('Failed to load FSRS items from localStorage', e);
    }
    return {};
  }

  public saveFSRSItem(item: FSRSItem) {
    const items = this.getFSRSItems();
    items[item.wordId] = item;
    this.fsrsCache = items;
    try {
      localStorage.setItem(STORAGE_KEYS.FSRS_ITEMS, JSON.stringify(items));
    } catch (e) {
      console.warn('Failed to save FSRS item to localStorage', e);
    }
    this.notify();
  }

  /**
   * 新词学习通关毕业：录入 FSRS 复习池
   */
  public graduateWord(wordId: string, mistakeCount: number = 0): FSRSItem {
    const item = initFSRSFromLearn(wordId, mistakeCount);
    this.saveFSRSItem(item);
    return item;
  }

  /**
   * 复习完成后更新 FSRS 记忆状态
   */
  public recordReview(wordId: string, rating: Rating): FSRSItem {
    const items = this.getFSRSItems();
    const existing = items[wordId] || initFSRSFromLearn(wordId, 0);
    const updated = reviewFSRS(existing, rating);
    this.saveFSRSItem(updated);
    return updated;
  }

  /**
   * 获取所有今天到期需要复习的单词列表
   */
  public getDueWords(allWords: Word[] = WORDS, now: number = Date.now()): Word[] {
    const items = this.getFSRSItems();
    const endOfToday = new Date(now).setHours(23, 59, 59, 999);

    const dueWordIds = new Set(
      Object.values(items)
        .filter((item) => item.state === 'review' || item.state === 'relearning')
        .filter((item) => item.due <= endOfToday)
        .map((item) => item.wordId)
    );

    return allWords.filter((w) => {
      const id = w.id || `w_${w.w}`;
      return dueWordIds.has(id);
    });
  }

  /**
   * 获取所有已经学习掌握过的单词 ID 集合
   */
  public getLearnedWordIds(): Set<string> {
    const items = this.getFSRSItems();
    return new Set(Object.keys(items));
  }

  /* ---------- 收藏/生词本管理 ---------- */
  public getStarredWords(): Set<string> {
    if (this.starredCache) return this.starredCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STARRED);
      if (raw) {
        this.starredCache = new Set(JSON.parse(raw));
        return this.starredCache;
      }
    } catch {
      // ignore
    }
    this.starredCache = new Set<string>();
    return this.starredCache;
  }

  public isStarred(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    return this.getStarredWords().has(wStr);
  }

  public toggleStar(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    const starred = this.getStarredWords();
    const nextState = !starred.has(wStr);
    if (nextState) {
      starred.add(wStr);
    } else {
      starred.delete(wStr);
    }
    this.starredCache = starred;
    try {
      localStorage.setItem(STORAGE_KEYS.STARRED, JSON.stringify(Array.from(starred)));
    } catch {
      // ignore
    }
    this.notify();
    return nextState;
  }

  /* ---------- 熟词/标熟管理 ---------- */
  public getKnownWords(): Set<string> {
    if (this.knownCache) return this.knownCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.KNOWN);
      if (raw) {
        this.knownCache = new Set(JSON.parse(raw));
        return this.knownCache;
      }
    } catch {
      // ignore
    }
    this.knownCache = new Set<string>();
    return this.knownCache;
  }

  public isKnown(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    return this.getKnownWords().has(wStr);
  }

  public toggleKnown(word: string | Word): boolean {
    const wStr = typeof word === 'string' ? word.toLowerCase() : word.w.toLowerCase();
    const known = this.getKnownWords();
    const nextState = !known.has(wStr);
    if (nextState) {
      known.add(wStr);
    } else {
      known.delete(wStr);
    }
    this.knownCache = known;
    try {
      localStorage.setItem(STORAGE_KEYS.KNOWN, JSON.stringify(Array.from(known)));
    } catch {
      // ignore
    }
    this.notify();
    return nextState;
  }

  /**
   * 获取单词当前的分类状态：'unlearned' | 'reviewing' | 'completed' | 'mastered'
   */
  public getWordLearningStatus(w: Word): 'unlearned' | 'reviewing' | 'completed' | 'mastered' {
    const id = w.id || `w_${w.w}`;
    const wStr = w.w.toLowerCase();

    if (this.isKnown(wStr) || w.isMastered) {
      return 'mastered';
    }

    const items = this.getFSRSItems();
    const item = items[id];
    if (!item) {
      return 'unlearned';
    }

    const now = Date.now();
    const endOfToday = new Date(now).setHours(23, 59, 59, 999);

    if (item.due <= endOfToday) {
      return 'reviewing';
    }

    return 'completed';
  }

  /**
   * 获取用户设置
   */
  public getSettings(): UserSettings {
    if (this.settingsCache) return this.settingsCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) {
        this.settingsCache = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        return this.settingsCache!;
      }
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * 保存用户设置
   */
  public saveSettings(settings: Partial<UserSettings>): UserSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    this.settingsCache = updated;
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save settings', e);
    }
    this.notify();
    return updated;
  }

  public getDailyNewCount(): number {
    return this.getSettings().dailyNewCount;
  }

  public setDailyNewCount(count: number): void {
    this.saveSettings({
      dailyNewCount: count,
      learnPace: `${count} 词/组`,
    });
  }
}

export const storageService = new StorageService();

