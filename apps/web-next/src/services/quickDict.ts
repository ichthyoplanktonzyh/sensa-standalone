import type {
  DictionaryLookupInput,
  DictionaryLookupOptions,
  QuickDictEntry,
  QuickDictSense,
} from '../types';
import { WORDS } from '../data';
import {
  lookupReferenceQuickEntry,
  projectReferenceEntryToQuick,
  type ReferenceLookupResult,
} from '../reference/referenceDictionary';
import {
  lookupReference,
} from '../reference/referenceLookup';

/**
 * 离线微词典内置词库 (涵盖高频基础词与截图中的示例词)
 */
const BUILTIN_DICT: Record<string, { ph: string; senses: QuickDictSense[] }> = {
  // 截图 1 对应词
  'and': {
    ph: '/ænd/',
    senses: [
      { pos: 'conj.', text: '和，与，又；加上；然后；那么' },
    ],
  },
  'count': {
    ph: '/kaʊnt/',
    senses: [
      { pos: 'v.', text: '数数；计算；总计；重要，有价值' },
      { pos: 'n.', text: '总数；计数；伯爵' },
    ],
  },
  'ten': {
    ph: '/ten/',
    senses: [
      { pos: 'num.', text: '十，十个' },
    ],
  },
  'while': {
    ph: '/waɪl/',
    senses: [
      { pos: 'conj.', text: '在……期间，当……的时候；然而；虽然' },
      { pos: 'n.', text: '一会儿，一段时间' },
    ],
  },
  'hide': {
    ph: '/haɪd/',
    senses: [
      { pos: 'v.', text: '隐藏，躲藏；隐瞒，掩盖' },
      { pos: 'n.', text: '兽皮；躲藏处' },
    ],
  },
  'close': {
    ph: '/kloʊz/',
    senses: [
      { pos: 'v.', text: '关闭，合上；结束，终止' },
      { pos: 'adj.', text: '紧密的；接近的；亲密的' },
    ],
  },
  'eye': {
    ph: '/aɪ/',
    senses: [
      { pos: 'n.', text: '眼睛；视力；见解，眼光' },
      { pos: 'v.', text: '注视，审视' },
    ],
  },
  'our': {
    ph: '/ˈaʊ.ər/',
    senses: [
      { pos: 'pron.', text: '我们的' },
    ],
  },
  'we': {
    ph: '/wiː/',
    senses: [
      { pos: 'pron.', text: '我们' },
    ],
  },
  'you': {
    ph: '/juː/',
    senses: [
      { pos: 'pron.', text: '你，你们' },
    ],
  },

  // 截图 2 对应词
  'matter': {
    ph: '/ˈmætər/',
    senses: [
      { pos: 'n.', text: '事情，问题；事态；物质' },
      { pos: 'vi. vt.', text: '要紧' },
    ],
  },
  'principle': {
    ph: '/ˈprɪnsəpl/',
    senses: [
      { pos: 'n.', text: '原则，原理，定律；信念' },
    ],
  },
  'stand': {
    ph: '/stænd/',
    senses: [
      { pos: 'v.', text: '站立，起立；经受，忍受；位于' },
      { pos: 'n.', text: '立场；看台；摊位' },
    ],
  },
  'by': {
    ph: '/baɪ/',
    senses: [
      { pos: 'prep.', text: '在……旁边；通过；被，由；依据' },
      { pos: 'adv.', text: '经过；在旁边' },
    ],
  },
  'my': {
    ph: '/maɪ/',
    senses: [
      { pos: 'pron.', text: '我的' },
    ],
  },
  'no': {
    ph: '/noʊ/',
    senses: [
      { pos: 'adj.', text: '没有的；绝非' },
      { pos: 'adv.', text: '不，毫不' },
      { pos: 'n.', text: '否定，反对票' },
    ],
  },
  'what': {
    ph: '/wʌt/',
    senses: [
      { pos: 'pron.', text: '什么，怎么样；所……的' },
    ],
  },

  // 其他常见例句高频词
  'custom': {
    ph: '/ˈkʌs.təm/',
    senses: [
      { pos: 'n.', text: '风俗，习俗，惯例；海关 (customs)' },
      { pos: 'adj.', text: '定做的，定制的' },
    ],
  },
  'history': {
    ph: '/ˈhɪs.tər.i/',
    senses: [
      { pos: 'n.', text: '历史，历史学；发展史，履历' },
    ],
  },
  'go': {
    ph: '/ɡoʊ/',
    senses: [
      { pos: 'v.', text: '去，走；进行；运转；变成' },
    ],
  },
  'back': {
    ph: '/bæk/',
    senses: [
      { pos: 'adv.', text: '向后，回原处；以前' },
      { pos: 'n.', text: '背部；后面' },
      { pos: 'v.', text: '支持；倒退' },
    ],
  },
  'least': {
    ph: '/liːst/',
    senses: [
      { pos: 'adj. adv.', text: '最少，最小；最不' },
      { pos: 'n.', text: '最少量' },
    ],
  },
  'year': {
    ph: '/jɪər/',
    senses: [
      { pos: 'n.', text: '年，年份；年度；岁数' },
    ],
  },
  'have': {
    ph: '/hæv/',
    senses: [
      { pos: 'v.', text: '有，拥有；进行；经受；吃，喝' },
      { pos: 'aux.', text: '已经 (完成时助动词)' },
    ],
  },
  'these': {
    ph: '/ðiːz/',
    senses: [
      { pos: 'pron. adj.', text: '这些' },
    ],
  },
  'the': {
    ph: '/ðə/',
    senses: [
      { pos: 'art.', text: '这，那；这些，那些 (定冠词)' },
    ],
  },
  'a': {
    ph: '/eɪ, ə/',
    senses: [
      { pos: 'art.', text: '一，一个 (不定冠词)' },
    ],
  },
  'an': {
    ph: '/æn, ən/',
    senses: [
      { pos: 'art.', text: '一，一个 (用于元音音素前)' },
    ],
  },
  'in': {
    ph: '/ɪn/',
    senses: [
      { pos: 'prep.', text: '在……里面；在……期间；处于……状态' },
      { pos: 'adv.', text: '进入；在内' },
    ],
  },
  'on': {
    ph: '/ɒn/',
    senses: [
      { pos: 'prep.', text: '在……之上；关于；在……时候' },
      { pos: 'adv.', text: '向前；穿着；活动着' },
    ],
  },
  'at': {
    ph: '/æt/',
    senses: [
      { pos: 'prep.', text: '在 (某处/某时间)；向，朝；处于' },
    ],
  },
  'for': {
    ph: '/fɔːr/',
    senses: [
      { pos: 'prep.', text: '为了；因为；代表；给；持续' },
      { pos: 'conj.', text: '因为，由于' },
    ],
  },
  'with': {
    ph: '/wɪð/',
    senses: [
      { pos: 'prep.', text: '和……一起；具有；用；随着' },
    ],
  },
  'to': {
    ph: '/tuː/',
    senses: [
      { pos: 'prep.', text: '向，往；到；对；为了' },
    ],
  },
  'is': {
    ph: '/ɪz/',
    senses: [
      { pos: 'v.', text: '是 (be 的第三人称单数形式)' },
    ],
  },
  'are': {
    ph: '/ɑːr/',
    senses: [
      { pos: 'v.', text: '是 (be 的复数和第二人称形式)' },
    ],
  },
  'will': {
    ph: '/wɪl/',
    senses: [
      { pos: 'aux.', text: '将，将会；愿意' },
      { pos: 'n.', text: '意志；决心；遗嘱' },
    ],
  },
  'intense': {
    ph: '/ɪnˈtens/',
    senses: [
      { pos: 'adj.', text: '强烈的，剧烈的；紧张的；热情的' },
    ],
  },
  'resource': {
    ph: '/ˈriːsɔːs/',
    senses: [
      { pos: 'n.', text: '资源，财力；谋略' },
    ],
  },
  'result': {
    ph: '/rɪˈzʌlt/',
    senses: [
      { pos: 'n.', text: '结果，成果；成绩' },
      { pos: 'v.', text: '导致；起因于' },
    ],
  },
  'violence': {
    ph: '/ˈvaɪələns/',
    senses: [
      { pos: 'n.', text: '暴力，暴行；激烈，狂暴' },
    ],
  },
};

function lookupLegacyEntry(rawWord: string): QuickDictEntry | null {
  const clean = rawWord.trim().replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
  const lowerClean = clean.toLowerCase();

  // 1. 优先查主词库 WORDS
  const targetInWords = WORDS.find(
    (item) =>
      item.w.toLowerCase() === lowerClean ||
      item.syl.replace(/[·\s]/g, '').toLowerCase() === lowerClean
  );

  if (targetInWords) {
    const senses: QuickDictSense[] = targetInWords.senses.map((s) => ({
      pos: s.pos,
      text: s.items.join('；'),
    }));

    return {
      id: targetInWords.id,
      word: targetInWords.w,
      phonetic: targetInWords.ph,
      senses: senses.length > 0 ? senses : [{ pos: 'n./v.', text: targetInWords.def || '暂无释义' }],
      hasFullDetail: true,
      isStarred: false,
    };
  }

  // 2. 查离线微词典 BUILTIN_DICT
  const dictHitKey = BUILTIN_DICT[lowerClean] ? lowerClean : null;

  if (dictHitKey) {
    const data = BUILTIN_DICT[dictHitKey];
    return {
      word: dictHitKey,
      phonetic: data.ph,
      senses: data.senses,
      hasFullDetail: false,
      isStarred: false,
    };
  }

  return null;
}

/**
 * Explicit online Reference lookup for formal learning cards. It never
 * projects WORDS, the legacy micro-dictionary, a local Reference sample or a
 * Sense Learning Package into a dictionary entry.
 */
export interface DictionaryLookupResponse {
  input: DictionaryLookupInput;
  referenceResult: ReferenceLookupResult | null;
  entry: QuickDictEntry | null;
}

/**
 * Provider-neutral lookup boundary used by the app. Providers are normalized
 * before the UI sees them; contextual metadata stays attached to the same
 * result that produced the quick projection.
 */
export async function lookupDictionary(
  input: DictionaryLookupInput,
  options: DictionaryLookupOptions = {},
): Promise<DictionaryLookupResponse> {
  const referenceResult = await lookupReference(input, { signal: options.signal });

  return {
    input,
    referenceResult,
    entry: referenceResult ? projectReferenceEntryToQuick(referenceResult) : null,
  };
}

export async function lookupDictionaryEntry(
  input: DictionaryLookupInput,
  options: DictionaryLookupOptions = {},
): Promise<QuickDictEntry | null> {
  return (await lookupDictionary(input, options)).entry;
}

/**
 * Legacy lookup adapter used by non-formal surfaces. It keeps the historical
 * permissive placeholder behavior for old dictionary UI while formal cards
 * receive lookupDictionaryEntry explicitly.
 */
export function lookupWord(rawWord: string): QuickDictEntry {
  const knownEntry = lookupLegacyEntry(rawWord) ?? lookupReferenceQuickEntry(rawWord);
  if (knownEntry) return knownEntry;

  const clean = rawWord.trim().replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');

  // 3. 通用兜底条目 (legacy only)
  return {
    word: clean || rawWord,
    phonetic: `/${(clean || rawWord).toLowerCase()}/`,
    senses: [
      {
        pos: 'word',
        text: `点击朗读，可加入生词本随时复习`,
      },
    ],
    hasFullDetail: false,
    isStarred: false,
  };
}
