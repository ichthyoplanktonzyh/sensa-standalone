import { Fragment, useMemo } from 'react';
import { DEFAULT_PRACTICE_SCOPE } from '../practiceData';
import {
  resolvePracticeInventory,
  type PracticeChannelInventory,
  type ResolvedPracticeEntry,
} from '../practiceInventory';
import type { AcademyScreenProps } from './AcademyScreen';

/**
 * Free-practice home.
 *
 * The page has three jobs and no others: say which Senses are in scope, say
 * which practices that scope can actually run, and say that none of it moves
 * formal learning. It shows no channel score, completion rate, backlog count
 * or prescription.
 */

const statusNote = (entry: ResolvedPracticeEntry): string => {
  switch (entry.status) {
    case 'available':
      return entry.graded
        ? `${entry.senseCount} 个意思`
        : `${entry.senseCount} 个意思 · 不判分`;
    case 'unavailable_in_scope':
      return '当前范围没有可练的';
    default:
      return '暂未开放';
  }
};

const PracticeTile = ({
  entry,
  onEnter,
}: {
  entry: ResolvedPracticeEntry;
  onEnter: () => void;
}) => (
  <button
    type="button"
    className={`sensa-practice-tile is-${entry.status}`}
    aria-disabled={entry.status !== 'available'}
    onClick={onEnter}
    aria-label={`${entry.name}，${entry.direction}，${statusNote(entry)}`}
  >
    <span className="sensa-practice-tile-name">{entry.name}</span>
    <span className="sensa-practice-tile-direction" aria-hidden="true">{entry.direction}</span>
    <span className="sensa-practice-tile-note" aria-hidden="true">{statusNote(entry)}</span>
    {entry.status === 'available' && (
      <span className="sensa-practice-tile-go" aria-hidden="true" />
    )}
  </button>
);

const ChannelBlock = ({
  channel,
  onEnter,
  onOpenRealWorldListening,
}: {
  channel: PracticeChannelInventory;
  onEnter: (entry: ResolvedPracticeEntry) => void;
  onOpenRealWorldListening: () => void;
}) => (
  <section className={`sensa-practice-channel channel-${channel.channel}`}>
    <header className="sensa-practice-channel-head">
      <span className="sensa-practice-channel-mark" aria-hidden="true" />
      <h3>{channel.label}</h3>
      {channel.empty && <small>本版本没有可进入的练习</small>}
    </header>
    <div className="sensa-practice-grid">
      {channel.entries.map((entry) => (
        <Fragment key={entry.key}>
          <PracticeTile entry={entry} onEnter={() => onEnter(entry)} />
          {entry.key === 'portable_listening' && (
            <button
              type="button"
              className="sensa-practice-tile is-concept_preview"
              onClick={onOpenRealWorldListening}
              aria-label="真实语流，真实语境到听觉泛化，混合来源概念预览"
            >
              <span className="sensa-practice-tile-name">真实语流</span>
              <span className="sensa-practice-tile-direction" aria-hidden="true">真实语境 → 听觉泛化</span>
              <span className="sensa-practice-tile-note" aria-hidden="true">一轮 10 段 · 概念预览</span>
              <span className="sensa-practice-tile-go" aria-hidden="true" />
            </button>
          )}
        </Fragment>
      ))}
    </div>
  </section>
);

export const SensaFreePracticeScreen = ({
  active,
  onBack,
  onOpenWordList,
  onOpenListening,
  onOpenRealWorldListening,
  onOpenDictation,
  onOpenQuickSpelling,
  practiceScope = DEFAULT_PRACTICE_SCOPE,
  toast,
}: AcademyScreenProps) => {
  const channels = useMemo(() => resolvePracticeInventory(practiceScope), [practiceScope]);
  const senseCount = practiceScope.items.length;
  const firstItem = practiceScope.items[0];

  const enter = (entry: ResolvedPracticeEntry) => {
    if (entry.status === 'not_yet_delivered') {
      toast(`${entry.name}暂未开放`);
      return;
    }
    if (entry.status === 'unavailable_in_scope') {
      toast(`当前范围没有可用于「${entry.name}」的意思，换个范围再试`);
      return;
    }
    if (!firstItem) {
      toast('当前练习范围暂无可练意思');
      return;
    }

    switch (entry.taskFamily) {
      case 'portable_listening':
        onOpenListening();
        return;
      case 'immersive_browse':
        onOpenWordList();
        return;
      case 'quick_spelling':
        onOpenQuickSpelling(firstItem);
        return;
      case 'dictation':
        onOpenDictation(firstItem);
        return;
      default:
        toast(`${entry.name}暂未开放`);
    }
  };

  return (
    <section
      className={`screen sensa-practice${active ? ' active' : ''}`}
      id="s-academy"
      data-anim="sheet"
    >
      <header className="sensa-practice-nav">
        <button className="sensa-practice-back" onClick={onBack} aria-label="返回首页">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <h1>自由练习</h1>
      </header>

      <div className="sensa-practice-body">
        <section className="sensa-practice-scope" aria-label="当前练习范围">
          <span className="sensa-practice-kicker">当前练习范围</span>
          <h2>{practiceScope.bookTitle}</h2>
          <p className="sensa-practice-scope-count">
            <b>{senseCount}</b>
            <span>个意思 · 继承自在学词书</span>
          </p>
          <button
            type="button"
            className="sensa-practice-scope-switch"
            aria-disabled="true"
            onClick={() => toast('切换练习范围暂未开放，当前继承在学词书')}
          >
            <span>切换范围</span>
            <em>暂未开放</em>
          </button>
        </section>

        <p className="sensa-practice-boundary">
          自由练习不改变学习与复习进度、每日额度或到期时间。
        </p>

        {channels.map((channel) => (
          <ChannelBlock
            key={channel.channel}
            channel={channel}
            onEnter={enter}
            onOpenRealWorldListening={onOpenRealWorldListening}
          />
        ))}
      </div>
    </section>
  );
};
