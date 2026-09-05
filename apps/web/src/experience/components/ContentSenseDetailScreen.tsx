import { uiClass } from '../ui/classes';
import { useEffect, useMemo, useState } from 'react';
import { semanticStatusLabel, type SemanticStatus } from '../contentProjection';
import { PRACTICE_SENSES, type PracticeSenseItem } from '../practiceData';
import { audioService } from '../services/audioService';
import { noteService } from '../services/noteService';
import { personalContentService } from '../services/personalContentService';
import { useContentProjection } from '../useContentProjection';

interface ContentSenseDetailScreenProps {
  active: boolean;
  item: PracticeSenseItem | null;
  onBack: () => void;
  onOpenExample: (item: PracticeSenseItem) => void;
  onOpenSense: (item: PracticeSenseItem) => void;
  onOpenDictionary: (item: PracticeSenseItem) => void;
  onEditNote: (item: PracticeSenseItem) => void;
  toast: (message: string) => void;
}

export const ContentSenseDetailScreen = ({
  active,
  item,
  onBack,
  onOpenExample,
  onOpenSense,
  onOpenDictionary,
  onEditNote,
  toast,
}: ContentSenseDetailScreenProps) => {
  const projection = useContentProjection();
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!item) return;
    const refresh = () => {
      setSaved(personalContentService.isSenseSaved(item.senseId));
      setNote(noteService.getSenseNote(item.senseId));
    };
    refresh();
    const unsubscribeSaved = personalContentService.subscribe(refresh);
    const unsubscribeNotes = noteService.subscribe(refresh);
    return () => {
      unsubscribeSaved();
      unsubscribeNotes();
    };
  }, [item]);

  const siblings = useMemo(() => item
    ? PRACTICE_SENSES.filter((candidate) => candidate.wordId === item.wordId && candidate.senseId !== item.senseId)
    : [], [item]);
  const semanticState = item
    ? projection.semanticSenses.find((entry) => entry.senseId === item.senseId)?.status
    : undefined;

  if (!item) return null;

  const toggleSaved = () => {
    const next = personalContentService.toggleSense(item.senseId);
    setSaved(next);
    toast(next ? '已收藏这个意思' : '已取消收藏这个意思');
  };

  return (
    <section className={uiClass(`screen content-detail-screen${active ? ' active' : ''}`, "#s-content-sense")} id="s-content-sense" data-anim="slide">
      <header className={uiClass("content-nav content-detail-nav")}>
        <button className={uiClass("content-nav-back")} onClick={onBack} aria-label="返回上一页">
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>
        <span className={uiClass("content-detail-kicker")}>具体意思</span>
        <button className={uiClass(`content-save-button${saved ? ' on' : ''}`)} onClick={toggleSaved} aria-pressed={saved} aria-label={saved ? '取消收藏这个意思' : '收藏这个意思'}>
          <svg className={uiClass("icon")}><use href="#i-star" /></svg>
        </button>
      </header>

      <div className={uiClass("content-page-body sense-detail-body")}>
        <section className={uiClass("sense-detail-hero")}>
          <div className={uiClass("sense-detail-wordline")}>
            <h1>{item.word}</h1>
            <span>{item.pos}</span>
          </div>
          <div className={uiClass("sense-detail-phonetic")}>
            <button onClick={() => void audioService.playWord(item.word, 'us')} aria-label="播放美式发音">
              <svg className={uiClass("icon")}><use href="#i-vol" /></svg>美音
            </button>
            <span>{item.phonetic}</span>
          </div>
          <p className={uiClass("sense-detail-meaning")}>{item.meaning}</p>
          {semanticState && (
            <span className={uiClass(`semantic-status-pill sense-detail-status status-${semanticState}`)}>
              {semanticStatusLabel[semanticState as SemanticStatus]}
            </span>
          )}
        </section>

        <section className={uiClass("sense-detail-section")}>
          <div className={uiClass("sense-section-heading")}>
            <span>学习例句</span>
            <button onClick={() => onOpenExample(item)}>查看详情</button>
          </div>
          <div className={uiClass("sense-example-card")}>
            <button className={uiClass("sense-example-open")} onClick={() => onOpenExample(item)}>
              <span className={uiClass("sense-example-source")}>{item.example.sourceLabel}</span>
              <strong>{item.example.text}</strong>
              {item.example.translation && <small>{item.example.translation}</small>}
            </button>
            <button className={uiClass("sense-example-play")} onClick={() => {
              void audioService.playSentence(item.example.text, 'us');
            }} aria-label="播放学习例句">
              <svg className={uiClass("icon")}><use href="#i-vol" /></svg>
            </button>
          </div>
        </section>

        <section className={uiClass("sense-detail-section")}>
          <div className={uiClass("sense-section-heading")}><span>我的记录</span></div>
          <button className={uiClass("sense-note-card")} onClick={() => onEditNote(item)}>
            <span className={uiClass("sense-note-icon")}><svg className={uiClass("icon")}><use href="#i-pen" /></svg></span>
            <span>
              <b>{note ? '我的笔记' : '给这个意思写笔记'}</b>
              <small>{note || '写下自己的理解、联想或易混提醒'}</small>
            </span>
            <svg className={uiClass("chev")}><use href="#i-chev-r" /></svg>
          </button>
        </section>

        {siblings.length > 0 && (
          <section className={uiClass("sense-detail-section")}>
            <div className={uiClass("sense-section-heading")}><span>这个单词的其他意思</span><em>{siblings.length}</em></div>
            <div className={uiClass("sense-sibling-card")}>
              {siblings.map((sibling) => (
                <button key={sibling.senseId} onClick={() => onOpenSense(sibling)}>
                  <span><em>{sibling.pos}</em>{sibling.meaning}</span>
                  <svg className={uiClass("chev")}><use href="#i-chev-r" /></svg>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className={uiClass("sense-detail-actions")}>
          <button onClick={() => onOpenDictionary(item)}>
            <svg className={uiClass("icon")}><use href="#i-bookopen" /></svg>
            <span><b>查看词典</b><small>完整词条与相关内容</small></span>
          </button>
          <button className={uiClass("is-later")} onClick={() => toast('加入学习暂未开放；收藏不会自动进入学习计划')}>
            <svg className={uiClass("icon")}><use href="#i-relearn" /></svg>
            <span><b>加入学习</b><small>暂未开放</small></span>
          </button>
        </div>
      </div>
    </section>
  );
};
