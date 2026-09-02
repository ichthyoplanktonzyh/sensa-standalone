/**
 * Deterministic Sense Construction scenarios for the mock Semantic LLM.
 *
 * These fixtures cover the boundary cases the task requires:
 *   1. 借伞 receive direction  → borrow
 *   2. 借伞 give direction      → lend  (sibling Focus of the same experience)
 *   3. adjacent meanings        → tactful / diplomatic / considerate contrasts
 *   4. reuse existing           → confirm returns a pre-seeded stable Sense
 *   5. no suitable expression   → typed non-word candidates, stays expression-pending
 * There is intentionally no generic fallback: an unmatched Personal Meaning
 * must remain unclarified instead of receiving a fake proposal or expression.
 *
 * Everything here is pure data + pure matching. No randomness, no I/O.
 */

import type {
  ConstructionTurnContext,
  MeaningFocusSuggestion,
  SenseProposalDraft,
  SemanticLlmProvenance,
} from './semanticLlm';

export const MOCK_PROVENANCE: SemanticLlmProvenance = {
  provider: 'mock',
  model: 'sensa-semantic-mock',
  promptVersion: 'personal-meaning-journey-mock-v1',
};

export const MOCK_SEMANTIC_POLICY_VERSION = 'sensa-semantic-policy-mock-v1';

export type ProposalCore = Omit<
  SenseProposalDraft,
  'provenance' | 'semanticPolicyVersion'
>;

export interface ScenarioFocus {
  suggestion: MeaningFocusSuggestion;
  /** Re-identify this focus after the learner edits its statement. */
  matchesFocus: (focusStatement: string) => boolean;
  boundaryQuestion: string;
  boundaryOptions: string[];
  proposal: ProposalCore;
}

export interface Scenario {
  id: string;
  matches: (materialText: string) => boolean;
  multipleAspects: boolean;
  focuses: ScenarioFocus[];
  /** Sense keys treated as already existing, so confirming reuses them. */
  seededSenseKeys: string[];
}

const includes = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

const umbrellaBorrow: ScenarioFocus = {
  suggestion: {
    statement: '从他人那里暂时取得某物，用完之后归还',
    aspectLabel: '接收方向',
    distinguishingNotes: [
      '重点在“我这边暂时得到了东西”',
      '默认之后要还回去，不是收下当礼物',
    ],
  },
  matchesFocus: (statement) =>
    includes(statement, ['取得', '得到', '借来', '接收', '拿到', '向']),
  boundaryQuestion:
    '这次“借”一定会归还吗？如果对方说不用还、直接送你，还算同一个意思吗？',
  boundaryOptions: [
    '一定会归还，只是暂时使用',
    '可以不归还（那是“收下/赠送”，不是这个意思）',
  ],
  proposal: {
    proposedSenseKey: 'sensa:borrow-receive',
    coreMeaningFocus: '从他人处暂时取得某物，默认使用后归还（取得方向）',
    prototypeScenes: [
      {
        summary: '下雨天同事把伞递给我，我用完后还给他',
        participantRoles: ['取用者（我）', '物主（同事）', '物品（伞）'],
        states: ['物品暂时在取用者手中', '物权仍属物主', '预期之后归还'],
        directionOrCausality: '物品从物主暂时转移到取用者，方向：取得',
      },
    ],
    includedCases: ['向朋友借钱后归还', '借用图书馆的书', '借邻居的工具'],
    excludedCases: [
      '别人把东西送给我、不用归还',
      '我把东西借给别人（给予方向）',
      '永久买下某物',
    ],
    neighborContrasts: [
      {
        label: 'lend（借出）',
        distinction: 'lend 是把东西交给别人；这里是取得进来，方向相反',
      },
      {
        label: 'keep / receive（收下）',
        distinction: '收下的东西不需要归还，而“借”默认归还',
      },
    ],
    openQuestions: ['是否要强调“归还义务”，还是只强调“暂时使用”？'],
    unresolvedQuestions: ['英语是否需要标明来源方（borrow ... from ...）？'],
    expressionCandidates: [
      {
        expressionType: 'word',
        languageTag: 'en',
        surfaceForm: 'borrow',
        rationale: '英语中“从他人处暂时取得并归还”的默认动词',
      },
      {
        expressionType: 'construction',
        languageTag: 'en',
        surfaceForm: 'borrow … from …',
        rationale: '常见构式，用 from 标明借出方',
      },
    ],
  },
};

const umbrellaLend: ScenarioFocus = {
  suggestion: {
    statement: '把自己的物品暂时交给他人使用，之后收回',
    aspectLabel: '给予方向',
    distinguishingNotes: [
      '重点在“我把东西暂时给出去”',
      '所有权还是我的，之后会收回',
    ],
  },
  matchesFocus: (statement) =>
    includes(statement, ['交给', '给出', '借出', '给别人', '借给', '让别人用']),
  boundaryQuestion:
    '你更在意“把东西暂时给别人用、之后收回”，还是“永久给出去”？',
  boundaryOptions: [
    '暂时给出，之后收回',
    '永久给出（那是“赠送/give away”，不是这个意思）',
  ],
  proposal: {
    proposedSenseKey: 'sensa:lend-give',
    coreMeaningFocus: '把自己的物品暂时交给他人使用，默认之后收回（给予方向）',
    prototypeScenes: [
      {
        summary: '下雨天我把伞借给同事，之后他还给我',
        participantRoles: ['物主（我）', '取用者（同事）', '物品（伞）'],
        states: ['物品暂时在取用者手中', '物权仍属物主', '预期之后收回'],
        directionOrCausality: '物品从物主暂时转移到取用者，方向：给出',
      },
    ],
    includedCases: ['把钱借给朋友', '把工具借给邻居', '图书馆把书借出'],
    excludedCases: [
      '我从别人那里借入（取得方向）',
      '把东西永久送人',
      '出租收取费用',
    ],
    neighborContrasts: [
      {
        label: 'borrow（借入）',
        distinction: 'borrow 是取得进来；这里是给出去，方向相反',
      },
      {
        label: 'give away（送出）',
        distinction: '送出不收回；lend 默认之后收回',
      },
    ],
    openQuestions: ['是否要区分“借给某人”与“借出某物”的句法？'],
    unresolvedQuestions: ['英语是否需要标明接收方（lend someone something）？'],
    expressionCandidates: [
      {
        expressionType: 'word',
        languageTag: 'en',
        surfaceForm: 'lend',
        rationale: '英语中“把物品暂时给出、之后收回”的默认动词',
      },
      {
        expressionType: 'construction',
        languageTag: 'en',
        surfaceForm: 'lend someone something',
        rationale: '双宾构式，标明接收方',
      },
    ],
  },
};

const tactfulFocus: ScenarioFocus = {
  suggestion: {
    statement: '表达真实意见，同时照顾对方感受、不让对方难堪',
    aspectLabel: '得体表达',
    distinguishingNotes: [
      '既要说出真实想法，又不伤害对方',
      '接近 tactful / diplomatic / considerate，边界需要澄清',
    ],
  },
  matchesFocus: () => true,
  boundaryQuestion:
    '你此刻最在意哪一面：措辞上让人不难堪（tactful）、在分歧/敏感场合圆融处理（diplomatic），还是体贴地顾及对方处境（considerate）？',
  boundaryOptions: [
    '措辞得体、不让人难堪（tactful）',
    '分歧场合圆融、有策略（diplomatic）',
    '体贴、顾及对方感受（considerate）',
  ],
  proposal: {
    proposedSenseKey: 'sensa:tactful',
    coreMeaningFocus: '在表达真实意见时，用得体措辞避免让对方难堪',
    prototypeScenes: [
      {
        summary: '同事的方案有明显问题，我指出问题却没有让他在会上难堪',
        participantRoles: ['表达者（我）', '对方（同事）', '需要传达的真实意见'],
        states: ['真实意见被传达', '对方未被冒犯', '关系得到维护'],
        directionOrCausality: '通过措辞选择，把可能刺痛的信息变得可接受',
      },
    ],
    includedCases: [
      '委婉地拒绝邀请',
      '指出错误但保留对方颜面',
      '在敏感话题上谨慎措辞',
    ],
    excludedCases: [
      '直白到伤人（blunt）',
      '为了不得罪而不说真话（评价改变了）',
      '单纯的礼貌用语（polite）而不涉及分歧',
    ],
    neighborContrasts: [
      {
        label: 'diplomatic',
        distinction: 'diplomatic 更偏向在分歧/谈判场合有策略地圆融处理',
      },
      {
        label: 'considerate',
        distinction: 'considerate 强调体贴地为对方着想，未必涉及“说出难说的话”',
      },
      {
        label: 'polite',
        distinction: 'polite 只是表面礼貌，不含“既真实又不伤人”的张力',
      },
    ],
    openQuestions: ['你的场景更常出现在职场分歧，还是日常人际？'],
    unresolvedQuestions: ['是否需要一个更口语的短语表达而非单个形容词？'],
    expressionCandidates: [
      {
        expressionType: 'word',
        languageTag: 'en',
        surfaceForm: 'tactful',
        rationale: '强调措辞得体、不让人难堪，最贴近当前焦点',
      },
      {
        expressionType: 'word',
        languageTag: 'en',
        surfaceForm: 'diplomatic',
        rationale: '偏向分歧场合的圆融处理，作为相邻候选',
      },
      {
        expressionType: 'phrase',
        languageTag: 'en',
        surfaceForm: 'put it delicately',
        rationale: '口语中“委婉措辞”的短语表达',
      },
    ],
  },
};

const considerateReuseFocus: ScenarioFocus = {
  suggestion: {
    statement: '设身处地为他人着想，顾及对方的处境与感受',
    aspectLabel: '体贴',
    distinguishingNotes: ['强调主动为别人考虑', '未必涉及“说出难说的话”'],
  },
  matchesFocus: () => true,
  boundaryQuestion:
    '你更强调“主动为对方的处境着想”，还是“说话时不让对方难堪”？',
  boundaryOptions: [
    '主动为对方着想（considerate）',
    '说话得体、不让人难堪（那更接近 tactful）',
  ],
  proposal: {
    proposedSenseKey: 'sensa:considerate',
    coreMeaningFocus: '主动设身处地为他人的处境与感受着想',
    prototypeScenes: [
      {
        summary: '朋友最近很累，我主动不打扰、帮他分担，让他好受一些',
        participantRoles: ['体贴者（我）', '被照顾者（朋友）'],
        states: ['注意到对方处境', '主动调整自己的行为', '对方感到被照顾'],
        directionOrCausality: '从关注对方处境出发，主动做出照顾行为',
      },
    ],
    includedCases: ['主动照顾累的人', '安静下来不打扰', '记得别人的偏好'],
    excludedCases: ['只是嘴上礼貌', '为自己方便而假装体贴'],
    neighborContrasts: [
      {
        label: 'tactful',
        distinction: 'tactful 聚焦“说出难说的话时不伤人”，considerate 更广',
      },
      { label: 'thoughtful', distinction: 'thoughtful 常指用心、周到，重叠但更偏细致' },
    ],
    openQuestions: ['是否与之前已确认的“体贴”意思一致？'],
    unresolvedQuestions: [],
    expressionCandidates: [
      {
        expressionType: 'word',
        languageTag: 'en',
        surfaceForm: 'considerate',
        rationale: '英语中“为他人着想、体贴”的默认形容词',
      },
      {
        expressionType: 'word',
        languageTag: 'en',
        surfaceForm: 'thoughtful',
        rationale: '相邻候选，偏“用心、周到”',
      },
    ],
  },
};

const cringeNoExpressionFocus: ScenarioFocus = {
  suggestion: {
    statement: '看别人出糗时，既替他尴尬又觉得好笑的复杂感受',
    aspectLabel: '复杂感受',
    distinguishingNotes: ['同时有尴尬与好笑', '很难用一个中文/英文词概括'],
  },
  matchesFocus: () => true,
  boundaryQuestion:
    '这种感受更偏向“替对方尴尬到不忍看”，还是“觉得好笑”？还是两者都有、缺一不可？',
  boundaryOptions: [
    '两者都有、缺一不可',
    '主要是替对方尴尬',
    '主要是觉得好笑',
  ],
  proposal: {
    proposedSenseKey: 'sensa:cringe-amused',
    coreMeaningFocus: '目睹他人出糗时，尴尬与好笑交织、又忍不住关注的复杂情绪',
    prototypeScenes: [
      {
        summary: '看到同学在台上说错话，我替他尴尬得想捂脸，却又忍不住想笑',
        participantRoles: ['旁观者（我）', '出糗者（他人）'],
        states: ['替对方尴尬', '同时觉得好笑', '忍不住继续关注'],
        directionOrCausality: '他人的失态引发旁观者的复合情绪',
      },
    ],
    includedCases: ['看社死视频', '朋友表白被拒的现场', '尬聊到脚趾抠地'],
    excludedCases: ['纯粹的好笑（没有尴尬）', '纯粹的同情（没有好笑）'],
    neighborContrasts: [
      {
        label: 'embarrassing',
        distinction: 'embarrassing 只说“尴尬”，缺少“好笑又想看”的成分',
      },
    ],
    openQuestions: ['英语里可能没有一个干净的单词，是否接受用短语/说法？'],
    unresolvedQuestions: ['是否暂时保留“表达待确认”，先只确认这个意思？'],
    expressionCandidates: [
      {
        expressionType: 'phrase',
        languageTag: 'en',
        surfaceForm: 'second-hand embarrassment',
        rationale: '英语中“替别人尴尬”的常见短语，但未覆盖“好笑”的成分',
      },
      {
        expressionType: 'utterance_strategy',
        languageTag: 'en',
        surfaceForm: "so cringe I can't look away",
        rationale: '用整句说法描述这种复合感受，暂无单词对应',
      },
    ],
  },
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'umbrella-borrow-lend',
    matches: (text) => includes(text, ['伞', '借伞', '雨伞']),
    multipleAspects: true,
    focuses: [umbrellaBorrow, umbrellaLend],
    seededSenseKeys: [],
  },
  {
    id: 'considerate-reuse',
    matches: (text) => includes(text, ['体贴', '设身处地', '为别人着想', '为他人着想']),
    multipleAspects: false,
    focuses: [considerateReuseFocus],
    // Pre-seeded: confirming this proposal reuses an existing stable Sense.
    seededSenseKeys: ['sensa:considerate'],
  },
  {
    id: 'tactful-adjacent',
    matches: (text) =>
      includes(text, ['不同意见', '不让对方难堪', '得体', '委婉', '难堪', '不好意思说']),
    multipleAspects: false,
    focuses: [tactfulFocus],
    seededSenseKeys: [],
  },
  {
    id: 'cringe-no-expression',
    matches: (text) => includes(text, ['出糗', '尴尬又好笑', '社死', '替他尴尬', '尬']),
    multipleAspects: false,
    focuses: [cringeNoExpressionFocus],
    seededSenseKeys: [],
  },
];

/** Match a scenario from the learner's private material, or report unavailable. */
export const matchScenario = (materialText: string): Scenario | null =>
  SCENARIOS.find((scenario) => scenario.matches(materialText)) ?? null;

/** Every sense key any scenario pre-seeds as “already existing”. */
export const seededSenseKeys = (): string[] =>
  Array.from(new Set(SCENARIOS.flatMap((scenario) => scenario.seededSenseKeys)));

/**
 * The semantic specs for pre-seeded Senses. The gateway registers these once so
 * that confirming the matching proposal resolves to `reuse_existing` instead of
 * always creating a new Sense.
 */
export const getSeededSenseSpecs = (): Array<{
  senseKey: string;
  proposal: ProposalCore;
}> => {
  const specs: Array<{ senseKey: string; proposal: ProposalCore }> = [];
  const seenKeys = new Set<string>();
  for (const scenario of SCENARIOS) {
    for (const focus of scenario.focuses) {
      const key = focus.proposal.proposedSenseKey;
      if (scenario.seededSenseKeys.includes(key) && !seenKeys.has(key)) {
        seenKeys.add(key);
        specs.push({ senseKey: key, proposal: focus.proposal });
      }
    }
  }
  return specs;
};

/** Pick the scenario focus that best matches a (possibly edited) focus statement. */
export const pickScenarioFocus = (
  scenario: Scenario,
  focusStatement: string,
): ScenarioFocus | null => {
  const exact = scenario.focuses.find(
    (focus) => focus.suggestion.statement === focusStatement,
  );
  if (exact) return exact;
  const matched = scenario.focuses.find((focus) => focus.matchesFocus(focusStatement));
  return matched ?? null;
};

export const buildConstructionAcknowledgement = (
  _context: ConstructionTurnContext,
): string =>
  '谢谢，这个区分很关键。我据此整理了一个可查看的 Sense 提议，你可以继续澄清、拒绝或确认。';
