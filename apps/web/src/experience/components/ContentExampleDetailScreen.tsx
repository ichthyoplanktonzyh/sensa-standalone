import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { uiClass } from '../ui/classes';
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
  useTranslation();
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
    toast(next ? uiText('exampleSaved') : uiText('exampleRemovedFromSaved'));
  };

  return (
    <section className={uiClass(`screen content-example-detail${active ? ' active' : ''}`, "#s-content-example")} id="s-content-example" data-anim="slide">
      <header className={uiClass("content-nav content-example-nav")}>
        <button className={uiClass("content-nav-back")} onClick={onBack} aria-label={uiText('back2')}>
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>
        <h1>{uiText('learningExample')}</h1>
        <button className={uiClass(`content-save-button${saved ? ' on' : ''}`)} onClick={toggleSaved} aria-pressed={saved} aria-label={saved ? uiText('unsaveExample') : uiText('saveExample')}>
          <svg className={uiClass("icon")}><use href="#i-star" /></svg>
        </button>
      </header>

      <div className={uiClass("example-detail-stage")}>
        <div className={uiClass("example-detail-orb orb-one")} />
        <div className={uiClass("example-detail-orb orb-two")} />
        <span className={uiClass("example-detail-label")}>{item.example.sourceLabel}</span>
        <blockquote>{item.example.text}</blockquote>
        {showTranslation && item.example.translation && <p>{item.example.translation}</p>}
        <button className={uiClass("example-audio-button")} onClick={() => void audioService.playSentence(item.example.text, 'us')}>
          <svg className={uiClass("icon")}><use href="#i-vol" /></svg>
          {uiText('playExample')}</button>
      </div>

      <div className={uiClass("example-detail-controls")}>
        <button onClick={() => setShowTranslation((visible) => !visible)}>
          <svg className={uiClass("icon")}><use href={showTranslation ? '#i-eye-lashes' : '#i-eye'} /></svg>
          <span>{showTranslation ? uiText('hideTranslation') : uiText('showTranslation')}</span>
        </button>
        <button onClick={toggleSaved} className={uiClass(saved ? 'on' : '')}>
          <svg className={uiClass("icon")}><use href="#i-star" /></svg>
          <span>{saved ? uiText('saved') : uiText('saveExample')}</span>
        </button>
      </div>

      <button className={uiClass("example-sense-link")} onClick={() => onOpenSense(item)}>
        <span className={uiClass("example-sense-word")}>{item.word}</span>
        <span className={uiClass("example-sense-copy")}><b>{item.pos} {item.meaning}</b><small>{uiText('viewThisExampleSMeaning')}</small></span>
        <svg className={uiClass("chev")}><use href="#i-chev-r" /></svg>
      </button>
    </section>
  );
};
