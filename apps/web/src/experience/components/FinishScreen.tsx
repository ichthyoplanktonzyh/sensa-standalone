import { uiClass } from '../ui/classes';
interface FinishScreenProps {
  active: boolean;
  mode?: 'learn' | 'review';
  onContinue?: () => void;
  onExit: () => void;
  wordCount?: number;
  accuracy?: number;
  minutes?: number;
}

export const FinishScreen = ({
  active,
  mode = 'learn',
  onContinue,
  onExit,
  wordCount = 20,
  accuracy = 85,
  minutes = 2,
}: FinishScreenProps) => {
  const isReview = mode === 'review';

  return (
    <section className={uiClass(`screen${active ? ' active' : ''}`, "#s-finish")} id="s-finish" data-anim="fade">
      <div className={uiClass("fin")}>
        <div className={uiClass("em")}>{isReview ? '💪' : '🎉'}</div>
        <h3>{isReview ? '今日复习完成' : '本组学习完成'}</h3>
        <p>
          {isReview
            ? `共复习 ${wordCount} 词，记忆巩固达成`
            : `共 ${wordCount} 词，休息一下再继续吧`}
        </p>
        <div className={uiClass("grid")}>
          <div className={uiClass("g")}>
            <b id="finN">{wordCount}</b>
            <span>{isReview ? '复习词' : '新学词'}</span>
          </div>
          <div className={uiClass("g")}>
            <b id="finAcc">{accuracy}%</b>
            <span>{isReview ? '留存率' : '正确率'}</span>
          </div>
          <div className={uiClass("g")}>
            <b id="finMin">{minutes}</b>
            <span>分钟</span>
          </div>
        </div>
        {!isReview && onContinue && (
          <button className={uiClass("btn p")} onClick={onContinue}>
            继续学习下一组
          </button>
        )}
        <button className={uiClass(isReview ? 'btn p' : 'btn g')} onClick={onExit}>
          回首页休息一下
        </button>
      </div>
    </section>
  );
};
