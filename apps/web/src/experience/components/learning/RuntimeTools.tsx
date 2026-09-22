import { useEffect, useState, type MouseEvent } from 'react';
import { personalContentSystem } from '../../../personalContent/system';
import { Star, Undo2, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RuntimePersonalContent } from '../../stores/overlayStore';

export interface RuntimeToolsProps {
  content: RuntimePersonalContent | null;
  personalContent: RuntimePersonalContent | null;
  showSave: boolean;
  onUndo?: () => void;
  canUndo?: boolean;
  onMarkKnown: () => void;
  onOpenMenuMore: (event: MouseEvent, content: RuntimePersonalContent | null) => void;
  toast: (message: string) => void;
  busy?: boolean;
}

/** The existing LearnScreen toolbar shared by protocol hosts. */
export function RuntimeTools({content, personalContent, showSave, onUndo, canUndo, onMarkKnown, onOpenMenuMore, toast, busy}: RuntimeToolsProps) {
  const {t} = useTranslation();
  const [starred, setStarred] = useState(false);
  useEffect(() => {
    const update = () => setStarred(!!content && personalContentSystem.read({ kind: 'sense', senseId: content.senseKey }).saved);
    update();
    return personalContentSystem.subscribe({ kind: 'snapshot' }, update);
  }, [content?.senseKey]);
  const button = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border-strong bg-surface-panel px-2 text-sm text-action-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-30';
  return <>
    {showSave && <>
      {onUndo && <button className={button} disabled={busy || !canUndo} onClick={onUndo} aria-label={t('assurance.undo')}><Undo2 size={18}/></button>}
      <button className={button} disabled={busy || !content} aria-label={t('assurance.save')} aria-pressed={starred} onClick={() => {
        if (content) void personalContentSystem.execute({kind:'set_saved_sense',operationId:crypto.randomUUID(),senseId:content.senseKey,saved:!starred}).then((saved) => {
          toast(t(saved ? 'assurance.saved' : 'assurance.unsaved'));
        }).catch(() => {
          toast(t('contentUi.saveFailed'));
        });
      }}><Star size={18} fill={starred ? 'currentColor' : 'none'}/></button>
    </>}
    <button className={button} disabled={busy} onClick={onMarkKnown}>{t('assurance.known')}</button>
    <button className={button} disabled={busy} onClick={event => onOpenMenuMore(event, personalContent)} data-learning-more aria-label={t('assurance.more')}><MoreHorizontal size={20}/></button>
  </>;
}
