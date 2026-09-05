import { uiClass } from '../../ui/classes';
import { useState } from 'react';
import type { Word, QuickDictEntry } from '../../types';
import { WordHeader } from './atoms/WordHeader';
import { PhoneticBar } from './atoms/PhoneticBar';
import { SenseList } from './atoms/SenseList';
import { MnemoCard } from './atoms/MnemoCard';
import { FooterBar } from './atoms/FooterBar';
import { ClickableSentence } from '../ClickableSentence';
import { QuickDictPopup } from '../QuickDictPopup';
import { lookupWord } from '../../services/quickDict';

import { audioService } from '../../services/audioService';

interface DetailCardProps {
  word: Word;
  onOpenExample: (idx: number) => void;
  onOpenDict?: (word: Word | QuickDictEntry | string, tab?: string) => void;
  onOpenNoteEditor?: (word: Word) => void;
  onNextWord: () => void;
  onMarkMistake: () => void;
  toast: (msg: string) => void;
}

export const DetailCard = ({
  word,
  onOpenExample,
  onOpenDict,
  onOpenNoteEditor,
  onNextWord,
  onMarkMistake,
  toast,
}: DetailCardProps) => {
  const sentence = word.sentences[0] || { en: '', zh: '' };
  const level = word.level ?? 0;
  const isMastered = !!word.isMastered;
  const showMistakeBtn = level >= 2 || isMastered;

  const [activeLookup, setActiveLookup] = useState<{
    tokenIdx: number;
    entry: QuickDictEntry;
  } | null>(null);

  return (
    <>
      <div className={uiClass("lbody")}>
        <WordHeader
          text={word.syl}
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
        <SenseList
          senses={word.senses}
          onOpenExample={onOpenExample}
        />
      </div>

      <div id="wDetail" style={{ paddingBottom: 20 }}>
        {sentence.en && (
          <div className={uiClass("dcard")}>
            <div className={uiClass("en", "#dEn")} id="dEn">
              <ClickableSentence
                sentenceHtml={sentence.en}
                activeTokenIdx={activeLookup?.tokenIdx ?? null}
                onWordClick={(tok, idx) => {
                  const entry = lookupWord(tok.cleanWord);
                  setActiveLookup({ tokenIdx: idx, entry });
                }}
              />
            </div>
            <div className={uiClass("zh", "#dZh")} id="dZh">{sentence.zh}</div>
            <button
              className={uiClass("expand")}
              onClick={() => onOpenExample(0)}
              aria-label="查看例句卡片"
            >
              <svg className={uiClass("icon")}><use href="#i-expand" /></svg>
            </button>
          </div>
        )}

        <MnemoCard
          word={word}
          mnemo={word.mnemo}
          onOpenDict={() => onOpenDict?.(word, '柯林斯')}
          onOpenNoteEditor={() => onOpenNoteEditor?.(word)}
          toast={toast}
        />
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
        buttons={
          showMistakeBtn
            ? [
                {
                  label: '下一词',
                  color: 'green',
                  onClick: onNextWord,
                },
                {
                  label: '记错了',
                  color: 'red',
                  onClick: onMarkMistake,
                },
              ]
            : [
                {
                  label: '下一词',
                  color: 'green',
                  onClick: onNextWord,
                },
              ]
        }
      />
    </>
  );
};
