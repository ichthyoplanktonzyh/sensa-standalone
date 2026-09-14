import { create } from 'zustand';
export interface RuntimePersonalContent { senseKey: string; lemma: string; guideLabelL1: string; }
import type { ReferenceExampleDeck } from '../components/ReferenceExampleViewer';
import type { QuickDictEntry, Word } from '../types';

/**
 * Every overlay that floats above the shell: the dictionary sheet, the note
 * editor, the scene editor, the popup menus and the toast.
 *
 * These sat in App as sixteen `useState`s whose only job was to let a deeply
 * nested screen raise an overlay -- so each opener was threaded down as a prop
 * through screens that merely passed it along. Holding them here lets a screen
 * open an overlay directly.
 *
 * Deliberately not in the URL, unlike the sheet stack. An overlay's subject is
 * an in-memory object (a `Word`, a `QuickDictEntry` or a bare string, chosen by
 * the caller) with no stable id to serialise, and these are transient actions
 * on the current screen rather than places worth linking to.
 *
 * Opener and closer names match what App called them, so the call sites that
 * pass them onward are unchanged.
 */
export type DictSubject = Word | QuickDictEntry | string;

export interface ExampleSheet {
  readonly senseIdx: number;
  readonly sentenceIdx: number;
}

export interface SceneEditorTarget {
  readonly content: RuntimePersonalContent;
  readonly anchorId?: string;
  readonly learningTarget?: LearningSceneEditorTarget;
}

export interface LearningSceneEditorTarget {
  readonly learningTargetId: string;
  readonly languageRouteId: string;
  readonly curriculumMembershipId: string;
  readonly senseId: string;
  readonly senseVersionId: string;
  readonly bindingVersionId: string;
}

export interface OverlayState {
  /** Lexical Reference 详情；原始柯林斯式实现保留为 baseline。 */
  readonly dictModalWord: DictSubject | null;
  readonly dictModalTab: string;
  readonly referenceExampleDeck: ReferenceExampleDeck | null;
  openDictModal: (word: DictSubject, tab?: string) => void;
  closeDictModal: () => void;
  setReferenceExampleDeck: (deck: ReferenceExampleDeck | null) => void;

  /** 独立笔记编辑全屏弹窗。 */
  readonly noteModalWord: DictSubject | null;
  readonly noteModalSense: { readonly senseId: string; readonly meaning: string } | null;
  openNoteEditor: (word?: DictSubject, senseId?: string, meaning?: string) => void;
  closeNoteEditor: () => void;

  /** 我的场景独立富媒体编辑。 */
  readonly sceneEditorTarget: SceneEditorTarget | null;
  openSceneEditor: (target: SceneEditorTarget) => void;
  closeSceneEditor: () => void;

  /** 全局弹窗菜单。 */
  readonly menuMoreOpen: boolean;
  readonly menuBookOpen: boolean;
  readonly menuPersonalContent: RuntimePersonalContent | null;
  setMenuMoreOpen: (open: boolean) => void;
  setMenuBookOpen: (open: boolean) => void;
  setMenuPersonalContent: (content: RuntimePersonalContent | null) => void;
  closeMenus: () => void;

  /**
   * 学习卡上的例句卡。开着的时候它是一份"看第几个义项、第几句"，
   * 关着的时候什么都不是——所以是一个可空对象，而不是一个布尔加两个游离的下标。
   */
  readonly exampleSheet: ExampleSheet | null;
  openExample: (senseIdx?: number, sentenceIdx?: number) => void;
  closeExample: () => void;

  /** 全局 Toast。 */
  readonly toastMsg: string;
  toast: (message: string) => void;
}

const TOAST_DURATION_MS = 1900;

/**
 * Module-scoped rather than a ref: the timer belongs to the single toast slot,
 * not to whichever component happened to raise it, so a toast fired from a
 * screen that then unmounts still clears itself on schedule.
 */
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useOverlayStore = create<OverlayState>((set) => ({
  dictModalWord: null,
  dictModalTab: '柯林斯',
  referenceExampleDeck: null,
  openDictModal: (word, tab = '柯林斯') => set({ dictModalWord: word, dictModalTab: tab }),
  closeDictModal: () => set({ referenceExampleDeck: null, dictModalWord: null }),
  setReferenceExampleDeck: (referenceExampleDeck) => set({ referenceExampleDeck }),

  noteModalWord: null,
  noteModalSense: null,
  openNoteEditor: (word, senseId, meaning) => {
    if (!word) return;
    set({
      noteModalWord: word,
      noteModalSense: senseId ? { senseId, meaning: meaning ?? '' } : null,
    });
  },
  closeNoteEditor: () => set({ noteModalWord: null, noteModalSense: null }),

  sceneEditorTarget: null,
  openSceneEditor: (sceneEditorTarget) => set({ sceneEditorTarget }),
  closeSceneEditor: () => set({ sceneEditorTarget: null }),

  menuMoreOpen: false,
  menuBookOpen: false,
  menuPersonalContent: null,
  setMenuMoreOpen: (menuMoreOpen) => set({ menuMoreOpen }),
  setMenuBookOpen: (menuBookOpen) => set({ menuBookOpen }),
  setMenuPersonalContent: (menuPersonalContent) => set({ menuPersonalContent }),
  closeMenus: () => set({ menuMoreOpen: false, menuBookOpen: false, menuPersonalContent: null }),

  exampleSheet: null,
  openExample: (senseIdx = 0, sentenceIdx = 0) => set({ exampleSheet: { senseIdx, sentenceIdx } }),
  closeExample: () => set({ exampleSheet: null }),

  toastMsg: '',
  toast: (message) => {
    set({ toastMsg: message });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => useOverlayStore.setState({ toastMsg: '' }), TOAST_DURATION_MS);
  },
}));
