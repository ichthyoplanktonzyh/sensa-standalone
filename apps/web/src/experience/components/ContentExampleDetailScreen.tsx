import '../../i18n/contentResources';
import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { localFlowText } from '../../i18n/localFlowText';
import { useEffect, useState } from 'react';
import { personalContentSystem } from '../../personalContent/system';
import {contentSenseForId,exampleIdForSense} from '../../learnerSemanticProjection/system';
import type { PracticeSenseItem } from '../practiceData';
import { audioService } from '../services/audioService';
import {
  contentNavigationBackClass,
  contentNavigationClass,
  iconClass,
  slideScreenClass,
} from '../ui/primitives';
import { SensaDetailWorkspaceLayout } from '../ui/SensaPageLayouts';

interface ContentExampleDetailScreenProps {
  active: boolean;
  exampleId:string|null;
  onBack: () => void;
  onOpenSense: (item: PracticeSenseItem) => void;
  toast: (message: string) => void;
}

export const ContentExampleDetailScreen = ({
  active,
  exampleId:selectedExampleId,
  onBack,
  onOpenSense,
  toast,
}: ContentExampleDetailScreenProps) => {
  useTranslation();
  const item=selectedExampleId?contentSenseForId(selectedExampleId):null;
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const annotationStatus = personalContentSystem.read({kind:'snapshot'}).status;
  const annotationReady = annotationStatus === 'ready';
  const saved = annotationReady && !!item && personalContentSystem.read({kind:'example',exampleId:exampleIdForSense(item)});

  useEffect(() => {
    if (!item) return;
    setShowTranslation(true);
    const exampleId = exampleIdForSense(item);
    return personalContentSystem.subscribe({ kind: 'example', exampleId }, () => redraw(value => value + 1));
  }, [item]);

  if (!item) return null;
  const exampleId = exampleIdForSense(item);

  const toggleSaved = async () => {
    if (!annotationReady || busy) return;
    setBusy(true);
    try {
      const next = await personalContentSystem.execute({
        kind: 'set_saved_example',
        operationId: crypto.randomUUID(),
        exampleId,
        saved: !saved,
      });
      toast(next ? uiText('exampleSaved') : uiText('exampleRemovedFromSaved'));
    } catch {
      toast(uiText('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SensaDetailWorkspaceLayout
      className={slideScreenClass(active)}
      id="s-content-example"
      data-anim="slide"
      aria-hidden={!active}
      regions={{
        header: <div className={contentNavigationClass}>
        <button className={contentNavigationBackClass} onClick={onBack} aria-label={uiText('back2')}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{uiText('learningExample')}</h1>
        <button disabled={!annotationReady || busy} className={`grid size-11 place-items-center justify-self-end rounded-control border-0 transition-colors focus-visible:outline-2 focus-visible:outline-focus ${saved ? 'bg-accent-soft text-action-primary' : 'bg-transparent text-fg-secondary hover:bg-surface-subtle'}`} onClick={() => void toggleSaved()} aria-pressed={annotationReady ? saved : undefined} aria-label={saved ? uiText('unsaveExample') : uiText('saveExample')}>
          <svg className={`${iconClass} ${saved ? 'fill-current' : ''}`} aria-hidden="true"><use href="#i-star" /></svg>
        </button>
      </div>,

        primary: <div>
        <article className="rounded-overlay bg-surface-media px-7 py-9 text-fg-on-media shadow-raised sm:px-10 sm:py-12">
          <span className="inline-flex rounded-pill border border-fg-on-media/20 px-3 py-1 text-metadata tracking-wide text-fg-on-media/75">{uiText('learningExample')}</span>
          <blockquote className="mt-8 font-language text-learning-expression leading-relaxed">{item.example.text}</blockquote>
          {showTranslation && item.example.translation && <p className="mt-5 text-body-support leading-7 text-fg-on-media/75">{item.example.translation}</p>}
          <button className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-control border border-fg-on-media/20 bg-transparent px-4 text-control-label font-semibold text-fg-on-media hover:bg-fg-on-media/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={() => void audioService.playSentence(item.example.text, 'us')}>
            <svg className={iconClass} aria-hidden="true"><use href="#i-vol" /></svg>
          {uiText('playExample')}</button>
        </article>

      <div className="mt-4 grid w-full grid-cols-2 divide-x divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-panel">
        <button className="flex min-h-14 items-center justify-center gap-2 text-control-label text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={() => setShowTranslation((visible) => !visible)}>
          <svg className={iconClass} aria-hidden="true"><use href={showTranslation ? '#i-eye-lashes' : '#i-eye'} /></svg>
          <span>{showTranslation ? uiText('hideTranslation') : uiText('showTranslation')}</span>
        </button>
        <button disabled={!annotationReady || busy} className={`flex min-h-14 items-center justify-center gap-2 text-control-label hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus ${saved ? 'text-action-primary' : 'text-fg-secondary'}`} onClick={() => void toggleSaved()}>
          <svg className={`${iconClass} ${saved ? 'fill-current' : ''}`} aria-hidden="true"><use href="#i-star" /></svg>
          <span>{saved ? uiText('saved') : uiText('saveExample')}</span>
        </button>
      </div>
      {!annotationReady && <p className="mt-3 text-body-support" role={annotationStatus === 'error' ? 'alert' : 'status'}>{localFlowText(annotationStatus === 'error' ? 'progressReadFailed' : 'loadingSensa')}{annotationStatus === 'error' && <button className="ml-3 min-h-11 underline" onClick={() => void personalContentSystem.refresh().catch(() => undefined)}>{uiText('retry')}</button>}</p>}

      <button className="mt-4 grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 rounded-card border border-border-subtle bg-surface-panel p-5 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={() => onOpenSense(item)}>
        <span className="font-language text-2xl font-semibold text-action-primary">{item.word}</span>
        <span className="flex min-w-0 flex-col gap-1 text-fg-secondary"><b className="text-body-support text-fg-primary">{item.pos} {item.meaning}</b><small className="text-metadata">{uiText('viewThisExampleSMeaning')}</small></span>
        <svg className="size-4 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
      </div>,
      }}
    />
  );
};
