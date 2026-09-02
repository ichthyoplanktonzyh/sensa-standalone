/**
 * Real-world speech occurrences for the free-practice listening round.
 *
 * One round is one Sense heard across many different speakers. The shape here
 * is the shape the offline indexer will produce.
 *
 * An occurrence indexes a *context window* of a minute or two, not just the
 * sentence containing the target word. The index stores no media — only ids,
 * timestamps and caption text — so a longer window costs almost nothing and
 * leaves room to listen around the word instead of at it.
 */

export type Accent = 'US' | 'UK' | 'AUS' | 'CAN' | 'IE' | 'NZ';

/**
 * How much the target word is reduced in this occurrence. The offline pipeline
 * will derive this from the spoken duration of the word; the round is ordered
 * clear -> normal -> reduced so a listener starts on solid ground.
 */
export type Clarity = 'clear' | 'normal' | 'reduced';

export interface CaptionSegment {
  /** Absolute time in the source video. */
  startSec: number;
  endSec: number;
  text: string;
}

export interface RealWorldOccurrence {
  id: string;
  /** Already disambiguated offline. A round never mixes Senses. */
  senseId: string;
  /** Absent until the index is built; the UI falls back to a simulated clock. */
  videoId?: string;
  /** The indexed context window, absolute in the source video. */
  windowStartSec: number;
  windowEndSec: number;
  /** Where the target word is actually spoken. */
  targetAtSec: number;
  /** Caption segments covering the window. */
  captions: readonly CaptionSegment[];
  /** Index into `captions` of the segment holding the target word. */
  targetSegmentIndex: number;
  /** Character range of the target word inside that segment's text. */
  targetSpan: readonly [number, number];
  /** Translation of the target segment only. */
  translation: string;
  /** Source attribution, and the proxy for speaker identity within a round. */
  channel: string;
  accent: Accent;
  clarity: Clarity;
}

interface OccurrenceSeed {
  /** The segment containing the target word. */
  text: string;
  /** Surface form as spoken; may be an inflection of the lemma. */
  target: string;
  translation: string;
  /** Surrounding segments. The real index fills the whole window. */
  before?: readonly string[];
  after?: readonly string[];
  channel: string;
  accent: Accent;
  clarity: Clarity;
  /** Absolute time of the target word in the source video. */
  targetAtSec: number;
}

const CLARITY_ORDER: Record<Clarity, number> = { clear: 0, normal: 1, reduced: 2 };

/** Context kept before and after the target word, in seconds. */
const WINDOW_LEAD = 35;
const WINDOW_TRAIL = 55;
/** Nominal length of one caption segment while mocking. */
const SEGMENT_SEC = 4.5;

const buildOccurrence = (
  senseId: string,
  index: number,
  seed: OccurrenceSeed,
): RealWorldOccurrence => {
  const start = seed.text.toLowerCase().indexOf(seed.target.toLowerCase());
  if (start < 0) {
    throw new Error(`Target "${seed.target}" not found in occurrence text: ${seed.text}`);
  }

  const windowStartSec = Math.max(0, seed.targetAtSec - WINDOW_LEAD);
  const windowEndSec = seed.targetAtSec + WINDOW_TRAIL;

  // The target segment straddles the word; neighbours tile away from it.
  const targetSegment: CaptionSegment = {
    startSec: seed.targetAtSec - 1.8,
    endSec: seed.targetAtSec + 2.7,
    text: seed.text,
  };
  const before = (seed.before ?? []).map((text, offset, all) => {
    const stepsBack = all.length - offset;
    return {
      startSec: targetSegment.startSec - stepsBack * SEGMENT_SEC,
      endSec: targetSegment.startSec - (stepsBack - 1) * SEGMENT_SEC,
      text,
    };
  });
  const after = (seed.after ?? []).map((text, offset) => ({
    startSec: targetSegment.endSec + offset * SEGMENT_SEC,
    endSec: targetSegment.endSec + (offset + 1) * SEGMENT_SEC,
    text,
  }));

  return {
    id: `${senseId}:occ:${index}`,
    senseId,
    windowStartSec,
    windowEndSec,
    targetAtSec: seed.targetAtSec,
    captions: [...before, targetSegment, ...after],
    targetSegmentIndex: before.length,
    targetSpan: [start, start + seed.target.length],
    translation: seed.translation,
    channel: seed.channel,
    accent: seed.accent,
    clarity: seed.clarity,
  };
};

const SEEDS: Record<string, readonly OccurrenceSeed[]> = {
  'fragile.adj.physical-easily-broken': [
    {
      text: 'Please handle that box carefully, because everything inside is fragile.',
      target: 'fragile',
      translation: '请小心搬那个箱子，里面的东西都很易碎。',
      before: ['We packed the studio over two days.', 'Most of it went into crates, but a few things did not fit.'],
      after: ['I would rather carry it myself than explain a broken one.', 'The van is already loaded, so there is no room to redo it.'],
      channel: 'Studio Visit', accent: 'US', clarity: 'clear', targetAtSec: 412,
    },
    {
      text: 'The oldest pieces in this collection are extremely fragile.',
      target: 'fragile',
      translation: '这批藏品里最老的几件极其易碎。',
      before: ['This room holds about four hundred objects.', 'They arrived from three separate estates.'],
      after: ['We only bring them out under supervision.', 'Even the light in here is controlled for that reason.'],
      channel: 'The Objects We Keep', accent: 'UK', clarity: 'clear', targetAtSec: 187,
    },
    {
      text: 'You have to hold it from underneath, because it is incredibly fragile at this stage.',
      target: 'fragile',
      translation: '这个阶段它非常易碎，所以必须从底部托住。',
      before: ['The glass comes off the pipe at around a thousand degrees.', 'It looks solid long before it actually is.'],
      after: ['Give it another twenty minutes and you can handle it normally.'],
      channel: 'Glass and Fire', accent: 'US', clarity: 'normal', targetAtSec: 934,
    },
    { text: 'It looks heavy, but the surface is actually very fragile.', target: 'fragile', translation: '它看起来很厚重，但表面其实非常易碎。', channel: 'Maker Journal', accent: 'AUS', clarity: 'normal', targetAtSec: 256 },
    { text: 'Most of the pieces are small and fragile, so we wrap every one separately.', target: 'fragile', translation: '大部分物件又小又易碎，所以我们会分别包装。', channel: 'Moving Day', accent: 'UK', clarity: 'normal', targetAtSec: 601 },
    { text: 'The paper had become so fragile that we could barely turn the pages.', target: 'fragile', translation: '纸张已经脆到我们几乎无法翻页。', channel: 'Archive Notes', accent: 'CAN', clarity: 'normal', targetAtSec: 1120 },
    { text: "That whole shelf is fragile, don't lean on it.", target: 'fragile', translation: '那整个架子都很脆，别靠上去。', channel: 'Workshop Talk', accent: 'US', clarity: 'reduced', targetAtSec: 78 },
    { text: "It's a fragile thing, you know, the whole setup.", target: 'fragile', translation: '这整套东西你知道的，很脆弱。', channel: 'Late Bench', accent: 'UK', clarity: 'reduced', targetAtSec: 1503 },
    { text: "They're fragile as anything once they dry out.", target: 'fragile', translation: '一旦干透，它们就脆得不行。', channel: 'Field Recording', accent: 'IE', clarity: 'reduced', targetAtSec: 344 },
    { text: "I mean it's fragile, but it's not gonna fall apart on you.", target: 'fragile', translation: '我是说它是脆，但也不至于在你手里散掉。', channel: 'Two Makers', accent: 'US', clarity: 'reduced', targetAtSec: 822 },
  ],
  'sustain.verb.process-continue': [
    {
      text: 'A stable source of funding is what allows a program to sustain itself.',
      target: 'sustain',
      translation: '稳定的资金来源才能让一个项目维持下去。',
      before: ['Most of these programs start with a grant.', 'The grant runs three years, sometimes five.'],
      after: ['After that the question stops being about ambition.', 'It becomes a question about the budget line.'],
      channel: 'Public Ideas', accent: 'US', clarity: 'clear', targetAtSec: 733,
    },
    {
      text: 'You need consistent effort to sustain that level of growth.',
      target: 'sustain',
      translation: '要维持那样的增长速度，需要持续的投入。',
      before: ['Everyone focuses on the first year of numbers.'],
      after: ['The second year is where most teams quietly stall.'],
      channel: 'Small Systems', accent: 'UK', clarity: 'clear', targetAtSec: 211,
    },
    {
      text: 'The real question was whether we could sustain that pace for another year.',
      target: 'sustain',
      translation: '真正的问题是，我们能否把这个节奏再维持一年。',
      before: ['We shipped every two weeks for eight months straight.'],
      after: ['Nobody wanted to be the one to say it out loud.'],
      channel: 'Founders Off Record', accent: 'US', clarity: 'normal', targetAtSec: 1490,
    },
    { text: 'Few athletes can sustain that level of effort for the whole race.', target: 'sustain', translation: '很少有运动员能在整场比赛中维持那种强度。', channel: 'Endurance Notes', accent: 'CAN', clarity: 'normal', targetAtSec: 402 },
    { text: 'Cities struggle to sustain basic services when the population shifts.', target: 'sustain', translation: '人口结构变化时，城市很难维持基本公共服务。', channel: 'City Desk', accent: 'UK', clarity: 'normal', targetAtSec: 966 },
    { text: 'It is hard to sustain enthusiasm when results take this long.', target: 'sustain', translation: '结果要等这么久，热情很难维持。', channel: 'Long Projects', accent: 'AUS', clarity: 'normal', targetAtSec: 158 },
    { text: "We couldn't sustain it, honestly, not with that team size.", target: 'sustain', translation: '说实话我们维持不下去，就那么点人手。', channel: 'After the Launch', accent: 'US', clarity: 'reduced', targetAtSec: 1877 },
    { text: "You just can't sustain that kind of schedule.", target: 'sustain', translation: '那种作息你根本维持不了。', channel: 'Night Shift', accent: 'UK', clarity: 'reduced', targetAtSec: 512 },
    { text: 'Nothing they did could sustain the momentum after the first month.', target: 'sustain', translation: '第一个月过后，他们做什么都没能维持住势头。', channel: 'Case Notes', accent: 'US', clarity: 'reduced', targetAtSec: 640 },
    { text: 'They managed to sustain it for about three weeks and then it collapsed.', target: 'sustain', translation: '他们大概维持了三周，然后就垮了。', channel: 'Small Town Radio', accent: 'NZ', clarity: 'reduced', targetAtSec: 1044 },
  ],
  'borrow.verb.receive-temporarily': [
    {
      text: 'May I borrow your pen for a moment?',
      target: 'borrow',
      translation: '我能借用一下你的笔吗？',
      before: ['She was filling in the form at the counter.', 'Halfway down the page the ink stopped.'],
      after: ['The clerk handed one over without looking up.', 'She signed the last two lines and gave it straight back.'],
      channel: 'Everyday English Stories', accent: 'US', clarity: 'clear', targetAtSec: 96,
    },
    {
      text: 'I asked if I could borrow the camera and bring it back on Monday.',
      target: 'borrow',
      translation: '我问能不能借用那台相机，周一还回来。',
      before: ['It had been sitting on their kitchen table for a week.'],
      after: ['They said yes before I finished the sentence.'],
      channel: 'The Kitchen Table', accent: 'UK', clarity: 'clear', targetAtSec: 448,
    },
    {
      text: 'Hey, can I borrow your charger for a minute?',
      target: 'borrow',
      translation: '嘿，我能借用一下你的充电器吗？',
      before: ['My phone died somewhere around the third episode.'],
      after: ['He threw it across the room without pausing the show.'],
      channel: 'Roommates', accent: 'US', clarity: 'normal', targetAtSec: 122,
    },
    { text: 'If I forget mine, I usually borrow one from a friend.', target: 'borrow', translation: '如果我忘带了，通常会向朋友借一个。', channel: 'Campus Voices', accent: 'AUS', clarity: 'normal', targetAtSec: 289 },
    { text: 'You can borrow the ladder as long as you return it by Sunday.', target: 'borrow', translation: '梯子你可以借，周日之前还回来就行。', channel: 'Next Door', accent: 'UK', clarity: 'normal', targetAtSec: 715 },
    { text: 'Students can borrow up to ten books at a time.', target: 'borrow', translation: '学生一次最多可以借十本书。', channel: 'Library Conversations', accent: 'CAN', clarity: 'normal', targetAtSec: 333 },
    { text: 'Can I borrow that real quick?', target: 'borrow', translation: '我能马上借用一下那个吗？', channel: 'Shop Floor', accent: 'US', clarity: 'reduced', targetAtSec: 1201 },
    { text: "He'd borrow it and never bring it back, that was the problem.", target: 'borrow', translation: '他借了就不还，问题就在这儿。', channel: 'Old Friends', accent: 'UK', clarity: 'reduced', targetAtSec: 878 },
    { text: "I'll just borrow yours if that's alright.", target: 'borrow', translation: '要是可以的话，我就借你的用。', channel: 'Studio Chat', accent: 'US', clarity: 'reduced', targetAtSec: 567 },
    { text: "We used to borrow each other's gear all the time.", target: 'borrow', translation: '我们以前老是互相借装备。', channel: 'Back Room Sessions', accent: 'IE', clarity: 'reduced', targetAtSec: 1330 },
  ],
  'lend.verb.give-temporarily': [
    {
      text: 'Some libraries now lend out tools and musical instruments too.',
      target: 'lend',
      translation: '现在一些图书馆也把工具和乐器借出去。',
      before: ['People still think of us as a building full of books.', 'That has not been the whole picture for a long time.'],
      after: ['There is a drill on the shelf behind you right now.', 'It goes out more often than most of the fiction.'],
      channel: 'Library Conversations', accent: 'US', clarity: 'clear', targetAtSec: 254,
    },
    {
      text: 'Our neighbour was happy to lend us his ladder for the weekend.',
      target: 'lend',
      translation: '邻居很乐意把梯子借给我们过周末。',
      before: ['The gutter had been blocked since about October.'],
      after: ['He even carried it round the side of the house himself.'],
      channel: 'Neighbourhood Stories', accent: 'UK', clarity: 'clear', targetAtSec: 610,
    },
    {
      text: 'I can lend you mine until you find yours.',
      target: 'lend',
      translation: '在你找到自己的之前，我可以把我的借给你。',
      before: ['She had turned the whole desk over twice by then.'],
      after: ['It turned up in her coat pocket the next morning.'],
      channel: 'Friends at Work', accent: 'CAN', clarity: 'normal', targetAtSec: 141,
    },
    { text: 'She offered to lend me the money without any interest.', target: 'lend', translation: '她提出把钱借给我，不收利息。', channel: 'Money Talks Quietly', accent: 'US', clarity: 'normal', targetAtSec: 802 },
    { text: 'They will not lend equipment to anyone without a deposit.', target: 'lend', translation: '不交押金他们不会把设备借给任何人。', channel: 'Gear Desk', accent: 'UK', clarity: 'normal', targetAtSec: 466 },
    { text: 'My brother refused to lend me the car after last time.', target: 'lend', translation: '经过上次，我哥拒绝把车借给我。', channel: 'Family Business', accent: 'AUS', clarity: 'normal', targetAtSec: 1058 },
    { text: "I'd lend you mine, but I left it at home.", target: 'lend', translation: '我本来可以借你我的，但我落家里了。', channel: 'Morning Commute', accent: 'US', clarity: 'reduced', targetAtSec: 377 },
    { text: "He'll lend it to you if you ask nicely.", target: 'lend', translation: '你好好开口的话，他会借给你的。', channel: 'Two Rooms', accent: 'UK', clarity: 'reduced', targetAtSec: 923 },
    { text: 'They lend them out for free, you just sign a form.', target: 'lend', translation: '他们免费外借，签个表就行。', channel: 'Community Shed', accent: 'US', clarity: 'reduced', targetAtSec: 688 },
    { text: 'We lend them to the school every term.', target: 'lend', translation: '我们每学期都把它们借给学校。', channel: 'Local Notes', accent: 'NZ', clarity: 'reduced', targetAtSec: 1442 },
  ],
};

const ALL_OCCURRENCES: readonly RealWorldOccurrence[] = Object.entries(SEEDS).flatMap(
  ([senseId, seeds]) => seeds.map((seed, index) => buildOccurrence(senseId, index, seed)),
);

/**
 * A round: one Sense, ordered clear -> reduced so difficulty grows, and capped
 * at one occurrence per channel so the listener hears many different speakers.
 * Talker variability is what produces generalisation, so it is a hard property
 * of the round rather than a filter the learner can defeat.
 */
export const roundForSense = (senseId: string, size = 10): RealWorldOccurrence[] => {
  const seenChannels = new Set<string>();
  return ALL_OCCURRENCES
    .filter((occurrence) => occurrence.senseId === senseId)
    .slice()
    .sort((a, b) => CLARITY_ORDER[a.clarity] - CLARITY_ORDER[b.clarity])
    .filter((occurrence) => {
      if (seenChannels.has(occurrence.channel)) return false;
      seenChannels.add(occurrence.channel);
      return true;
    })
    .slice(0, size);
};

export const hasRealWorldAudio = (senseId: string): boolean =>
  ALL_OCCURRENCES.some((occurrence) => occurrence.senseId === senseId);

/** Accent spread of a finished round, shown as evidence of talker variability. */
export const accentBreakdown = (
  occurrences: readonly RealWorldOccurrence[],
): { accent: Accent; count: number }[] => {
  const counts = new Map<Accent, number>();
  occurrences.forEach((occurrence) => {
    counts.set(occurrence.accent, (counts.get(occurrence.accent) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([accent, count]) => ({ accent, count }))
    .sort((a, b) => b.count - a.count);
};
