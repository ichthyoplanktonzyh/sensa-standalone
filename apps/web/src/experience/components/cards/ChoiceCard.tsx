import { uiClass } from '../../ui/classes';
import { useState } from 'react';
import type { Word } from '../../types';
import { WordHeader } from './atoms/WordHeader';
import { PhoneticBar } from './atoms/PhoneticBar';
import { OptionList } from './atoms/OptionList';
import { FooterBar } from './atoms/FooterBar';
import { audioService } from '../../services/audioService';

interface ChoiceCardProps {
  word: Word;
  onAnswer: (ok: boolean) => void;
  onShowAnswer: () => void;
  toast: (msg: string) => void;
}

export const ChoiceCard = ({
  word,
  onAnswer,
  onShowAnswer,
  toast,
}: ChoiceCardProps) => {
  const [answering, setAnswering] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const handlePick = (idx: number) => {
    if (answering) return;
    setAnswering(true);
    setSelectedIdx(idx);
    const ok = !!word.options[idx]?.ok;
    setTimeout(() => {
      onAnswer(ok);
      setAnswering(false);
      setSelectedIdx(null);
    }, ok ? 420 : 1000);
  };

  const handleShowAnswerClick = () => {
    if (answering) return;
    setAnswering(true);
    setSelectedIdx(-1);
    setTimeout(() => {
      onShowAnswer();
      setAnswering(false);
      setSelectedIdx(null);
    }, 700);
  };

  return (
    <>
      <div className={uiClass("lbody")}>
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
        <p className={uiClass("hint", "#wHint")} id="wHint">
          先回想词义再选择，想不起来「看答案」
        </p>
      </div>

      <OptionList
        options={word.options}
        answering={answering}
        selectedIdx={selectedIdx}
        onPick={handlePick}
      />

      <FooterBar
        buttons={[
          {
            label: '看答案',
            color: 'red',
            onClick: handleShowAnswerClick,
          },
        ]}
      />
    </>
  );
};
