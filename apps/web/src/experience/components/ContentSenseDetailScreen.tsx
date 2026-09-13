import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { uiClass } from '../ui/classes';
import { useEffect, useMemo, useState } from 'react';
import { contentAnnotations } from '../../data/library/contentAnnotations';
import { semanticStatusLabel, type SemanticStatus } from '../contentProjection';
import { PRACTICE_SENSES, type PracticeSenseItem } from '../practiceData';
import { audioService } from '../services/audioService';
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
  useTranslation();
  const projection = useContentProjection();
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!item) return;
    const refresh = () => {
      setSaved(contentAnnotations.isSenseSaved(item.senseId));
      setNote(contentAnnotations.getSenseNote(item.senseId));
    };
    refresh();
    return contentAnnotations.subscribe(refresh);
  }, [item]);

  const siblings = useMemo(() => item
    ? PRACTICE_SENSES.filter((candidate) => candidate.wordId === item.wordId && candidate.senseId !== item.senseId)
    : [], [item]);
  const semanticState = item
    ? projection.semanticSenses.find((entry) => entry.senseId === item.senseId)?.status
    : undefined;

  if (!item) return null;

  const toggleSaved = async () => {
    try {
      const next = await contentAnnotations.toggleSense(item.senseId);
      setSaved(next);
      toast(next ? uiText('meaningSaved') : uiText('meaningRemovedFromSaved'));
    } catch {
      toast(uiText('saveFailed'));
    }
  };

  return (
    <section className={uiClass(`screen content-detail-screen${active ? ' active' : ''}`, "#s-content-sense")} id="s-content-sense" data-anim="slide">
      <header className={uiClass("content-nav content-detail-nav")}>
        <button className={uiClass("content-nav-back")} onClick={onBack} aria-label={uiText('back2')}>
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>
        <span className={uiClass("content-detail-kicker")}>{uiText('meaning3')}</span>
        <button className={uiClass(`content-save-button${saved ? ' on' : ''}`)} onClick={() => void toggleSaved()} aria-pressed={saved} aria-label={saved ? uiText('unsaveThisMeaning') : uiText('saveThisMeaning')}>
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
            <button onClick={() => void audioService.playWord(item.word, 'us')} aria-label={uiText('playUsPronunciation')}>
              <svg className={uiClass("icon")}><use href="#i-vol" /></svg>{uiText('us')}</button>
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
            <span>{uiText('learningExample')}</span>
            <button onClick={() => onOpenExample(item)}>{uiText('viewDetails')}</button>
          </div>
          <div className={uiClass("sense-example-card")}>
            <button className={uiClass("sense-example-open")} onClick={() => onOpenExample(item)}>
              <span className={uiClass("sense-example-source")}>{item.example.sourceLabel}</span>
              <strong>{item.example.text}</strong>
              {item.example.translation && <small>{item.example.translation}</small>}
            </button>
            <button className={uiClass("sense-example-play")} onClick={() => {
              void audioService.playSentence(item.example.text, 'us');
            }} aria-label={uiText('playLearningExample')}>
              <svg className={uiClass("icon")}><use href="#i-vol" /></svg>
            </button>
          </div>
        </section>

        <section className={uiClass("sense-detail-section")}>
          <div className={uiClass("sense-section-heading")}><span>{uiText('myAnnotations')}</span></div>
          <button className={uiClass("sense-note-card")} onClick={() => onEditNote(item)}>
            <span className={uiClass("sense-note-icon")}><svg className={uiClass("icon")}><use href="#i-pen" /></svg></span>
            <span>
              <b>{note ? uiText('myNotes') : uiText('writeANoteOnThisMeaning')}</b>
              <small>{note || uiText('addYourUnderstandingAssociationsOrReminders')}</small>
            </span>
            <svg className={uiClass("chev")}><use href="#i-chev-r" /></svg>
          </button>
        </section>

        {siblings.length > 0 && (
          <section className={uiClass("sense-detail-section")}>
            <div className={uiClass("sense-section-heading")}><span>{uiText('otherMeaningsOfThisWord')}</span><em>{siblings.length}</em></div>
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
            <span><b>{uiText('openDictionary')}</b><small>{uiText('fullEntryAndRelatedContent')}</small></span>
          </button>
          <button className={uiClass("is-later")} onClick={() => toast(uiText('addingToLearningIsNotAvailableYet'))}>
            <svg className={uiClass("icon")}><use href="#i-relearn" /></svg>
            <span><b>{uiText('addToLearning')}</b><small>{uiText('notAvailableYet')}</small></span>
          </button>
        </div>
      </div>
    </section>
  );
};
