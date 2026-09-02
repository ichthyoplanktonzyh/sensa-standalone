import type { SemanticWorldPresentation } from './SemanticWorldScreen';
import type { PracticeHomePresentation } from './AcademyScreen';
import type { PortableListeningPresentation } from './PortableListeningScreen';
import type { RealWorldListeningPresentation } from './RealWorldListeningScreen';
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
      <div className="jump" style={{ marginBottom: 14 }}>
        <button onClick={() => onShowStage(1)}>① Experience / Reveal</button>
        <button onClick={() => onShowStage(2)}>② 语境判断</button>
        <button onClick={() => onShowStage(3)}>③ 意思 → 英文</button>
        <button onClick={() => onShowStage(4)}>④ 新语境迁移</button>
      </div>

      <h4>🔄 长期复习卡片（FSRS 只管何时）</h4>
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
    </aside>
  );
};
