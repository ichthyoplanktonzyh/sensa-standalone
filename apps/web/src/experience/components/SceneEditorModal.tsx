import '../../i18n/contentResources';
import {useTranslation} from 'react-i18next';
import {Camera} from 'lucide-react';
import {cardText} from '../../i18n/originalCards';
import {localFlowText} from '../../i18n/localFlowText';
import {uiText} from '../../i18n/uiText';
import {
  currentPersonalLearningSceneRevision,
  personalContentSystem,
  personalLearningSceneEditBase,
  PersonalLearningSceneConflictError,
  type PersonalContentImage,
  type PersonalContentCommand,
  type PersonalLearningSceneEditSnapshot,
  type PersonalLearningSceneEditBase,
} from '../../personalContent/system';
import { iconClass } from '../ui/primitives';
import { SensaOverlayLayout } from '../ui/SensaComponents';
import type { LearningSceneEditorTarget } from '../stores/overlayStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_SCENE_IMAGES,
  useSceneImageInput,
} from './useSceneImageInput';
import {SceneImageAttemptStatus} from './SceneImageAttemptStatus';

type EditorImage = PersonalContentImage & {sourceFileKey?: string};

interface SceneEditorModalProps {
  active: boolean;
  senseId: string | null;
  word: string;
  senseMeaning: string;
  contextId?: string;
  learningTarget?: LearningSceneEditorTarget;
  onClose: () => void;
  toast: (message: string) => void;
}

const MAX_IMAGE_EDGE = 1280;

const createMediaId = (): string => {
  return crypto.randomUUID();
};

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('Unable to read image.'));
  reader.readAsDataURL(file);
});

async function compressSceneImage(file: File): Promise<PersonalContentImage> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to decode image.'));
    image.src = sourceDataUrl;
  });

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare image.');
  context.drawImage(image, 0, 0, width, height);

  const fileName = file.name.trim() || `scene-photo-${createMediaId()}.jpg`;
  return {
    mediaId: createMediaId(),
    kind: 'image',
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    mimeType: 'image/jpeg',
    fileName,
    altText: fileName.replace(/\.[^.]+$/u, ''),
  };
}

export function SceneEditorModal({
  active,
  senseId,
  word,
  senseMeaning,
  contextId,
  learningTarget,
  onClose,
  toast,
}: SceneEditorModalProps) {
  const {t}=useTranslation();
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<EditorImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState('');
  const [readStatus,setReadStatus]=useState<'loading'|'ready'|'error'>('loading');
  const [readAttempt,setReadAttempt]=useState(0);
  const [sceneBase,setSceneBase]=useState<PersonalLearningSceneEditBase>(null);
  const [conflict,setConflict]=useState<PersonalLearningSceneEditSnapshot|null>(null);
  const pendingSceneSave=useRef<Extract<PersonalContentCommand,{kind:'save_learning_scene'}>|null>(null);
  const savingRef=useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{if(!savingRef.current)pendingSceneSave.current=null;},[body,media]);

  useEffect(() => {
    if (!active || !senseId) return;
    let cancelled=false,focusTimer:number|undefined;
    setReadStatus('loading');setBody('');setMedia([]);setImageError('');
    setConflict(null);pendingSceneSave.current=null;
    const load=async()=>{
      const existing=learningTarget
        ?await personalContentSystem.readScene({kind:'learning_scene',learningTargetId:learningTarget.learningTargetId,languageRouteId:learningTarget.languageRouteId})
        :contextId?await personalContentSystem.readScene({kind:'sense_context',contextId}):null;
      const value=existing?.kind==='learning_scene'?currentPersonalLearningSceneRevision(existing):existing;
      if(cancelled)return;
      if(existing?.kind==='learning_scene'||learningTarget)setSceneBase(personalLearningSceneEditBase(existing?.kind==='learning_scene'?existing:null));
      setBody(value?.body??'');setMedia(value?.media??[]);setReadStatus('ready');
      focusTimer=window.setTimeout(()=>textareaRef.current?.focus(),180);
    };
    void load().catch(()=>{if(!cancelled)setReadStatus('error');});
    return()=>{cancelled=true;if(focusTimer!==undefined)window.clearTimeout(focusTimer);};
  }, [active, contextId, learningTarget, senseId,readAttempt]);

  const addImageFile = useCallback(async (file: File, sourceFileKey: string) => {
    const image = await compressSceneImage(file);
    setMedia((current) => [...current, {...image, sourceFileKey}].slice(0, MAX_SCENE_IMAGES));
  }, []);

  const sceneImages = useSceneImageInput({
    disabled: saving || readStatus!=='ready',
    imageCount: media.length,
    onAddFile: addImageFile,
    onStart: () => setImageError(''),
    onRejected: () => setImageError(localFlowText('sceneImageRequirements')),
    onFailed: () => setImageError(cardText('sceneImageFailed')),
  });

  useEffect(() => {
    sceneImages.clearStatuses();
  }, [active, contextId, learningTarget?.learningTargetId, sceneImages.clearStatuses, senseId]);

  const unavailable = saving || sceneImages.processing || readStatus!=='ready';
  const closeUnavailable=saving||sceneImages.processing;

  if (!active || !senseId) return null;

  const handleSave = async (replace?:PersonalLearningSceneEditSnapshot) => {
    if (unavailable || savingRef.current || (conflict&&!replace)) return;
    if (!body.trim() && media.length === 0) {
      toast(cardText('sceneRequired'));
      return;
    }
    savingRef.current=true;setSaving(true);
    try {
      const persistedMedia = media.map(({sourceFileKey: _sourceFileKey, ...item}) => item);
      if (learningTarget) {
        const request=pendingSceneSave.current??{
          kind: 'save_learning_scene',
          operationId: crypto.randomUUID(),
          ...learningTarget,
          body,
          media: persistedMedia,
          expected:replace?replace.expected:sceneBase,
        };
        pendingSceneSave.current=request;
        await personalContentSystem.execute(request);
      } else {
        await personalContentSystem.execute({
          kind: 'save_sense_context',
          operationId: crypto.randomUUID(),
          senseId,
          contextId,
          body,
          media: persistedMedia,
        });
      }
      toast(cardText('sceneSaved'));
      onClose();
    } catch(error) {
      if(error instanceof PersonalLearningSceneConflictError&&error.current){
        pendingSceneSave.current=null;setConflict(error.current);
      }else toast(t('sceneEditor.saveUnconfirmed'));
    } finally {
      savingRef.current=false;setSaving(false);
    }
  };

  return (
    <SensaOverlayLayout variant="dialog" measure="wide" className={`sensa-scene-editor z-[120] ${active ? '' : 'hidden'}`} aria-hidden={!active} label={cardText('sceneFor',{word})} onDismiss={() => { if (!closeUnavailable) onClose(); }} regions={{
      header: <div className="grid min-h-12 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-3">
          <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" disabled={closeUnavailable} onClick={onClose} aria-label={cardText('sceneClose')}>
            <svg className={iconClass} aria-hidden="true"><use href="#i-close" /></svg>
          </button>
          <div>

            <h2 className="text-center text-section-title font-semibold">{cardText('sceneTitle')}</h2>
          </div>
          <button className="grid size-11 place-items-center rounded-control border-0 bg-action-primary text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45" type="button" disabled={unavailable||!!conflict} onClick={() => void handleSave()} aria-label={cardText('sceneSave')}>
            <svg className={iconClass} aria-hidden="true"><use href="#i-chk-simple" /></svg>
          </button>
        </div>,
      primary: <div
        onDragOver={sceneImages.onDragOver}
        onDragLeave={sceneImages.onDragLeave}
        onDrop={sceneImages.onDrop}
        data-dragging={sceneImages.dragging}
        aria-busy={sceneImages.processing || undefined}
        className="rounded-card data-[dragging=true]:ring-2 data-[dragging=true]:ring-focus"
      >
        <p
          role="status"
          aria-live="polite"
          className={sceneImages.dragging
            ? "pointer-events-none mx-6 mt-5 rounded-control border border-dashed border-border-strong bg-accent-soft p-4 text-center text-body-support text-fg-secondary"
            : "sr-only"}
        >
          {sceneImages.dragging
            ? localFlowText('dropImages')
            : sceneImages.processing ? cardText('sceneProcessing') : ''}
        </p>
        <div className="mx-6 mt-5 flex flex-wrap items-baseline gap-2 rounded-control bg-accent-soft px-4 py-3">
          {!learningTarget && <strong className="font-language text-lg text-action-primary">{word}</strong>}
          <span className="text-body-support text-fg-secondary">{senseMeaning}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {readStatus!=='ready'&&<p role={readStatus==='error'?'alert':'status'}>{localFlowText(readStatus==='error'?'localStatusFailed':'loadingSensa')}{readStatus==='error'&&<button className="ml-3 min-h-11 underline" type="button" onClick={()=>setReadAttempt(value=>value+1)}>{uiText('retry')}</button>}</p>}
          {conflict&&<section role="alert" className="mb-4 space-y-3 rounded-card border border-border-strong p-4">
            <p>{t('sceneEditor.changed')}</p>
            <p className="whitespace-pre-wrap text-body-support">{conflict.body}</p>
            {conflict.media.map(image=><figure key={image.mediaId}><img className="max-h-48 max-w-full object-contain" src={image.dataUrl} alt={image.altText}/>{image.altText&&<figcaption className="text-body-support">{image.altText}</figcaption>}</figure>)}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={unavailable} className="min-h-11 underline" onClick={()=>{
                setBody(conflict.body);setMedia(conflict.media);setSceneBase(conflict.expected);setConflict(null);pendingSceneSave.current=null;
              }}>{t('sceneEditor.useLatest')}</button>
              <button type="button" disabled={unavailable} className="min-h-11 underline" onClick={()=>void handleSave(conflict)}>{t('noteEditor.saveMine')}</button>
            </div>
          </section>}
          <textarea
            className="min-h-40 w-full resize-y rounded-card border border-border-strong bg-surface-panel p-4 text-body leading-7 text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-2 focus-visible:outline-focus"
            ref={textareaRef}
            value={body}
            maxLength={1000}
            aria-label={cardText('scenePlaceholder')}
            onPaste={sceneImages.onPaste}
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder={cardText('scenePlaceholder')}
            disabled={unavailable}
          />

          {media.length > 0 && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {media.map((item) => (
                <div className="relative overflow-hidden rounded-card border border-border-subtle bg-surface-panel p-3" key={item.mediaId}>
                  <img className="aspect-video w-full rounded-control object-contain" src={item.dataUrl} alt={item.altText || cardText('sceneImage')} />
                  <button
                    className="absolute right-5 top-5 grid size-11 place-items-center rounded-control border-0 bg-surface-raised text-fg-secondary shadow-raised focus-visible:outline-2 focus-visible:outline-focus"
                    type="button"
                    disabled={unavailable}
                    onClick={() => {
                      sceneImages.forgetFile(item.sourceFileKey);
                      setMedia((current) => current.filter((candidate) => candidate.mediaId !== item.mediaId));
                    }}
                    aria-label={cardText('sceneRemove',{name:item.fileName})}
                  >
                    <svg className={iconClass} aria-hidden="true"><use href="#i-close" /></svg>
                  </button>
                  <input
                    className="mt-3 min-h-11 w-full rounded-control border border-border-subtle bg-surface-canvas px-3 text-body-support text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-2 focus-visible:outline-focus"
                    value={item.altText}
                    maxLength={80}
                    disabled={unavailable}
                    onChange={(event) => {
                      const altText = event.currentTarget.value;
                      setMedia((current) => current.map((candidate) => (
                        candidate.mediaId === item.mediaId ? { ...candidate, altText } : candidate
                      )));
                    }}
                    aria-label={cardText('sceneDescribe',{name:item.fileName})}
                    placeholder={cardText('sceneCaption')}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface-panel px-4 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45"
              onClick={() => fileInputRef.current?.click()}
              disabled={unavailable || media.length >= MAX_SCENE_IMAGES}
            >
              <svg className={iconClass} aria-hidden="true"><use href="#i-gearpic" /></svg>
              {sceneImages.processing ? cardText('sceneProcessing') : cardText('sceneAddImage')}
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface-panel px-4 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45"
              onClick={() => cameraInputRef.current?.click()}
              disabled={unavailable || media.length >= MAX_SCENE_IMAGES}
            >
              <Camera size={18} aria-hidden="true" />
              {cardText('sceneCamera')}
            </button>
            <span className="ml-auto text-metadata text-fg-tertiary">{body.length}/1000 · {cardText('sceneCount',{count:media.length,max:MAX_SCENE_IMAGES})}</span>
          </div>
          {imageError && <p className="mt-3 text-body-support text-feedback-danger" role="alert">{imageError}</p>}
          <SceneImageAttemptStatus
            statuses={sceneImages.statuses}
            className="mt-3 space-y-1 text-body-support"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={unavailable || media.length >= MAX_SCENE_IMAGES}
          onChange={(event) => {
            void sceneImages.addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          disabled={unavailable || media.length >= MAX_SCENE_IMAGES}
          onChange={(event) => {
            void sceneImages.addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }}
        />

        <p className="border-t border-border-subtle px-6 py-4 text-center text-metadata leading-5 text-fg-tertiary">
          {cardText('scenePrivacy')}
        </p>
      </div>,
    }} />
  );
}
