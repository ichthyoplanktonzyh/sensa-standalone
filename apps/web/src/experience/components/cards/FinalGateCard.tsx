import { uiClass } from '../../ui/classes';
import type { Word } from '../../types';
import { WordHeader } from './atoms/WordHeader';
import { PhoneticBar } from './atoms/PhoneticBar';
import { MaskedSenses } from './atoms/MaskedSenses';
import { FooterBar } from './atoms/FooterBar';
import { audioService } from '../../services/audioService';

interface FinalGateCardProps {
  word: Word;
  onAnswer: (known: boolean) => void;
  toast: (msg: string) => void;
}

export const FinalGateCard = ({
  word,
  onAnswer,
  toast,
}: FinalGateCardProps) => {
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
        <MaskedSenses />
      </div>

      <div className={uiClass("final-gate-hint", "#wFinalGateHint")} id="wFinalGateHint">
        本词最后一关😉：请在无提示的情况下判断
      </div>

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
