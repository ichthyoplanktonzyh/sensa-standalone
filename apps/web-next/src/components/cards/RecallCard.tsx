import { useState } from 'react';
import type { Word, QuickDictEntry } from '../../types';
import { WordHeader } from './atoms/WordHeader';
import { PhoneticBar } from './atoms/PhoneticBar';
import { MaskedSenses } from './atoms/MaskedSenses';
import { FooterBar } from './atoms/FooterBar';
import { ClickableSentence } from '../ClickableSentence';
import { QuickDictPopup } from '../QuickDictPopup';
import { lookupWord } from '../../services/quickDict';

import { audioService } from '../../services/audioService';

interface RecallCardProps {
  word: Word;
  onAnswer: (known: boolean) => void;
  onOpenDict?: (word: Word | QuickDictEntry | string, tab?: string) => void;
  toast: (msg: string) => void;
}

export const RecallCard = ({
  word,
  onAnswer,
  onOpenDict,
  toast,
}: RecallCardProps) => {
  const [showHintZh, setShowHintZh] = useState(false);
  const [activeLookup, setActiveLookup] = useState<{
    tokenIdx: number;
    entry: QuickDictEntry;
  } | null>(null);

  const sentence = word.sentences[0] || { en: '', zh: '' };

  const handleDoHint = () => {
    if (!showHintZh) {
      setShowHintZh(true);
      toast('💡 提示：' + sentence.zh);
    } else {
      toast('已显示例句中文释义');
    }
  };

  return (
    <>
      <div className="lbody">
        <WordHeader
          text={word.w}
          level={word.level}
          badge={word.badge}
          isMastered={word.isMastered}
        />
        <PhoneticBar
          phon={word.ph}
          onPlay={() => {
            audioService.playWord(word.w, 'us');
            toast('🔊 播放美式发音');
          }}
        />
        <MaskedSenses />
      </div>

      {sentence.en && (
        <div className="dcard ex-card-only" id="wSentenceCard">
          <div className="en" id="dEnOnly">
            <ClickableSentence
              sentenceHtml={sentence.en}
              activeTokenIdx={activeLookup?.tokenIdx ?? null}
              onWordClick={(tok, idx) => {
                const entry = lookupWord(tok.cleanWord);
                setActiveLookup({ tokenIdx: idx, entry });
              }}
            />
          </div>
          <div
            className="zh"
            id="dZhOnly"
            style={{ display: showHintZh ? 'block' : 'none' }}
          >
            {sentence.zh}
          </div>
        </div>
      )}

      <div className="hint-wrap" id="wHintWrap" onClick={handleDoHint}>
        <button className="bulb-btn" aria-label="提示一下">
          <svg className="icon"><use href="#i-bulb" /></svg>
        </button>
        <span id="hintWrapTxt">{showHintZh ? '已提示' : '提示一下'}</span>
      </div>

      {activeLookup && (
        <QuickDictPopup
          entry={activeLookup.entry}
          onClose={() => setActiveLookup(null)}
          toast={toast}
          onViewDetail={(w) => {
            setActiveLookup(null);
            if (onOpenDict) {
              onOpenDict(w, '柯林斯');
            } else {
              toast(`查看 "${w}" 的完整词库卡片`);
            }
          }}
        />
      )}

      <FooterBar
        buttons={[
          {
            label: '认识',
            color: 'green',
            onClick: () => onAnswer(true),
          },
          {
            label: '不认识',
            color: 'red',
            onClick: () => onAnswer(false),
          },
        ]}
      />
    </>
  );
};
