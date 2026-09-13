import { useEffect, useState, type MouseEvent } from 'react';
import { contentAnnotations } from '../../../data/library/contentAnnotations';
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
    const update = () => setStarred(!!content && contentAnnotations.isSenseSaved(content.senseKey));
    update();
    return contentAnnotations.subscribe(update);
  }, [content?.senseKey]);
  const button = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#cbd3e2] bg-white px-2 text-sm text-[#526181] hover:bg-[#edf0f7] disabled:opacity-30';
  return <>
    {showSave && <>
      {onUndo && <button className={button} disabled={busy || !canUndo} onClick={onUndo} aria-label={t('assurance.undo')}><Undo2 size={18}/></button>}
      <button className={button} disabled={busy || !content} aria-label={t('assurance.save')} aria-pressed={starred} onClick={() => {
        if (content) void contentAnnotations.toggleSense(content.senseKey).then((saved) => {
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
