import { useEffect, useState } from 'react';
import { exampleIdForSense } from '../contentProjection';
import type { PracticeSenseItem } from '../practiceData';
import { audioService } from '../services/audioService';
import { personalContentService } from '../services/personalContentService';

interface ContentExampleDetailScreenProps {
  active: boolean;
  item: PracticeSenseItem | null;
  onBack: () => void;
  onOpenSense: (item: PracticeSenseItem) => void;
  toast: (message: string) => void;
}

export const ContentExampleDetailScreen = ({
  active,
  item,
  onBack,
  onOpenSense,
  toast,
}: ContentExampleDetailScreenProps) => {
  const [saved, setSaved] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);

  useEffect(() => {
    if (!item) return;
    setShowTranslation(true);
    const exampleId = exampleIdForSense(item);
    const refresh = () => setSaved(personalContentService.isExampleSaved(exampleId));
    refresh();
    return personalContentService.subscribe(refresh);
  }, [item]);

  if (!item) return null;
  const exampleId = exampleIdForSense(item);

  const toggleSaved = () => {
    const next = personalContentService.toggleExample(exampleId);
    setSaved(next);
    toast(next ? '已收藏这条例句' : '已取消收藏这条例句');
  };

  return (
    <section className={`screen content-example-detail${active ? ' active' : ''}`} id="s-content-example" data-anim="slide">
      <header className="content-nav content-example-nav">
        <button className="content-nav-back" onClick={onBack} aria-label="返回上一页">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>
        <h1>学习例句</h1>
        <button className={`content-save-button${saved ? ' on' : ''}`} onClick={toggleSaved} aria-pressed={saved} aria-label={saved ? '取消收藏例句' : '收藏例句'}>
          <svg className="icon"><use href="#i-star" /></svg>
        </button>
      </header>

      <div className="example-detail-stage">
        <div className="example-detail-orb orb-one" />
        <div className="example-detail-orb orb-two" />
        <span className="example-detail-label">{item.example.sourceLabel}</span>
        <blockquote>{item.example.text}</blockquote>
        {showTranslation && item.example.translation && <p>{item.example.translation}</p>}
        <button className="example-audio-button" onClick={() => void audioService.playSentence(item.example.text, 'us')}>
          <svg className="icon"><use href="#i-vol" /></svg>
          播放例句
        </button>
      </div>

      <div className="example-detail-controls">
        <button onClick={() => setShowTranslation((visible) => !visible)}>
          <svg className="icon"><use href={showTranslation ? '#i-eye-lashes' : '#i-eye'} /></svg>
          <span>{showTranslation ? '隐藏译文' : '显示译文'}</span>
        </button>
        <button onClick={toggleSaved} className={saved ? 'on' : ''}>
          <svg className="icon"><use href="#i-star" /></svg>
          <span>{saved ? '已收藏' : '收藏例句'}</span>
        </button>
      </div>

      <button className="example-sense-link" onClick={() => onOpenSense(item)}>
        <span className="example-sense-word">{item.word}</span>
        <span className="example-sense-copy"><b>{item.pos} {item.meaning}</b><small>查看这句话对应的具体意思</small></span>
        <svg className="chev"><use href="#i-chev-r" /></svg>
      </button>
    </section>
  );
};
