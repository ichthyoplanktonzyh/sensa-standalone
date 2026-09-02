import type { KeyboardEvent, ReactNode } from 'react';
import {
  DEFAULT_PRACTICE_SCOPE,
  type PracticeScope,
  type PracticeSenseItem,
} from '../practiceData';
import { SensaFreePracticeScreen } from './SensaFreePracticeScreen';

export type PracticeHomePresentation = 'sensa' | 'baseline';

export interface AcademyScreenProps {
  active: boolean;
  onBack: () => void;
  onOpenWordList: () => void;
  onOpenListening: () => void;
  onOpenRealWorldListening: () => void;
  onOpenDictation: (item: PracticeSenseItem) => void;
  onOpenQuickSpelling: (item: PracticeSenseItem) => void;
  practiceScope?: PracticeScope;
  toast: (msg: string) => void;
  presentation?: PracticeHomePresentation;
}

interface PracticeEntryProps {
  name: string;
  description: string;
  available: boolean;
  onActivate: () => void;
}

interface ChannelCardProps {
  tone: 'a' | 'b';
  icon: string;
  title: string;
  children: ReactNode;
}

const activateOnKeyboard = (event: KeyboardEvent<HTMLDivElement>, action: () => void) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};

const PracticeEntry = ({
  name,
  description,
  available,
  onActivate,
}: PracticeEntryProps) => (
  <div
    className="lbox"
    role="button"
    tabIndex={0}
    onClick={onActivate}
    onKeyDown={(event) => activateOnKeyboard(event, onActivate)}
    aria-label={available ? name : `${name}，暂未开放`}
  >
    <div className="n">{name}</div>
    <div className="c">{available ? description : '暂未开放'}</div>
    <span className="play">
      {available ? (
        <svg className="icon"><use href="#i-play" /></svg>
      ) : (
        <span aria-hidden="true">…</span>
      )}
    </span>
  </div>
);

const ChannelCard = ({ tone, icon, title, children }: ChannelCardProps) => (
  <div className="listen-wrap">
    <div className={`lcard ${tone}`}>
      <div className="lc-head">
        <span className="dot"><svg className="icon"><use href={icon} /></svg></span>
        <span>{title}</span>
      </div>
      <div className="lc-inner">{children}</div>
    </div>
  </div>
);

const BaselineAcademyScreen = ({
  active,
  onBack,
  onOpenWordList,
  onOpenListening,
  onOpenDictation,
  onOpenQuickSpelling,
  practiceScope = DEFAULT_PRACTICE_SCOPE,
  toast,
}: AcademyScreenProps) => {
  const firstItem = practiceScope.items[0];

  const requireFirstItem = (action: (item: PracticeSenseItem) => void) => {
    if (!firstItem) {
      toast('当前练习范围暂无可练意思');
      return;
    }
    action(firstItem);
  };

  const unavailable = (name: string) => {
    toast(`${name}暂未开放`);
  };

  return (
    <section className={`screen${active ? ' active' : ''}`} id="s-academy" data-anim="sheet">
      <div className="sheet-head">
        <button className="down" onClick={onBack} aria-label="返回">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <h2>自由练习</h2>
      </div>

      <div className="pad">
        <div className="card group">
          <div
            className="row"
            role="button"
            tabIndex={0}
            onClick={onOpenWordList}
            onKeyDown={(event) => activateOnKeyboard(event, onOpenWordList)}
            aria-label={`查看当前练习范围 ${practiceScope.bookTitle}`}
          >
            <span className="sq">
              <svg className="icon"><use href="#i-bookopen" /></svg>
            </span>
            <span className="t">当前练习范围</span>
            <span className="v">
              <b>{practiceScope.bookTitle}</b>
              <br />
              {practiceScope.items.length} 个意思
            </span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
        </div>

        <div className="sec-title group">按通道选择练习</div>

        <ChannelCard tone="a" icon="#i-head" title="听">
          <PracticeEntry
            name="随身听"
            description={`${practiceScope.items.length} 个意思`}
            available
            onActivate={onOpenListening}
          />
          <PracticeEntry
            name="听音辨义"
            description=""
            available={false}
            onActivate={() => unavailable('听音辨义')}
          />
        </ChannelCard>

        <ChannelCard tone="b" icon="#i-vol" title="说">
          <PracticeEntry name="跟读" description="" available={false} onActivate={() => unavailable('跟读')} />
          <PracticeEntry
            name="看义说词"
            description=""
            available={false}
            onActivate={() => unavailable('看义说词')}
          />
          <PracticeEntry
            name="例句朗读"
            description=""
            available={false}
            onActivate={() => unavailable('例句朗读')}
          />
        </ChannelCard>

        <ChannelCard tone="a" icon="#i-bookopen" title="读">
          <PracticeEntry
            name="沉浸刷词"
            description="浏览意思与例句"
            available
            onActivate={onOpenWordList}
          />
          <PracticeEntry
            name="语境辨义"
            description=""
            available={false}
            onActivate={() => unavailable('语境辨义')}
          />
          <PracticeEntry
            name="义项辨析"
            description=""
            available={false}
            onActivate={() => unavailable('义项辨析')}
          />
        </ChannelCard>

        <ChannelCard tone="b" icon="#i-write" title="写">
          <PracticeEntry
            name="随手拼写"
            description="义 → 写"
            available
            onActivate={() => requireFirstItem(onOpenQuickSpelling)}
          />
          <PracticeEntry
            name="听写"
            description="听 → 写"
            available
            onActivate={() => requireFirstItem(onOpenDictation)}
          />
          <PracticeEntry
            name="例句填空"
            description=""
            available={false}
            onActivate={() => unavailable('例句填空')}
          />
        </ChannelCard>

        <div className="card group">
          <div className="row">
            <span className="sq">
              <svg className="icon"><use href="#i-bulb" /></svg>
            </span>
            <span className="t">自由练习</span>
            <span className="v">不改变正式学习和复习进度</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export const AcademyScreen = (props: AcademyScreenProps) => (
  props.presentation === 'baseline'
    ? <BaselineAcademyScreen {...props} />
    : <SensaFreePracticeScreen {...props} />
);
