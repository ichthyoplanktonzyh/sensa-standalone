type NoteListener = () => void;

const STORAGE_KEY = 'bubie_user_notes';

// 初始预置示例笔记（保持和不背单词截图对齐，例如 folk 或其他体验词）
const DEFAULT_NOTES: Record<string, string> = {
  folk: 'folk customs 民间习俗；folk song 民谣。多结合影视原声记忆！',
  river: 'cross the river 过河；up the river 坐牢（俚语）',
};

class NoteService {
  private notes: Record<string, string> = {};
  private listeners: Set<NoteListener> = new Set();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        this.notes = JSON.parse(raw);
      } else {
        this.notes = { ...DEFAULT_NOTES };
        this.save();
      }
    } catch {
      this.notes = { ...DEFAULT_NOTES };
    }
  }

  private save() {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notes));
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

  public getNoteCount(): number {
    return Object.keys(this.notes).filter((k) => !!this.notes[k].trim()).length;
  }
}

export const noteService = new NoteService();
