import type { Word } from '../../types';
import { WordHeader } from './atoms/WordHeader';
import { PhoneticBar } from './atoms/PhoneticBar';
import { MaskedSenses } from './atoms/MaskedSenses';
import { FooterBar } from './atoms/FooterBar';
import { audioService } from '../../services/audioService';

export type ReviewAnswerType = 'known' | 'vague' | 'forgotten';

interface ReviewRecallCardProps {
  word: Word;
  onAnswer: (type: ReviewAnswerType) => void;
  toast: (msg: string) => void;
}

export const ReviewRecallCard = ({
  word,
  onAnswer,
  toast,
}: ReviewRecallCardProps) => {
  return (
    <div className="review-recall-page">
      <div className="lbody">
        <WordHeader
          text={word.w}
          level={undefined}
          badge=""
          isMastered={false}
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

      <div className="review-recall-bottom-area">
        {/* 居中复习选择提示文案 */}
        <div className="review-recall-hint">
          <p>瞬间想起词义，选「认识」</p>
          <p>思考后想起词义，选「模糊」</p>
        </div>

        {/* 底部三向作答按钮：认识 (绿) | 模糊 (黄) | 忘记了 (红) */}
        <FooterBar
          buttons={[
            {
              label: '认识',
              color: 'green',
              onClick: () => onAnswer('known'),
            },
            {
              label: '模糊',
              color: 'amber',
              onClick: () => onAnswer('vague'),
            },
            {
              label: '忘记了',
              color: 'red',
              onClick: () => onAnswer('forgotten'),
            },
          ]}
        />
      </div>
    </div>
  );
};
