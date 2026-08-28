interface SidePanelProps {
  onShowStage: (stageNum: number) => void;
  onGoHome: () => void;
  onGoScreen: (screenId: string) => void;
  onGoStudyTab: (tab: 'a' | 'b') => void;
  onOpenExampleDirect: () => void;
  onOpenNoteEditor?: (word?: string) => void;
  onOpenSpelling?: (word?: string) => void;
}

export const SidePanel = ({
  onShowStage,
  onGoHome,
  onGoScreen,
  onGoStudyTab,
  onOpenExampleDirect,
  onOpenNoteEditor,
  onOpenSpelling,
}: SidePanelProps) => {
  return (
    <aside className="panel">
      <h1>不背单词 · 高保真交互原型</h1>
      <div className="sub">React + TypeScript 1:1 像素级完整复刻</div>

      <h4>📖 单词 4 次学习全过程（当前聚焦）</h4>
      <div className="jump" style={{ marginBottom: 14 }}>
        <button onClick={() => onShowStage(1)}>① 第一次遇见</button>
        <button onClick={() => onShowStage(2)}>② 第一次答对</button>
        <button onClick={() => onShowStage(3)}>③ 第二次初遇见</button>
        <button onClick={() => onShowStage(4)}>④ 第二次答对</button>
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

      <h4>🔄 独立复习流程（Review Flow）</h4>
      <div className="jump" style={{ marginBottom: 14 }}>
        <button
          style={{ borderColor: '#f59e0b', color: '#d97706', fontWeight: 600 }}
          onClick={() => onShowStage(9)}
        >
          ⑨ 复习提问态 (图1)
        </button>
        <button
          style={{ borderColor: '#10b981', color: '#10b981', fontWeight: 600 }}
          onClick={() => onShowStage(10)}
        >
          ⑩ 复习答后详情 (图2)
        </button>
      </div>

      <h4>📱 其他功能页面</h4>
      <div className="jump">
        <button onClick={onGoHome}>首页</button>
        <button onClick={() => onGoScreen('s-academy')}>不背学堂</button>
        <button onClick={() => onGoScreen('s-content')}>我的内容</button>
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

      <h4>已复刻页面状态</h4>
      <ul>
        <li>
          <b>第一次遇见</b>：标准 4 选 1 选义题，顶部 7/20、撤回/收藏/abc/熟/更多工具栏；单词右侧 4 个学习进度点（未点亮）；发音胶囊；「先回想词义再选择，想不起来『看答案』」引导语；4 项磨砂玻璃释义卡片；底部「看答案」红标按钮。
        </li>
        <li>
          <b>第一次答对</b>：进入音节拆分详情态 <code>ri·ver</code>；右侧 4 进度点<b>点亮第 1 个绿点</b>（代表已初次识记）；每个释义项下带虚线（点击直达例句）；上卡片展示原声例句与中文、右下角例句卡快捷入口；下卡片展示词组搭配（<code>cross the river</code> 过河，词组带虚线）与词根 Tab，右下角配笔记与查词按钮；底部「下一词」绿标按钮。
        </li>
        <li>
          <b>第二次初遇见</b>：进入例句回想模式，进度 9/20；右侧 4 进度点<b>保留点亮 1 个绿点</b>；单词下方展示两道磨砂遮罩条（隐藏中文释义）；例句卡初始仅展示纯英文例句；中下方配备「提示一下」灯泡按钮（点击展开例句中文释义）；底部变为「认识 / 不认识」双向选择操作。
        </li>
        <li>
          <b>第二次答对</b>：在 4 进度点中<b>点亮 2 个绿点</b>；进度点右侧触发<b>「👍 2」</b>半透明徽章（代表已连续答对 2 次）；展示原声例句卡与词组搭配助记；底部呈现<b>「下一词（绿标） / 记错了（红标）」</b>双按键，支持误判纠错。
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
      <div className="foot">
        基于 React + TypeScript 1:1 像素级复刻 · 与 prototype.html 100% 对齐
      </div>
    </aside>
  );
};
