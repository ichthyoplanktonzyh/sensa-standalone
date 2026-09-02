import { useEffect, useState } from 'react';
import { noteService } from '../services/noteService';
import {
  personalContentService,
  type PersonalSemanticAnchor,
} from '../services/personalContentService';

interface PersonalConnectionActionsProps {
  senseId: string;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  variant?: 'reveal' | 'feedback' | 'compact';
}

interface PersonalConnectionState {
  note: string;
  anchors: PersonalSemanticAnchor[];
}

export function PersonalConnectionActions({
  senseId,
  onOpenNote,
  onOpenScene,
  variant = 'feedback',
}: PersonalConnectionActionsProps) {
  const [state, setState] = useState<PersonalConnectionState>({ note: '', anchors: [] });

  useEffect(() => {
    const refresh = () => {
      setState({
        note: noteService.getSenseNote(senseId),
        anchors: personalContentService.getSemanticAnchors(senseId),
      });
    };
    refresh();
    const unsubscribeNotes = noteService.subscribe(refresh);
    const unsubscribeAnchors = personalContentService.subscribe(refresh);
    return () => {
      unsubscribeNotes();
      unsubscribeAnchors();
    };
  }, [senseId]);

  const hasNote = state.note.trim().length > 0;
  const anchorCount = state.anchors.length;
  const latestAnchorId = state.anchors[0]?.anchorId;
  const hasPersonalConnection = hasNote || anchorCount > 0;

  if (variant === 'compact') {
    return (
      <div
        className={`personal-connection-compact${hasPersonalConnection ? ' has-content' : ''}`}
        aria-label="当前义项的个人内容"
      >
        <button
          type="button"
          onClick={onOpenNote}
          aria-label={hasNote ? '编辑当前义项的笔记' : '为当前义项添加笔记'}
        >
          <svg className="icon" aria-hidden="true"><use href="#i-pen" /></svg>
          <span>笔记</span>
          {hasNote && <i aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onOpenScene(latestAnchorId)}
          aria-label={anchorCount > 0 ? `查看当前义项的我的场景，共 ${anchorCount} 个` : '为当前义项建立我的场景'}
        >
          <svg className="icon" aria-hidden="true"><use href="#i-bulb" /></svg>
          <span>我的场景</span>
          {anchorCount > 0 && <b aria-hidden="true">{anchorCount}</b>}
        </button>
      </div>
    );
  }

  return (
    <section
      className={`personal-connection-actions is-${variant}${hasPersonalConnection ? ' has-content' : ''}`}
      aria-label="当前义项的个人连接"
    >
      <header>
        <div>
          <span>PERSONAL CONTENT</span>
          <h3>{hasPersonalConnection ? '我的连接' : '留下你的连接'}</h3>
        </div>
        {hasPersonalConnection && (
          <small>
            {hasNote ? '已有笔记' : '暂无笔记'} · {anchorCount > 0 ? `${anchorCount} 个场景` : '暂无场景'}
          </small>
        )}
      </header>

      {!hasPersonalConnection && (
        <p>把此刻的理解或真实经历留在这个意思旁边；它不会改变学习结果。</p>
      )}

      <div className="personal-connection-grid">
        <button type="button" onClick={onOpenNote}>
          <span className="personal-connection-icon" aria-hidden="true">
            <svg className="icon"><use href="#i-pen" /></svg>
          </span>
          <span>
            <b>{hasNote ? '编辑笔记' : '记一句笔记'}</b>
            <small>{hasNote ? '继续整理自己的理解' : '留下理解和提醒'}</small>
          </span>
          <svg className="icon personal-connection-chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>

        <button
          type="button"
          onClick={() => onOpenScene(latestAnchorId)}
        >
          <span className="personal-connection-icon" aria-hidden="true">
            <svg className="icon"><use href="#i-bulb" /></svg>
          </span>
          <span>
            <b>{anchorCount > 0 ? '查看我的场景' : '建立我的场景'}</b>
            <small>{anchorCount > 0 ? '编辑最近的一条连接' : '连接到真实个人经历'}</small>
          </span>
          <svg className="icon personal-connection-chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
      </div>

      {anchorCount > 0 && (
        <button
          type="button"
          className="personal-connection-new-scene"
          onClick={() => onOpenScene()}
        >
          <svg className="icon" aria-hidden="true"><use href="#i-penplus" /></svg>
          再建立一个场景
        </button>
      )}
    </section>
  );
}
