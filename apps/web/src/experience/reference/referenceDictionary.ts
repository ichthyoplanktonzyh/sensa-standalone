import type {
  DictionaryLookupRequest,
  ContextualSenseResolution,
  QuickDictEntry,
} from '../types';

export type ReferenceVisibility = 'reference_visible';
export type ReferenceReleaseStatus = 'prototype';

export interface ReferenceRelease {
  releaseId: string;
  provider: string;
  edition: string;
  targetLanguage: 'en';
  learnerLocale: 'zh-CN';
  rightsLabel: string;
  status: ReferenceReleaseStatus;
}

export interface ReferencePronunciation {
  pronunciationId: string;
  accent: 'en-US' | 'en-GB';
  ipa: string;
  audioUrl?: string;
}

export interface ReferenceExample {
  exampleId: string;
  textL2: string;
  textL1?: string;
  sourceLabel: string;
}

export interface ReferenceSense {
  referenceSenseId: string;
  order: number;
  partOfSpeech: string;
  /** Optional learner-language wording. Live English providers may omit it. */
  glossL1?: string;
  definitionL2?: string;
  labels?: readonly string[];
  examples?: readonly ReferenceExample[];
}

export interface ReferenceNote {
  noteId: string;
  title: string;
  bodyL1: string;
  sourceLabel: string;
}

export interface ReferenceRelation {
  relationId: string;
  relationType: 'related_form' | 'contrast' | 'usage_companion';
  label: string;
  targetHeadword: string;
}

export interface ReferenceEntry {
  referenceLexicalUnitId: string;
  releaseId: string;
  headword: string;
  visibility: ReferenceVisibility;
  pronunciations: readonly ReferencePronunciation[];
  forms?: readonly string[];
  senses: readonly ReferenceSense[];
  usageNotes?: readonly ReferenceNote[];
  morphology?: readonly ReferenceNote[];
  etymology?: readonly ReferenceNote[];
  relations?: readonly ReferenceRelation[];
  attribution: string;
}

export interface ReferenceLookupResult {
  release: ReferenceRelease;
  entry: ReferenceEntry;
  /** Present only for an exact contextual lookup. */
  request?: DictionaryLookupRequest;
  contextualResolution?: ContextualSenseResolution;
}

/** Provider-neutral resolver seam; implementations may only select closed IDs. */
export type ContextualSenseResolver = (
  request: DictionaryLookupRequest,
  entry: ReferenceEntry,
) => ContextualSenseResolution;

export const MVP_REFERENCE_RELEASE: ReferenceRelease = Object.freeze({
  releaseId: 'sensa-reference-mvp.en-zh-CN.2026-08',
  provider: 'Sensa Reference MVP',
  edition: '本地内容样本 · 2026-08',
  targetLanguage: 'en',
  learnerLocale: 'zh-CN',
  rightsLabel: '仅用于前端结构验证，不代表生产词典授权或正式发布内容',
  status: 'prototype',
});

/** Resolver metadata is part of the local MVP boundary, not a model claim. */
export const MVP_CONTEXTUAL_RESOLVER_VERSION = 'sensa-contextual-reference-mvp.v1';

interface MvpContextualAnnotation {
  exampleId: string;
  clickedStart: number;
  clickedEnd: number;
  clickedSurface: string;
  referenceSenseId: string;
  status: 'reviewed';
}

/**
 * A deliberately tiny, versioned Reference-only annotation sample. These
 * exact occurrences select from provider-owned Reference Sense ids without
 * consulting or creating a Sensa Sense alignment. All other occurrences stay
 * ambiguous or unresolved until a resolver result is available.
 */
const MVP_CONTEXTUAL_ANNOTATIONS: readonly MvpContextualAnnotation[] = Object.freeze([
  {
    exampleId: 'fragile.example.study.vase.v2',
    clickedStart: 16,
    clickedEnd: 23,
    clickedSurface: 'fragile',
    referenceSenseId: 'ref.mvp.sense.fragile.1',
    status: 'reviewed',
  },
  {
    exampleId: 'sustain.example.study.kitchen.v2',
    clickedStart: 18,
    clickedEnd: 25,
    clickedSurface: 'sustain',
    referenceSenseId: 'ref.mvp.sense.sustain.1',
    status: 'reviewed',
  },
  {
    exampleId: 'borrow.example.study.charger.v2',
    clickedStart: 2,
    clickedEnd: 10,
    clickedSurface: 'borrowed',
    referenceSenseId: 'ref.mvp.sense.borrow.1',
    status: 'reviewed',
  },
  {
    exampleId: 'lend.example.study.umbrella.v2',
    clickedStart: 10,
    clickedEnd: 14,
    clickedSurface: 'lend',
    referenceSenseId: 'ref.mvp.sense.lend.1',
    status: 'reviewed',
  },
]);

type SimpleReferenceEntry = {
  ipa: string;
  senses: readonly (readonly [partOfSpeech: string, glossL1: string])[];
};

/**
 * Independent local Reference sample. It deliberately does not read WORDS or
 * any Sense Learning Package. A production adapter can replace this table
 * without changing the UI contract.
 */
const SIMPLE_REFERENCE_ENTRIES: Readonly<Record<string, SimpleReferenceEntry>> = {
  and: { ipa: '/ænd/', senses: [['conj.', '和，与，又；加上；然后；那么']] },
  count: { ipa: '/kaʊnt/', senses: [['v.', '数数；计算；总计；重要'], ['n.', '总数；计数；伯爵']] },
  ten: { ipa: '/ten/', senses: [['num.', '十，十个']] },
  while: { ipa: '/waɪl/', senses: [['conj.', '在……期间；然而；虽然'], ['n.', '一会儿，一段时间']] },
  hide: { ipa: '/haɪd/', senses: [['v.', '隐藏，躲藏；隐瞒，掩盖'], ['n.', '兽皮；躲藏处']] },
  close: { ipa: '/kloʊz/', senses: [['v.', '关闭；结束'], ['adj.', '接近的；亲密的']] },
  eye: { ipa: '/aɪ/', senses: [['n.', '眼睛；视力；眼光'], ['v.', '注视，审视']] },
  our: { ipa: '/ˈaʊ.ər/', senses: [['det.', '我们的']] },
  we: { ipa: '/wiː/', senses: [['pron.', '我们']] },
  you: { ipa: '/juː/', senses: [['pron.', '你；你们']] },
  matter: { ipa: '/ˈmætər/', senses: [['n.', '事情，问题；物质'], ['v.', '要紧，有关系']] },
  principle: { ipa: '/ˈprɪnsəpl/', senses: [['n.', '原则；原理；信念']] },
  stand: { ipa: '/stænd/', senses: [['v.', '站立；经受；位于'], ['n.', '立场；看台；摊位']] },
  by: { ipa: '/baɪ/', senses: [['prep.', '在……旁边；通过；由；依据'], ['adv.', '经过；在旁边']] },
  my: { ipa: '/maɪ/', senses: [['det.', '我的']] },
  no: { ipa: '/noʊ/', senses: [['det.', '没有的'], ['adv.', '不，毫不'], ['n.', '否定']] },
  what: { ipa: '/wʌt/', senses: [['pron.', '什么；所……的']] },
  custom: { ipa: '/ˈkʌstəm/', senses: [['n.', '风俗；习俗；惯例'], ['adj.', '定做的，定制的']] },
  history: { ipa: '/ˈhɪstəri/', senses: [['n.', '历史；发展史；履历']] },
  go: { ipa: '/ɡoʊ/', senses: [['v.', '去；进行；运转；变成']] },
  back: { ipa: '/bæk/', senses: [['adv.', '向后；回原处'], ['n.', '背部；后面'], ['v.', '支持；倒退']] },
  least: { ipa: '/liːst/', senses: [['det./adv.', '最少；最小；最不']] },
  year: { ipa: '/jɪr/', senses: [['n.', '年；年度；岁数']] },
  have: { ipa: '/hæv/', senses: [['v.', '有；拥有；经受'], ['aux.', '用于构成完成时']] },
  these: { ipa: '/ðiːz/', senses: [['det./pron.', '这些']] },
  the: { ipa: '/ðə, ðiː/', senses: [['article', '定冠词：这；那；这些；那些']] },
  a: { ipa: '/eɪ, ə/', senses: [['article', '一个；某个']] },
  an: { ipa: '/æn, ən/', senses: [['article', '一个；某个（用于元音音素前）']] },
  in: { ipa: '/ɪn/', senses: [['prep.', '在……里面；在……期间'], ['adv.', '进入；在内']] },
  on: { ipa: '/ɑːn/', senses: [['prep.', '在……之上；关于'], ['adv.', '继续；向前']] },
  at: { ipa: '/æt/', senses: [['prep.', '在某处或某时；向；处于']] },
  for: { ipa: '/fɔːr/', senses: [['prep.', '为了；因为；给；持续'], ['conj.', '因为']] },
  with: { ipa: '/wɪð/', senses: [['prep.', '和……一起；具有；用；随着']] },
  to: { ipa: '/tuː, tə/', senses: [['prep.', '向；到；对；为了'], ['infinitive marker', '用于动词不定式']] },
  be: { ipa: '/biː/', senses: [['v.', '是；存在；处于']] },
  will: { ipa: '/wɪl/', senses: [['aux.', '将；会；愿意'], ['n.', '意志；遗嘱']] },
  intense: { ipa: '/ɪnˈtens/', senses: [['adj.', '强烈的；剧烈的；紧张的']] },
  resource: { ipa: '/ˈriːsɔːrs/', senses: [['n.', '资源；可利用的手段']] },
  result: { ipa: '/rɪˈzʌlt/', senses: [['n.', '结果；成果'], ['v.', '导致；起因于']] },
  violence: { ipa: '/ˈvaɪələns/', senses: [['n.', '暴力；猛烈，激烈']] },
  path: { ipa: '/pæθ/', senses: [['n.', '小路；路径；行动路线']] },
  folk: { ipa: '/foʊk/', senses: [['n.', '人们；民间；家人'], ['adj.', '民间的；传统的']] },
  fragile: { ipa: '/ˈfrædʒəl/', senses: [['adj.', '易碎的；脆弱的；不牢固的']] },
  sustain: { ipa: '/səˈsteɪn/', senses: [['v.', '使持续；维持；承受']] },
  borrow: { ipa: '/ˈbɑːroʊ/', senses: [['v.', '借入；借用；采用']] },
  lend: { ipa: '/lend/', senses: [['v.', '借出；提供；增添']] },
};

const FORM_TO_HEADWORD: Readonly<Record<string, string>> = {
  is: 'be', are: 'be', am: 'be', was: 'be', were: 'be', been: 'be',
  has: 'have', had: 'have', having: 'have',
  went: 'go', gone: 'go', goes: 'go', going: 'go',
  stood: 'stand', standing: 'stand',
  mattered: 'matter', matters: 'matter',
  sustained: 'sustain', sustains: 'sustain', sustaining: 'sustain',
  borrowed: 'borrow', borrows: 'borrow', borrowing: 'borrow',
  lent: 'lend', lends: 'lend', lending: 'lend',
  fragilely: 'fragile', fragility: 'fragile',
};

function makeSimpleEntry(headword: string, sample: SimpleReferenceEntry): ReferenceEntry {
  return {
    referenceLexicalUnitId: `ref.mvp.lexical-unit.${headword}`,
    releaseId: MVP_REFERENCE_RELEASE.releaseId,
    headword,
    visibility: 'reference_visible',
    pronunciations: [{
      pronunciationId: `ref.mvp.pronunciation.${headword}.us`,
      accent: 'en-US',
      ipa: sample.ipa,
    }],
    senses: sample.senses.map(([partOfSpeech, glossL1], index) => ({
      referenceSenseId: `ref.mvp.sense.${headword}.${index + 1}`,
      order: index + 1,
      partOfSpeech,
      glossL1,
    })),
    attribution: 'Sensa Reference MVP 本地编辑样本',
  };
}

const RICH_ENTRY_FIELDS: Readonly<Record<string, Partial<ReferenceEntry>>> = {
  fragile: {
    forms: ['fragile', 'fragility'],
    senses: [
      {
        referenceSenseId: 'ref.mvp.sense.fragile.1',
        order: 1,
        partOfSpeech: 'adj.',
        glossL1: '容易因碰撞、压力或搬动而损坏的；易碎的',
        definitionL2: 'Easily broken or damaged and therefore needing careful handling.',
        labels: ['常用于物品、材料或结构'],
        examples: [{
          exampleId: 'ref.mvp.example.fragile.1',
          textL2: 'The instrument is fragile, so carry it with both hands.',
          textL1: '这件仪器很易损，请用双手搬运。',
          sourceLabel: 'Sensa Reference MVP 编辑例句',
        }],
      },
      {
        referenceSenseId: 'ref.mvp.sense.fragile.2',
        order: 2,
        partOfSpeech: 'adj.',
        glossL1: '脆弱的；不稳定、容易恶化的',
        definitionL2: 'Not strong or secure and likely to fail or become worse.',
        labels: ['常用于关系、健康、经济或局势'],
      },
    ],
    usageNotes: [{
      noteId: 'ref.mvp.usage.fragile.1',
      title: '使用范围',
      bodyL1: '既可以描述会破损的实体，也可以描述不稳定的抽象状态；具体含义需由语境判断。',
      sourceLabel: 'Sensa Reference MVP 编辑说明',
    }],
    relations: [{
      relationId: 'ref.mvp.relation.fragile.fragility',
      relationType: 'related_form',
      label: '名词形式',
      targetHeadword: 'fragility',
    }],
  },
  sustain: {
    forms: ['sustain', 'sustains', 'sustained', 'sustaining'],
    senses: [
      {
        referenceSenseId: 'ref.mvp.sense.sustain.1',
        order: 1,
        partOfSpeech: 'v.',
        glossL1: '使某个活动、过程或状态继续；维持',
        definitionL2: 'To make an activity, process, or state continue over time.',
        examples: [{
          exampleId: 'ref.mvp.example.sustain.1',
          textL2: 'The new funding will sustain the project through the winter.',
          textL1: '新的资金将使项目得以持续到冬季结束。',
          sourceLabel: 'Sensa Reference MVP 编辑例句',
        }],
      },
      {
        referenceSenseId: 'ref.mvp.sense.sustain.2',
        order: 2,
        partOfSpeech: 'v.',
        glossL1: '承受损伤、损失或压力',
        definitionL2: 'To experience or suffer damage, loss, or injury.',
      },
    ],
    usageNotes: [{
      noteId: 'ref.mvp.usage.sustain.1',
      title: '常见搭配',
      bodyL1: '常见宾语包括 growth、attention、effort、service 和 injury；不同搭配可能对应不同义项。',
      sourceLabel: 'Sensa Reference MVP 编辑说明',
    }],
    relations: [{
      relationId: 'ref.mvp.relation.sustain.sustainable',
      relationType: 'related_form',
      label: '相关形容词',
      targetHeadword: 'sustainable',
    }],
  },
  borrow: {
    forms: ['borrow', 'borrows', 'borrowed', 'borrowing'],
    senses: [{
      referenceSenseId: 'ref.mvp.sense.borrow.1',
      order: 1,
      partOfSpeech: 'v.',
      glossL1: '从别人那里暂时取得某物，之后归还；借入',
      definitionL2: 'To take and use something that belongs to someone else, intending to return it.',
      examples: [{
        exampleId: 'ref.mvp.example.borrow.1',
        textL2: 'Could I borrow your charger for an hour?',
        textL1: '我能借用你的充电器一小时吗？',
        sourceLabel: 'Sensa Reference MVP 编辑例句',
      }],
    }],
    usageNotes: [{
      noteId: 'ref.mvp.usage.borrow.1',
      title: '方向',
      bodyL1: 'borrow 从“取得者”的视角表达借入；不要与从“提供者”视角表达借出的 lend 混用。',
      sourceLabel: 'Sensa Reference MVP 编辑说明',
    }],
    relations: [{
      relationId: 'ref.mvp.relation.borrow.lend',
      relationType: 'contrast',
      label: '方向对比',
      targetHeadword: 'lend',
    }],
  },
  lend: {
    forms: ['lend', 'lends', 'lent', 'lending'],
    senses: [{
      referenceSenseId: 'ref.mvp.sense.lend.1',
      order: 1,
      partOfSpeech: 'v.',
      glossL1: '把自己的某物暂时给别人使用；借出',
      definitionL2: 'To give something to someone for a limited time, expecting it to be returned.',
      examples: [{
        exampleId: 'ref.mvp.example.lend.1',
        textL2: 'I can lend you my charger until this evening.',
        textL1: '我的充电器可以借给你用到今晚。',
        sourceLabel: 'Sensa Reference MVP 编辑例句',
      }],
    }],
    usageNotes: [{
      noteId: 'ref.mvp.usage.lend.1',
      title: '方向',
      bodyL1: 'lend 从“提供者”的视角表达借出；取得者使用 borrow 表达借入。',
      sourceLabel: 'Sensa Reference MVP 编辑说明',
    }],
    relations: [{
      relationId: 'ref.mvp.relation.lend.borrow',
      relationType: 'contrast',
      label: '方向对比',
      targetHeadword: 'borrow',
    }],
  },
};

function normalizeQuery(rawWord: string): string {
  return rawWord
    .trim()
    .toLocaleLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
}

function resolveHeadword(rawWord: string): string | null {
  const normalized = normalizeQuery(rawWord);
  if (!normalized) return null;
  if (SIMPLE_REFERENCE_ENTRIES[normalized]) return normalized;
  if (FORM_TO_HEADWORD[normalized]) return FORM_TO_HEADWORD[normalized];

  if (normalized.endsWith('ies') && normalized.length > 4) {
    const candidate = `${normalized.slice(0, -3)}y`;
    if (SIMPLE_REFERENCE_ENTRIES[candidate]) return candidate;
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 3) {
    const candidate = normalized.slice(0, -1);
    if (SIMPLE_REFERENCE_ENTRIES[candidate]) return candidate;
  }
  if (normalized.endsWith('ed') && normalized.length > 4) {
    const candidate = normalized.slice(0, -2);
    if (SIMPLE_REFERENCE_ENTRIES[candidate]) return candidate;
  }
  if (normalized.endsWith('ing') && normalized.length > 5) {
    const candidate = normalized.slice(0, -3);
    if (SIMPLE_REFERENCE_ENTRIES[candidate]) return candidate;
  }
  return null;
}

export function lookupReferenceEntry(rawWord: string): ReferenceLookupResult | null {
  const headword = resolveHeadword(rawWord);
  if (!headword) return null;
  const sample = SIMPLE_REFERENCE_ENTRIES[headword];
  if (!sample) return null;

  const baseEntry = makeSimpleEntry(headword, sample);
  const richFields = RICH_ENTRY_FIELDS[headword];
  const entry = richFields ? { ...baseEntry, ...richFields } : baseEntry;

  return { release: MVP_REFERENCE_RELEASE, entry };
}

function isValidContextualRequest(request: DictionaryLookupRequest): boolean {
  if (!request.exampleId.trim() || !request.textL2) return false;
  if (!request.rawClickedForm.trim() || !request.clickedSurface) return false;
  if (!Number.isInteger(request.clickedStart) || !Number.isInteger(request.clickedEnd)) return false;
  if (request.clickedStart < 0 || request.clickedEnd <= request.clickedStart) return false;
  if (request.clickedEnd > request.textL2.length) return false;
  return request.textL2.slice(request.clickedStart, request.clickedEnd) === request.clickedSurface;
}

export const resolveContextualSense: ContextualSenseResolver = (
  request,
  entry,
): ContextualSenseResolution => {
  const closedReferenceSenseIds = entry.senses.map((sense) => sense.referenceSenseId);

  if (!isValidContextualRequest(request)) {
    return {
      status: 'unresolved',
      resolverVersion: MVP_CONTEXTUAL_RESOLVER_VERSION,
    };
  }

  const annotation = MVP_CONTEXTUAL_ANNOTATIONS.find((candidate) =>
    candidate.exampleId === request.exampleId
    && candidate.clickedStart === request.clickedStart
    && candidate.clickedEnd === request.clickedEnd
    && candidate.clickedSurface === request.clickedSurface
    && candidate.clickedSurface.toLocaleLowerCase() === request.rawClickedForm.trim().toLocaleLowerCase()
    && candidate.referenceSenseId.startsWith(`ref.mvp.sense.${entry.headword}.`)
    && closedReferenceSenseIds.includes(candidate.referenceSenseId),
  );
  if (annotation) {
    return {
      status: annotation.status,
      referenceSenseId: annotation.referenceSenseId,
      resolverVersion: MVP_CONTEXTUAL_RESOLVER_VERSION,
    };
  }

  // The local MVP has no reviewed non-target occurrence annotations yet. A
  // multi-sense entry is therefore honestly ambiguous; a single-sense entry
  // remains unresolved because no occurrence annotation has been reviewed.
  if (closedReferenceSenseIds.length > 1) {
    return {
      status: 'ambiguous',
      candidateReferenceSenseIds: closedReferenceSenseIds,
      resolverVersion: MVP_CONTEXTUAL_RESOLVER_VERSION,
    };
  }

  return {
    status: 'unresolved',
    resolverVersion: MVP_CONTEXTUAL_RESOLVER_VERSION,
  };
};

/**
 * Contextual lookup over an immutable Example and exact clicked span. The
 * returned entry always contains every visible Reference Sense; contextual
 * resolution only adds bounded emphasis metadata.
 */
export function lookupReferenceContextual(
  request: DictionaryLookupRequest,
): ReferenceLookupResult | null {
  const baseResult = lookupReferenceEntry(request.rawClickedForm);
  if (!baseResult) return null;

  const frozenRequest = Object.freeze({ ...request });
  return {
    ...baseResult,
    request: frozenRequest,
    contextualResolution: resolveContextualSense(frozenRequest, baseResult.entry),
  };
}

export function projectReferenceEntryToQuick(
  result: ReferenceLookupResult,
): QuickDictEntry {
  const pronunciation = result.entry.pronunciations[0];
  const quickSenses = referenceSensesForDisplay(result);
  return {
    id: result.entry.referenceLexicalUnitId,
    word: result.entry.headword,
    phonetic: pronunciation?.ipa ?? '',
    audioUrl: pronunciation?.audioUrl,
    senses: quickSenses.map((sense) => ({
      pos: sense.partOfSpeech,
      text: sense.glossL1 ?? sense.definitionL2 ?? 'Definition unavailable',
      referenceSenseId: sense.referenceSenseId,
    })),
    hasFullDetail: true,
    isStarred: false,
    referenceLookup: result,
  };
}

/**
 * Promote one closed-set contextual match without mutating provider-owned
 * ordering. Remaining senses keep their original relative order.
 */
export function referenceSensesForDisplay(
  result: ReferenceLookupResult,
): readonly ReferenceSense[] {
  const resolution = result.contextualResolution;
  const selectedSenseId = resolution && (
    resolution.status === 'authored_target'
    || resolution.status === 'reviewed'
    || resolution.status === 'model_confident'
  )
    ? resolution.referenceSenseId
    : undefined;
  if (!selectedSenseId) return result.entry.senses;
  const selected = result.entry.senses.find(
    (sense) => sense.referenceSenseId === selectedSenseId,
  );
  if (!selected) return result.entry.senses;
  return [
    selected,
    ...result.entry.senses.filter(
      (sense) => sense.referenceSenseId !== selectedSenseId,
    ),
  ];
}

export function lookupReferenceQuickEntry(
  input: string | DictionaryLookupRequest,
): QuickDictEntry | null {
  const result = typeof input === 'string'
    ? lookupReferenceEntry(input)
    : lookupReferenceContextual(input);
  return result ? projectReferenceEntryToQuick(result) : null;
}
