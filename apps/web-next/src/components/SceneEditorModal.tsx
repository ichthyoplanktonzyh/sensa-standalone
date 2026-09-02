import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  personalContentService,
  type PersonalSemanticAnchorMedia,
} from '../services/personalContentService';

interface SceneEditorModalProps {
  active: boolean;
  senseId: string | null;
  word: string;
  senseMeaning: string;
  anchorId?: string;
  onClose: () => void;
  toast: (message: string) => void;
}

const MAX_IMAGES = 3;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1280;

const createMediaId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `scene_media_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  onClose,
  toast,
}: SceneEditorModalProps) {
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<PersonalSemanticAnchorMedia[]>([]);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!active || !senseId) return;
    const existing = anchorId ? personalContentService.getSemanticAnchor(anchorId) : null;
    setBody(existing?.body ?? '');
    setMedia(existing?.media ?? []);
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 180);
    return () => window.clearTimeout(focusTimer);
  }, [active, anchorId, senseId]);

  if (!active || !senseId) return null;

  const handleImageInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    if (media.length >= MAX_IMAGES) {
      toast(`每个场景最多添加 ${MAX_IMAGES} 张图片`);
      return;
    }

    const accepted = files
      .filter((file) => file.type.startsWith('image/') && file.size <= MAX_SOURCE_BYTES)
      .slice(0, MAX_IMAGES - media.length);
    if (accepted.length !== files.length) {
      toast('仅支持不超过 8 MB 的图片，最多保留 3 张');
    }
    if (accepted.length === 0) return;

    setProcessing(true);
    try {
      const nextMedia = await Promise.all(accepted.map(compressSceneImage));
      setMedia((current) => [...current, ...nextMedia].slice(0, MAX_IMAGES));
    } catch {
      toast('图片处理失败，请换一张图片重试');
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = () => {
    if (!body.trim() && media.length === 0) {
      toast('写下一段场景，或至少添加一张图片');
      return;
    }
    personalContentService.saveSemanticAnchor({
      senseId,
      anchorId,
      body,
      media,
    });
    toast('已保存到我的场景');
    onClose();
  };

  return (
    <div className={`scene-editor-backdrop${active ? ' active' : ''}`}>
      <div className="scene-editor-sheet" role="dialog" aria-modal="true" aria-label={`${word} 的我的场景`}>
        <header className="scene-editor-header">
          <button type="button" onClick={onClose} aria-label="关闭我的场景编辑">
            <svg className="icon"><use href="#i-close" /></svg>
          </button>
          <div>
            <span>PERSONAL SEMANTIC ANCHOR</span>
            <h2>我的场景</h2>
          </div>
          <button type="button" onClick={handleSave} aria-label="保存我的场景">
            <svg className="icon"><use href="#i-chk-simple" /></svg>
          </button>
        </header>

        <div className="scene-editor-sense-pill">
          <strong>{word}</strong>
          <span>{senseMeaning}</span>
        </div>

        <div className="scene-editor-canvas">
          <textarea
            ref={textareaRef}
            value={body}
            maxLength={1000}
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder="写下一段真实经历：当时发生了什么？为什么它让你想到这个意思？"
          />

          {media.length > 0 && (
            <div className="scene-editor-media-grid">
              {media.map((item) => (
                <div className="scene-editor-media-item" key={item.mediaId}>
                  <img src={item.dataUrl} alt={item.altText || '我的场景图片'} />
                  <button
                    type="button"
                    onClick={() => setMedia((current) => current.filter((candidate) => candidate.mediaId !== item.mediaId))}
                    aria-label={`移除图片 ${item.fileName}`}
                  >
                    <svg className="icon"><use href="#i-close" /></svg>
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
                    aria-label={`图片 ${item.fileName} 的说明`}
                    placeholder="图片说明"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="scene-editor-canvas-footer">
            <button
              type="button"
              className="scene-editor-upload"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing || media.length >= MAX_IMAGES}
            >
              <svg className="icon"><use href="#i-gearpic" /></svg>
              {processing ? '正在处理图片…' : '添加图片'}
            </button>
            <span>{body.length}/1000 · {media.length}/{MAX_IMAGES} 张</span>
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

        <p className="scene-editor-privacy">
          只属于你的私人连接；它不会被当成标准释义、正确答案或学习证据。
        </p>
      </div>
    </div>
  );
}
