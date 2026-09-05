import { previewStorage } from './previewStorage';
type NoteListener = () => void;

const STORAGE_KEY = 'bubie_user_notes';
const SENSE_STORAGE_KEY = 'sensa_sense_notes_v1';

// 初始预置示例笔记（保持和不背单词截图对齐，例如 folk 或其他体验词）
const DEFAULT_NOTES: Record<string, string> = {
  folk: 'folk customs 民间习俗；folk song 民谣。多结合影视原声记忆！',
  river: 'cross the river 过河；up the river 坐牢（俚语）',
};

class NoteService {
  private notes: Record<string, string> = {};
  private senseNotes: Record<string, string> = {};
  private listeners: Set<NoteListener> = new Set();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = typeof window !== 'undefined' ? previewStorage.getItem(STORAGE_KEY) : null;
      const senseRaw = typeof window !== 'undefined' ? previewStorage.getItem(SENSE_STORAGE_KEY) : null;
      if (raw) {
        this.notes = JSON.parse(raw);
      } else {
        this.notes = { ...DEFAULT_NOTES };
      }
      this.senseNotes = senseRaw ? JSON.parse(senseRaw) : {};
      if (!raw) this.save();
    } catch {
      this.notes = { ...DEFAULT_NOTES };
      this.senseNotes = {};
    }
  }

  private save() {
    try {
      if (typeof window !== 'undefined') {
        previewStorage.setItem(STORAGE_KEY, JSON.stringify(this.notes));
        previewStorage.setItem(SENSE_STORAGE_KEY, JSON.stringify(this.senseNotes));
      }
    } catch {
      // ignore storage errors
    }
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('Note listener error:', err);
      }
    });
  }

  public subscribe(listener: NoteListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getNote(word: string): string {
    const key = word.toLowerCase().trim();
    return this.notes[key] || '';
  }

  public getSenseNote(senseId: string): string {
    return this.senseNotes[senseId] || '';
  }

  public setNote(word: string, content: string): void {
    const key = word.toLowerCase().trim();
    const trimmed = content.trim();
    if (!trimmed) {
      delete this.notes[key];
    } else {
      this.notes[key] = trimmed;
    }
    this.save();
    this.notify();
  }

  public setSenseNote(senseId: string, content: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      delete this.senseNotes[senseId];
    } else {
      this.senseNotes[senseId] = trimmed;
    }
    this.save();
    this.notify();
  }

  public deleteNote(word: string): void {
    const key = word.toLowerCase().trim();
    if (this.notes[key]) {
      delete this.notes[key];
      this.save();
      this.notify();
    }
  }

  public getAllNotes(): Record<string, string> {
    return { ...this.notes };
  }

  public getAllSenseNotes(): Record<string, string> {
    return { ...this.senseNotes };
  }

  public getNoteCount(): number {
    const legacyCount = Object.keys(this.notes).filter((k) => !!this.notes[k].trim()).length;
    const senseCount = Object.keys(this.senseNotes).filter((k) => !!this.senseNotes[k].trim()).length;
    return legacyCount + senseCount;
  }
}

export const noteService = new NoteService();
