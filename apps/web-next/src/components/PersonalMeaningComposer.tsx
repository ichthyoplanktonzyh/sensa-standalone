/**
 * The stable material editor.
 *
 * It asks for two things and nothing more: the material itself (free-form,
 * multimodal, unclassified) and an optional starting stance. There is
 * deliberately no Focus field, no Sense field and no target-expression field —
 * those are our domain model, not the learner's, and a separate input for the
 * target expression would quietly imply that filling it in confirms it.
 *
 * Saving here never calls the model. Entering clarification is a second,
 * explicit intent.
 */

import { useEffect, useRef, useState } from 'react';
import { newUuid } from '../personalMeaningJourney/ids';
import { useJourneyGateway } from '../personalMeaningJourney';
import type { MaterialBlockInput } from '../personalMeaningJourney';
import {
  startingPointLabels,
  type ClarificationStartingPoint,
} from '../personalMeaningJourney/semanticAgent';
import { removeMedia, storeImageFile } from '../personalMeaningJourney/mediaStore';

interface PersonalMeaningComposerProps {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onCreated?: (personalMeaningId: string) => void;
}

interface DraftBlock {
  localId: string;
  kind: 'text' | 'image';
  bodyText: string;
  mediaId: string | null;
  previewUrl: string | null;
}

const startingPointHints: Record<ClarificationStartingPoint, string> = {
  from_experience: '先一起找出你真正在意的那个侧面',
  from_sense: '直接给出理解和表达，请你确认',
  from_expression: '先看看你这个说法通常表示什么意思',
};

const textBlock = (): DraftBlock => ({
  localId: newUuid(),
  kind: 'text',
  bodyText: '',
  mediaId: null,
  previewUrl: null,
});

export const PersonalMeaningComposer = ({
  open,
  onClose,
  onSaved,
  onCreated,
}: PersonalMeaningComposerProps) => {
  const gateway = useJourneyGateway();
  const fileRef = useRef<HTMLInputElement>(null);
  const [blocks, setBlocks] = useState<DraftBlock[]>([textBlock()]);
  const [familiarExpression, setFamiliarExpression] = useState('');
  const [startingPoint, setStartingPoint] = useState<ClarificationStartingPoint | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const filled = blocks.filter(
    (block) => (block.kind === 'text' ? block.bodyText.trim() : block.mediaId),
  );
  const canSave = filled.length > 0 || Boolean(familiarExpression.trim());

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const reset = () => {
    setBlocks([textBlock()]);
    setFamiliarExpression('');
    setStartingPoint(null);
    setError('');
    setBusy(false);
  };

  const handleClose = () => {
    // Media picked but never saved would otherwise sit in the store forever.
    blocks.forEach((block) => block.mediaId && removeMedia(block.mediaId));
    reset();
    onClose();
  };

  const updateBlock = (localId: string, bodyText: string) => {
    setBlocks((current) => current.map(
      (block) => (block.localId === localId ? { ...block, bodyText } : block),
    ));
  };

  const removeBlock = (localId: string) => {
    setBlocks((current) => {
      const target = current.find((block) => block.localId === localId);
      if (target?.mediaId) removeMedia(target.mediaId);
      const next = current.filter((block) => block.localId !== localId);
      return next.length > 0 ? next : [textBlock()];
    });
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const mediaId = newUuid();
      const stored = await storeImageFile(mediaId, file, new Date().toISOString());
      setBlocks((current) => [...current, {
        localId: newUuid(),
        kind: 'image',
        bodyText: '',
        mediaId,
        previewUrl: stored.dataUrl,
      }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '这张图片暂时无法加入。');
    }
  };

  const save = async (): Promise<string | null> => {
    setError('');
    setBusy(true);
    try {
      const payload: MaterialBlockInput[] = filled.map((block) => (
        block.kind === 'image'
          ? { kind: 'image', personalMediaObjectId: block.mediaId! }
          : { kind: 'text', bodyText: block.bodyText.trim() }
      ));
      const result = await gateway.createPersonalMeaning({
        operationId: newUuid(),
        blocks: payload,
        familiarExpression: familiarExpression.trim()
          ? { surfaceForm: familiarExpression.trim(), languageTag: 'zh-CN' }
          : undefined,
        startingPoint,
      });
      onSaved('材料已保存');
      return result.personalMeaningId;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法保存，请再试一次。');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveAndClarify = async () => {
    const personalMeaningId = await save();
    if (!personalMeaningId) return;
    reset();
    onCreated?.(personalMeaningId);
  };

  const saveOnly = async () => {
    const personalMeaningId = await save();
    if (!personalMeaningId) return;
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="pmc-layer" onMouseDown={handleClose}>
      <section
        className="pmc"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pmc-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pmc-grip" aria-hidden="true" />
        <header className="pmc-head">
          <div>
            <h2 id="pmc-title">你想弄明白什么？</h2>
          </div>
          <button type="button" onClick={handleClose} aria-label="关闭">×</button>
        </header>

        <div className="pmc-body">
          <div className="pmc-blocks">
            {blocks.map((block, index) => (
              <div className={`pmc-block is-${block.kind}`} key={block.localId}>
                {block.kind === 'text' ? (
                  <textarea
                    autoFocus={index === 0}
                    value={block.bodyText}
                    onChange={(event) => updateBlock(block.localId, event.target.value)}
                    placeholder="可以是一段经历、一个场景、一句你想说但说不出来的话，或者你已经想到的英语表达…"
                    rows={index === 0 ? 5 : 3}
                  />
                ) : (
                  <img src={block.previewUrl ?? ''} alt="已加入的图片材料" />
                )}
                {blocks.length > 1 && (
                  <button
                    type="button"
                    className="pmc-block-remove"
                    onClick={() => removeBlock(block.localId)}
                    aria-label="移除这块材料"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="pmc-add">
            <button type="button" onClick={() => setBlocks((current) => [...current, textBlock()])}>
              ＋文字
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>＋图片</button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void pickImage(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>

          <label className="pmc-field">
            <span>有没有一个中文说法？<small>选填</small></span>
            <input
              value={familiarExpression}
              onChange={(event) => setFamiliarExpression(event.target.value)}
              placeholder="例如：欲言又止"
              maxLength={100}
            />
          </label>

          <fieldset className="pmc-stance">
            <legend>你现在到哪一步了？<small>选填，帮 AI 决定怎么开口</small></legend>
            {(Object.keys(startingPointLabels) as ClarificationStartingPoint[]).map((value) => (
              <label key={value} className={startingPoint === value ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="pmc-stance"
                  checked={startingPoint === value}
                  onChange={() => setStartingPoint(
                    startingPoint === value ? null : value,
                  )}
                />
                <span>
                  <b>{startingPointLabels[value]}</b>
                  <small>{startingPointHints[value]}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {error && <p className="pmc-error" role="alert">{error}</p>}
        </div>

        <footer className="pmc-foot">
          <button
            type="button"
            className="pmc-primary"
            disabled={!canSave || busy}
            onClick={() => void saveAndClarify()}
          >
            {busy ? '正在保存…' : '保存并澄清'}
          </button>
          <button
            type="button"
            className="pmc-secondary"
            disabled={!canSave || busy}
            onClick={() => void saveOnly()}
          >
            先存着
          </button>
        </footer>
      </section>
    </div>
  );
};
