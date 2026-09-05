import { uiClass } from '../../ui/classes';
import type { PrototypeLearningTargetId } from '../../learningJourney/prototypeLearning';

interface LearningEntryScreenProps {
  active: boolean;
  onBack: () => void;
  onOpenTarget: (targetId: PrototypeLearningTargetId) => void;
  onOpenPersonalSemanticWorld: () => void;
}

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="5.5" />
    <path d="m15 15 4.5 4.5" />
  </svg>
);

export const LearningEntryScreen = ({
  active,
  onBack,
  onOpenTarget,
  onOpenPersonalSemanticWorld,
}: LearningEntryScreenProps) => (
  <section
    className={uiClass(`screen learning-surface${active ? ' active' : ''}`, "#s-learning-entry")}
    id="s-learning-entry"
    data-anim="slide"
  >
    <header className={uiClass("learning-page-nav")}>
      <button type="button" onClick={onBack} aria-label="返回我的学习">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
      </button>
      <div>
        <small>添加学习内容</small>
        <h1>选择从哪里开始</h1>
      </div>
    </header>

    <main className={uiClass("learning-page-body learning-entry-body")}>
      <div className={uiClass("learning-entry-options")} aria-label="学习内容来源">
        <button
          type="button"
          className={uiClass("learning-entry-choice is-book")}
          onClick={() => onOpenTarget('lend-give')}
        >
          <span className={uiClass("learning-entry-choice-mark")} aria-hidden="true">书</span>
          <span className={uiClass("learning-entry-choice-copy")}>
            <strong>词书</strong>
            <small>从已发布内容选择</small>
          </span>
          <span className={uiClass("learning-entry-choice-arrow")} aria-hidden="true">↗</span>
        </button>

        <button
          type="button"
          className={uiClass("learning-entry-choice is-search")}
          onClick={() => onOpenTarget('borrow-receive')}
        >
          <span className={uiClass("learning-entry-choice-mark")} aria-hidden="true"><SearchIcon /></span>
          <span className={uiClass("learning-entry-choice-copy")}>
            <strong>搜索</strong>
            <small>查找一个具体意思</small>
          </span>
          <span className={uiClass("learning-entry-choice-arrow")} aria-hidden="true">↗</span>
        </button>

        <button
          type="button"
          className={uiClass("learning-entry-choice is-personal")}
          onClick={onOpenPersonalSemanticWorld}
        >
          <span className={uiClass("learning-entry-choice-mark")} aria-hidden="true">我</span>
          <span className={uiClass("learning-entry-choice-copy")}>
            <strong>我的词义世界</strong>
            <small>从已确认内容加入</small>
          </span>
          <span className={uiClass("learning-entry-choice-arrow")} aria-hidden="true">→</span>
        </button>
      </div>
    </main>
  </section>
);
