import type { ReferenceLookupResult } from './reference/referenceDictionary';

/**
 * 4 选 1 干扰项定义
 */
export interface Option {
  pos: string;      // 词性提示，如 "n.", "v.", "adj."
  text: string;     // 中文释义项
  ok?: boolean;     // 是否为正确项
}

/**
 * 义项群定义（支持在详情态点击虚线直达例句卡片）
 */
export interface SenseGroup {
  pos: string;      // 词性，如 "n.", "vt.", "vi."
  items: string[];  // 该词性下的所有细分义项
}

/**
 * 原生语境例句定义
 */
export type SyncedExampleMediaRender =
  | {
      kind: 'video';
      provider: 'film' | 'television' | 'youtube' | 'podcast' | 'other';
      providerLabel: string;
      playbackUrl: string;
      posterUrl?: string;
      sourceUrl?: string;
      rightsLabel?: string;
    }
  | {
      kind: 'embed';
      provider: 'youtube' | 'other';
      providerLabel: string;
      embedUrl: string;
      sourceUrl?: string;
      rightsLabel?: string;
    };

export interface Sentence {
  exampleId?: string; // 不可变 Learning Example identity
  src: string;      // 已审核的真实来源标签，或诚实的普通学习例句标签
  theme: string;    // Baseline 例句卡的旧渐变主题；Sensa viewer 不读取它
  en: string;       // 英文例句（包含 <b>word</b> 强调标签）
  zh: string;       // 对应中文译文
  audioUrl?: string;// 学习包提供的已生成例句音频
  sourceKind?: 'learning_example' | 'attested_usage';
  contextL2?: string;
  contextL1?: string;
  syncedMedia?: SyncedExampleMediaRender;
}

/**
 * 多维助记数据结构 (Tab 类别 -> [词条/词根, 释义/说明][])
 */
export type MnemoData = Record<string, [string, string][]>;

/**
 * 义项详情模型（义项维度：挂载该义项的词典双语释义与所属的原声影视例句列表）
 */
export interface SenseDetail {
  id?: string;
  pos: string;          // 词性，如 "n.", "v."
  text: string;         // 释义短语，如 "河，江"、"竞争"
  def: string;          // 该义项的完整双语词典释义 (用于全屏卡下半部分模糊与展开)
  pattern?: string;     // 句型/搭配结构框，如 "~ (between/with sb) (for sth)"
  tag?: string;         // 该义项的标签，如 "核心"、"常考"
  sentences: Sentence[];// 该义项下的获准 Learning Examples
}

/**
 * 单词完整数据模型 (Word Data Model)
 */
export interface Word {
  id?: string;            // 唯一标识
  w: string;              // 单词拼写原型
  syl: string;            // 音节拆分形式 (如 "ri·ver", "a·ban·don")
  ph: string;             // 国际音标 (如 "/ˈrɪv.ər/")
  tags?: string[];        // 词库标签 (如 ['CET-4', '考研', 'COCA'])
  total: number;          // 词库例句/出现总数 (如 20)
  def: string;            // 完整双语词典释义 (用于全屏例句卡模糊展开)
  senses: SenseGroup[];   // 结构化词性与多义项
  senseDetails?: SenseDetail[]; // 2D 义项维度影视例句映射
  options: Option[];      // Pass 1: 看词选义 4 选 1 选项
  audioOptions?: Option[];// Pass 3: 听音选义发音混淆选项
  sentences: Sentence[];  // 默认原生例句列表
  mnemo: MnemoData;       // 助记数据 (搭配、词根、派生、近义)

  // 学习运行态状态 (由调度状态机动态填充)
  level?: number;         // 掌握度 (0~4)
  badge?: string;         // 徽章 ("2", "3")
  isMastered?: boolean;   // 是否达成终极掌握
}

/**
 * 学习卡片与视图阶段枚举
 */
/** Stages owned by the formal Learn/Review runtime. */
export type FormalLearningStage =
  | 'introduction'
  | 'recognition'
  | 'recall'
  | 'transfer'
  | 'review_assessment'
  | 'review_feedback';

/**
 * 简明查词释义项 (词性 + 中文简释)
 */
export interface QuickDictSense {
  pos: string;      // 词性，如 "conj.", "n.", "vi. vt.", "adj."
  text: string;     // 中文简明释义，如 "和，与，又；加上；然后；那么"
  /** Stable identity from the normalized Reference entry, when available. */
  referenceSenseId?: string;
}

/**
 * The provider-neutral input for a contextual dictionary lookup. A plain
 * string remains a supported input for ordinary, context-free lookup.
 */
export interface DictionaryLookupRequest {
  /** The exact form the learner clicked, before lemmatization. */
  rawClickedForm: string;
  /** Immutable Example identity, never a list index or a generated UI id. */
  exampleId: string;
  /** Full, markup-free L2 text for the immutable Example. */
  textL2: string;
  /** Exact character span in textL2 occupied by the clicked surface. */
  clickedStart: number;
  clickedEnd: number;
  clickedSurface: string;
}

export type DictionaryLookupInput = string | DictionaryLookupRequest;

export type ContextualSenseResolutionStatus =
  | 'authored_target'
  | 'reviewed'
  | 'model_confident'
  | 'ambiguous'
  | 'unresolved';

/**
 * Contextual resolution metadata. Any selected id must be one of the closed
 * Reference Sense ids returned in the same lookup result.
 */
export interface ContextualSenseResolution {
  status: ContextualSenseResolutionStatus;
  referenceSenseId?: string;
  candidateReferenceSenseIds?: readonly string[];
  resolverVersion: string;
  /** Optional resolver confidence. It never changes the provider-owned entry. */
  confidence?: number;
  /** Present only when a model actually produced the closed-set decision. */
  modelId?: string;
}

/**
 * 简明词典条目模型 (用于例句点词弹窗)
 */
export interface QuickDictEntry {
  id?: string;
  word: string;               // 单词拼写原型，如 "and", "matter"
  phonetic: string;           // 国际音标，如 "/ænd/", "/ˈmætər/"
  audioUrl?: string;          // 发音音频 URL / TTS
  senses: QuickDictSense[];   // 简明释义列表
  hasFullDetail?: boolean;    // 是否在词库中有完整卡片，支持「查看详细释义 >」
  isStarred?: boolean;        // 是否加入生词本/收藏
  /** Transient UI state used while an asynchronous Reference lookup settles. */
  lookupState?: 'loading' | 'ready' | 'error';
  lookupMessage?: string;
  /** The exact normalized result that produced this quick projection. */
  referenceLookup?: ReferenceLookupResult;
}

/**
 * Explicit external dictionary support supplied to formal cards. A missing
 * entry is represented by null; learning content must never be fabricated by
 * the dictionary adapter.
 */
export type DictionaryLookup = (
  input: DictionaryLookupInput,
  options?: DictionaryLookupOptions,
) => Promise<QuickDictEntry | null>;

export interface DictionaryLookupOptions {
  signal?: AbortSignal;
}

/**
 * 例句分词 Token 结构 (用于可点击单词渲染与音频逐词播放高亮)
 */
export interface SentenceToken {
  id: string;                 // 唯一 key，如 "tok_0"
  text: string;               // 显示的原始文本 (包含相连的标点，如 "principles,")
  cleanWord: string;          // 纯单词 (剥离标点，如 "principles")
  isWord: boolean;            // 是否为有效英文单词 (空格/纯标点为 false)
  isTarget: boolean;          // 是否为当前学习卡片的主词 (来自 <b> 标签)
  charStart: number;          // 纯文本中的起始字符位置 (用于 TTS 朗读 onboundary 对齐)
  charEnd: number;            // 纯文本中的结束字符位置
}
