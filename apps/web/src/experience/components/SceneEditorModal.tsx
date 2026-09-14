import {useTranslation} from 'react-i18next';
import {cardText} from '../../i18n/originalCards';
import {
  contentAnnotations,
  type PersonalSemanticAnchorMedia,
} from '../../data/library/contentAnnotations';
import { uiClass } from '../ui/classes';
import type { LearningSceneEditorTarget } from '../stores/overlayStore';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

interface SceneEditorModalProps {
  active: boolean;
  senseId: string | null;
  word: string;
  senseMeaning: string;
  anchorId?: string;
  learningTarget?: LearningSceneEditorTarget;
  onClose: () => void;
  toast: (message: string) => void;
}

const MAX_IMAGES = 3;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
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

async function compressSceneImage(file: File): Promise<PersonalSemanticAnchorMedia> {
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

  return {
    mediaId: createMediaId(),
    kind: 'image',
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    mimeType: 'image/jpeg',
    fileName: file.name,
    altText: file.name.replace(/\.[^.]+$/u, ''),
  };
}

export function SceneEditorModal({
  active,
  senseId,
  word,
  senseMeaning,
  anchorId,
  learningTarget,
  onClose,
  toast,
}: SceneEditorModalProps) {
  useTranslation();
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<PersonalSemanticAnchorMedia[]>([]);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!active || !senseId) return;
    const learningScene = learningTarget
      ? contentAnnotations.getLearningScene(
          learningTarget.learningTargetId,
          learningTarget.languageRouteId,
        )
      : null;
    const learningRevision = learningScene
      ? contentAnnotations.getLearningSceneRevision(learningScene)
      : null;
    const existing = !learningTarget && anchorId
      ? contentAnnotations.getSemanticAnchor(anchorId)
      : null;
    setBody(learningRevision?.body ?? existing?.body ?? '');
    setMedia(learningRevision?.media ?? existing?.media ?? []);
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 180);
    return () => window.clearTimeout(focusTimer);
  }, [active, anchorId, learningTarget, senseId]);

  if (!active || !senseId) return null;

  const handleImageInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    if (media.length >= MAX_IMAGES) {
      toast(cardText('sceneImageLimit'));
      return;
    }

    const accepted = files
      .filter((file) => file.type.startsWith('image/') && file.size <= MAX_SOURCE_BYTES)
      .slice(0, MAX_IMAGES - media.length);
    if (accepted.length !== files.length) {
      toast(cardText('sceneImageLimit'));
    }
    if (accepted.length === 0) return;

    setProcessing(true);
    try {
      const nextMedia = await Promise.all(accepted.map(compressSceneImage));
      setMedia((current) => [...current, ...nextMedia].slice(0, MAX_IMAGES));
    } catch {
      toast(cardText('sceneImageFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!body.trim() && media.length === 0) {
      toast(cardText('sceneRequired'));
      return;
    }
    setProcessing(true);
    try {
      if (learningTarget) {
        await contentAnnotations.saveLearningScene({
          operationId: crypto.randomUUID(),
          ...learningTarget,
          body,
          media,
        });
      } else {
        await contentAnnotations.saveSemanticAnchor({ senseId, anchorId, body, media });
      }
      toast(cardText('sceneSaved'));
      onClose();
    } catch {
      toast(cardText('sceneImageFailed'));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className={uiClass(`scene-editor-backdrop${active ? ' active' : ''}`)}>
      <div className={uiClass("scene-editor-sheet")} role="dialog" aria-modal="true" aria-label={cardText('sceneFor',{word})}>
        <header className={uiClass("scene-editor-header")}>
          <button type="button" onClick={onClose} aria-label={cardText('sceneClose')}>
            <svg className={uiClass("icon")}><use href="#i-close" /></svg>
          </button>
          <div>

            <h2>{cardText('sceneTitle')}</h2>
          </div>
          <button type="button" disabled={processing} onClick={() => void handleSave()} aria-label={cardText('sceneSave')}>
            <svg className={uiClass("icon")}><use href="#i-chk-simple" /></svg>
          </button>
        </header>

        <div className={uiClass("scene-editor-sense-pill")}>
          {!learningTarget && <strong>{word}</strong>}
          <span>{senseMeaning}</span>
        </div>

        <div className={uiClass("scene-editor-canvas")}>
          <textarea
            ref={textareaRef}
            value={body}
            maxLength={1000}
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder={cardText('scenePlaceholder')}
          />

          {media.length > 0 && (
            <div className={uiClass("scene-editor-media-grid")}>
              {media.map((item) => (
                <div className={uiClass("scene-editor-media-item")} key={item.mediaId}>
                  <img src={item.dataUrl} alt={item.altText || cardText('sceneImage')} />
                  <button
                    type="button"
                    onClick={() => setMedia((current) => current.filter((candidate) => candidate.mediaId !== item.mediaId))}
                    aria-label={cardText('sceneRemove',{name:item.fileName})}
                  >
                    <svg className={uiClass("icon")}><use href="#i-close" /></svg>
                  </button>
                  <input
                    value={item.altText}
                    maxLength={80}
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

          <div className={uiClass("scene-editor-canvas-footer")}>
            <button
              type="button"
              className={uiClass("scene-editor-upload")}
              onClick={() => fileInputRef.current?.click()}
              disabled={processing || media.length >= MAX_IMAGES}
            >
              <svg className={uiClass("icon")}><use href="#i-gearpic" /></svg>
              {processing ? cardText('sceneProcessing') : cardText('sceneAddImage')}
            </button>
            <span>{body.length}/1000 · {cardText('sceneCount',{count:media.length,max:MAX_IMAGES})}</span>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={handleImageInput}
        />

        <p className={uiClass("scene-editor-privacy")}>
          {cardText('scenePrivacy')}
        </p>
      </div>
    </div>
  );
}
