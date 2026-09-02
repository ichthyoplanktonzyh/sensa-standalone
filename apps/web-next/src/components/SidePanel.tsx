import type { RevealPresentation } from './cards/IntroductionCard';
import type { ExamplePresentation } from './ExampleScreen';
import type { RecognitionPresentation } from './cards/RecognitionCard';
import type { RecallPresentation } from './cards/RecallCard';
import type { NovelTransferPresentation } from './cards/NovelTransferCard';
import type { SemanticWorldPresentation } from './SemanticWorldScreen';
import type { PracticeHomePresentation } from './AcademyScreen';
import type { PortableListeningPresentation } from './PortableListeningScreen';
import type { RealWorldListeningPresentation } from './RealWorldListeningScreen';
import type { ReviewPresentation } from './cards/review/SensaReviewAssessmentCard';
import type { DictionaryPresentation } from './DictionaryPresentationContext';

interface SidePanelProps {
  onShowStage: (stageNum: number) => void;
  onGoHome: () => void;
  onGoScreen: (screenId: string) => void;
  onSeedSemanticWorld: () => void;
  onGoStudyTab: (tab: 'a' | 'b') => void;
  onOpenExampleDirect: () => void;
  onOpenNoteEditor?: (word?: string) => void;
  onOpenSpelling?: (word?: string) => void;
  revealPresentation: RevealPresentation;
  onRevealPresentationChange: (presentation: RevealPresentation) => void;
  examplePresentation: ExamplePresentation;
  onExamplePresentationChange: (presentation: ExamplePresentation) => void;
  recognitionPresentation: RecognitionPresentation;
  onRecognitionPresentationChange: (presentation: RecognitionPresentation) => void;
  recallPresentation: RecallPresentation;
  onRecallPresentationChange: (presentation: RecallPresentation) => void;
  novelTransferPresentation: NovelTransferPresentation;
  onNovelTransferPresentationChange: (presentation: NovelTransferPresentation) => void;
  reviewPresentation: ReviewPresentation;
  onReviewPresentationChange: (presentation: ReviewPresentation) => void;
  semanticWorldPresentation: SemanticWorldPresentation;
  onSemanticWorldPresentationChange: (presentation: SemanticWorldPresentation) => void;
  practiceHomePresentation: PracticeHomePresentation;
  onPracticeHomePresentationChange: (presentation: PracticeHomePresentation) => void;
  portableListeningPresentation: PortableListeningPresentation;
  onPortableListeningPresentationChange: (presentation: PortableListeningPresentation) => void;
  realWorldListeningPresentation: RealWorldListeningPresentation;
  onRealWorldListeningPresentationChange: (presentation: RealWorldListeningPresentation) => void;
  dictionaryPresentation: DictionaryPresentation;
  onDictionaryPresentationChange: (presentation: DictionaryPresentation) => void;
}

export const SidePanel = ({
  onShowStage,
  onGoHome,
  onGoScreen,
  onSeedSemanticWorld,
  onGoStudyTab,
  onOpenExampleDirect,
  onOpenNoteEditor,
  onOpenSpelling,
  revealPresentation,
  onRevealPresentationChange,
  examplePresentation,
  onExamplePresentationChange,
  recognitionPresentation,
  onRecognitionPresentationChange,
  recallPresentation,
  onRecallPresentationChange,
  novelTransferPresentation,
  onNovelTransferPresentationChange,
  reviewPresentation,
  onReviewPresentationChange,
  semanticWorldPresentation,
  onSemanticWorldPresentationChange,
  practiceHomePresentation,
  onPracticeHomePresentationChange,
  portableListeningPresentation,
  onPortableListeningPresentationChange,
  realWorldListeningPresentation,
  onRealWorldListeningPresentationChange,
  dictionaryPresentation,
  onDictionaryPresentationChange,
}: SidePanelProps) => {
  return (
    <aside className="panel">
      <h1>Sensa · 语义学习 Runtime 原型</h1>
      <div className="sub">React + TypeScript · 本地交互检查台</div>

      <h4>📖 Sensa 学习卡片（逐项确认）</h4>
      <div className="prototype-presentation-switch" aria-label="Reveal 展示密度">
        <span>Reveal 展示</span>
        <div role="group" aria-label="选择 Reveal 展示版本">
          <button
            type="button"
            className={revealPresentation === 'compact' ? 'active' : ''}
            aria-pressed={revealPresentation === 'compact'}
            onClick={() => onRevealPresentationChange('compact')}
          >
            Compact
          </button>
          <button
            type="button"
            className={revealPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={revealPresentation === 'baseline'}
            onClick={() => onRevealPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="prototype-presentation-switch" aria-label="第二次接触卡展示版本">
        <span>第二次接触</span>
        <div role="group" aria-label="选择第二次接触卡展示版本">
          <button
            type="button"
            className={recognitionPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={recognitionPresentation === 'sensa'}
            onClick={() => onRecognitionPresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={recognitionPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={recognitionPresentation === 'baseline'}
            onClick={() => onRecognitionPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="prototype-presentation-switch" aria-label="意思到英文卡展示版本">
        <span>意思到英文</span>
        <div role="group" aria-label="选择意思到英文卡展示版本">
          <button
            type="button"
            className={recallPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={recallPresentation === 'sensa'}
            onClick={() => onRecallPresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={recallPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={recallPresentation === 'baseline'}
            onClick={() => onRecallPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="prototype-presentation-switch" aria-label="新语境迁移卡展示版本">
        <span>新语境迁移</span>
        <div role="group" aria-label="选择新语境迁移卡展示版本">
          <button
            type="button"
            className={novelTransferPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={novelTransferPresentation === 'sensa'}
            onClick={() => onNovelTransferPresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={novelTransferPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={novelTransferPresentation === 'baseline'}
            onClick={() => onNovelTransferPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="jump" style={{ marginBottom: 14 }}>
        <button onClick={() => onShowStage(1)}>① Experience / Reveal</button>
        <button onClick={() => onShowStage(2)}>② 语境判断</button>
        <button onClick={() => onShowStage(3)}>③ 意思 → 英文</button>
        <button onClick={() => onShowStage(4)}>④ 新语境迁移</button>
        <button onClick={() => onShowStage(5)}>⑤ 第三次初遇见</button>
        <button onClick={() => onShowStage(6)}>⑥ 第三次答对</button>
        <button
          style={{ borderColor: '#10b981', color: '#10b981', fontWeight: 600 }}
          onClick={() => onShowStage(7)}
        >
          ⑦ 第4次遇见
        </button>
        <button
          style={{ borderColor: '#10b981', color: '#10b981', fontWeight: 600 }}
          onClick={() => onShowStage(8)}
        >
          ⑧ 最后一次答对（掌握）
        </button>
      </div>

      <div className="prototype-presentation-switch" aria-label="例句卡展示版本">
        <span>例句卡</span>
        <div role="group" aria-label="选择例句卡展示版本">
          <button
            type="button"
            className={examplePresentation === 'sensa' ? 'active' : ''}
            aria-pressed={examplePresentation === 'sensa'}
            onClick={() => onExamplePresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={examplePresentation === 'baseline' ? 'active' : ''}
            aria-pressed={examplePresentation === 'baseline'}
            onClick={() => onExamplePresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>

      <h4>🔄 长期复习卡片（FSRS 只管何时）</h4>
      <div className="prototype-presentation-switch" aria-label="长期复习卡展示版本">
        <span>复习卡片</span>
        <div role="group" aria-label="选择长期复习卡展示版本">
          <button
            type="button"
            className={reviewPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={reviewPresentation === 'sensa'}
            onClick={() => onReviewPresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={reviewPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={reviewPresentation === 'baseline'}
            onClick={() => onReviewPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="jump" style={{ marginBottom: 14 }}>
        <button
          style={{ borderColor: '#f59e0b', color: '#d97706', fontWeight: 600 }}
          onClick={() => onShowStage(9)}
        >
          ⑨ 语境判断
        </button>
        <button
          style={{ borderColor: '#10b981', color: '#10b981', fontWeight: 600 }}
          onClick={() => onShowStage(10)}
        >
          ⑩ 意思 → 英文
        </button>
        <button
          style={{ borderColor: '#0ea5e9', color: '#0284c7', fontWeight: 600 }}
          onClick={() => onShowStage(11)}
        >
          ⑪ 新语境迁移
        </button>
        <button
          style={{ borderColor: '#8b5cf6', color: '#7c3aed', fontWeight: 600 }}
          onClick={() => onShowStage(12)}
        >
          ⑫ 条件边界对比
        </button>
        <button
          style={{ borderColor: '#e85d3f', color: '#d64a2e', fontWeight: 600 }}
          onClick={() => onShowStage(13)}
        >
          ⑬ Adaptive Feedback / Repair
        </button>
      </div>

      <h4>📱 其他功能页面</h4>
      <div className="prototype-presentation-switch" aria-label="我的词义世界展示版本">
        <span>词义世界</span>
        <div role="group" aria-label="选择我的词义世界展示版本">
          <button
            type="button"
            className={semanticWorldPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={semanticWorldPresentation === 'sensa'}
            onClick={() => onSemanticWorldPresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={semanticWorldPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={semanticWorldPresentation === 'baseline'}
            onClick={() => onSemanticWorldPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="prototype-presentation-switch" aria-label="自由练习首页展示版本">
        <span>自由练习</span>
        <div role="group" aria-label="选择自由练习首页展示版本">
          <button
            type="button"
            className={practiceHomePresentation === 'sensa' ? 'active' : ''}
            aria-pressed={practiceHomePresentation === 'sensa'}
            onClick={() => onPracticeHomePresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={practiceHomePresentation === 'baseline' ? 'active' : ''}
            aria-pressed={practiceHomePresentation === 'baseline'}
            onClick={() => onPracticeHomePresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="prototype-presentation-switch" aria-label="随身听展示版本">
        <span>随身听</span>
        <div role="group" aria-label="选择随身听展示版本">
          <button
            type="button"
            className={portableListeningPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={portableListeningPresentation === 'sensa'}
            onClick={() => onPortableListeningPresentationChange('sensa')}
          >
            Sensa MVP
          </button>
          <button
            type="button"
            className={portableListeningPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={portableListeningPresentation === 'baseline'}
            onClick={() => onPortableListeningPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="prototype-presentation-switch" aria-label="真实语流展示版本">
        <span>真实语流</span>
        <div role="group" aria-label="选择真实语流展示版本">
          <button
            type="button"
            className={realWorldListeningPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={realWorldListeningPresentation === 'sensa'}
            onClick={() => onRealWorldListeningPresentationChange('sensa')}
          >
            Sensa
          </button>
          <button
            type="button"
            className={realWorldListeningPresentation === 'youglish' ? 'active' : ''}
            aria-pressed={realWorldListeningPresentation === 'youglish'}
            onClick={() => onRealWorldListeningPresentationChange('youglish')}
          >
            YouGlish
          </button>
        </div>
      </div>
      <div className="prototype-presentation-switch" aria-label="词典展示版本">
        <span>词典</span>
        <div role="group" aria-label="选择词典展示版本">
          <button
            type="button"
            className={dictionaryPresentation === 'sensa' ? 'active' : ''}
            aria-pressed={dictionaryPresentation === 'sensa'}
            onClick={() => onDictionaryPresentationChange('sensa')}
          >
            Sensa MVP
          </button>
          <button
            type="button"
            className={dictionaryPresentation === 'baseline' ? 'active' : ''}
            aria-pressed={dictionaryPresentation === 'baseline'}
            onClick={() => onDictionaryPresentationChange('baseline')}
          >
            Baseline
          </button>
        </div>
      </div>
      <div className="jump">
        <button onClick={onGoHome}>首页</button>
        <button onClick={() => onGoScreen('s-academy')}>自由练习</button>
        <button onClick={() => onGoScreen('s-content')}>我的内容</button>
        <button onClick={() => onGoScreen('s-semantic-world')}>我的词义世界</button>
        <button
          style={{ borderColor: '#91789d', color: '#a88ab5', fontWeight: 600 }}
          onClick={onSeedSemanticWorld}
        >
          填充 3 个复习节点
        </button>
        <button
          style={{ borderColor: '#f97316', color: '#ea580c', fontWeight: 600 }}
          onClick={() => onGoScreen('s-wordlist')}
        >
          📖 在学词书 (图1~3)
        </button>
        <button
          style={{ borderColor: '#eab308', color: '#ca8a04', fontWeight: 600 }}
          onClick={() => onGoScreen('s-stats')}
        >
          📊 学习统计概览 (图1~2)
        </button>
        <button onClick={() => onGoStudyTab('a')}>我的学习</button>
        <button onClick={() => onGoStudyTab('b')}>学习偏好</button>
        <button onClick={onOpenExampleDirect}>原声例句卡</button>
        <button
          style={{ borderColor: '#6366f1', color: '#6366f1', fontWeight: 600 }}
          onClick={() => onOpenNoteEditor?.('path')}
        >
          ✏️ 唤起笔记编辑 (图1)
        </button>
        <button
          style={{ borderColor: '#f97316', color: '#ea580c', fontWeight: 600 }}
          onClick={() => onOpenSpelling?.('folk')}
        >
          ⌨️ 单词拼写练习 (abc)
        </button>
      </div>

      <h4>可检查的学习状态</h4>
      <ul>
        <li>
          <b>Experience / Reveal</b>：先建立具体经验，再揭示词形、当前义项、必要的使用边界与一个新语境；Compact 是默认方案，Baseline 保留当前完整信息版供对照。笔记和我的场景作为义项旁的轻量入口，不中断主学习流程。
        </li>
        <li>
          <b>语境判断</b>：用 Package 中受保护的 Recognition 语境检验当前具体意思；提交前隐藏译文和解释，提交后在原卡片内显示正误、定向修复与关键语义线索。
        </li>
        <li>
          <b>意思 → 英文</b>：先用义项线索独立输入英文形式；需要时可逐步降到首字母提示和英文选词。只有无提示输入正确才算独立 Recall，通过提示找回或选对只完成连接修复，并在穿插后再次检验。
        </li>
        <li>
          <b>新语境迁移</b>：提交前隐藏目标词，用陌生对象中的行动决策检验义项能否迁移；提交后揭晓受保护例句和“不变的意思结构”。答错不清空前序学习，而是换一条未曝光 Transfer 场景再次检验。
        </li>
        <li>
          <b>长期 Review</b>：Sensa 版复用 Learn 已确认的语境判断、意思到表达和新语境迁移体验，但关闭会泄露独立结果的渐进提示；Baseline 完整保留。统一结果卡只做反馈与定向修复，一次复习最多生成一个 Memory Outcome、更新一次 FSRS。当前 fragile 没有必需的 Boundary target，因此边界卡只作为不写 Evidence 的条件能力预览。
        </li>
        <li>
          <b>第三次初遇见</b>：进入纯听音选义模式，进度 13/20；单词文本被隐藏，替换为<b>醒目的大号磨砂玻璃喇叭发音大卡片</b>；右侧 4 进度点<b>保留点亮 2 个绿点</b>；音标与发音胶囊保留；展示全新 4 项释义干扰项（如骑马、大米等）；底部保留「看答案」红标按钮。
        </li>
        <li>
          <b>第三次答对</b>：在 4 进度点中<b>点亮 3 个绿点</b>（<code>🟢 🟢 🟢 ⚪</code>）；右侧勋章进阶为<b>「👍 3」</b>（代表已连续答对 3 次）；展示完整释义、例句与助记卡片；底部呈现<b>「下一词（绿标） / 记错了（红标）」</b>双按键。
        </li>
        <li>
          <b>第4次遇见</b>：终极无提示回想考核，进度 18/20；单词展示为 <code>river</code>，右侧 4 进度点<b>点亮 3 个绿点</b>（<code>🟢 🟢 🟢 ⚪</code>）；下方两道磨砂遮罩条；无任何例句与提示按钮；底部上方呈现<b>「本词最后一关😉：请在无提示的情况下判断」</b>文案；底部「认识 / 不认识」终极裁决。
        </li>
        <li>
          <b>最后一次答对（掌握）</b>：达成 4 次完整学习，进度 19/20；单词恢复音节拆分 <code>ri·ver</code>；右上方原 4 个进度点替换为<b>亮绿色掌握勋章「✔」</b>；展示原声例句卡与词组搭配助记；底部呈现「下一词 / 记错了」。
        </li>
      </ul>
      <div className="foot">Sensa Runtime MVP · 仅用于本地产品与交互验证</div>
    </aside>
  );
};
