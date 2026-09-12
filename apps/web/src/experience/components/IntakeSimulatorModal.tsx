import { uiClass } from '../ui/classes';
/**
 * 摄取模拟器（仅本地原型的演示浮层）。
 *
 * 三个场景直接调用 gateway.ingest，与真实分享面板共用同一条契约校验与
 * 双轨分流路径：
 * 1. 网页划词快轨——三要素齐全且义项已确认，秒级直通语义世界；
 * 2. 随手划词慢轨——不选义项，进入待处理材料盒（待确认词义）；
 * 3. 多模态随手拍——照片 + 文字、不圈词，进入待处理材料盒（待圈定表达）。
 */

import { useEffect, useRef, useState } from 'react';
import type { SensaIntakePayload } from '@sensa/contracts/sensa';
import { newUuid } from '../personalMeaningJourney/ids';
import { useJourneyGateway } from '../personalMeaningJourney';
import { storeImageFile } from '../personalMeaningJourney/mediaStore';

interface IntakeSimulatorModalProps {
  open: boolean;
  onClose: () => void;
  /** 快轨直通成功后回调：关闭浮层并打开新 Meaning。 */
  onFastTracked: (personalMeaningId: string) => void;
  toast: (message: string) => void;
}

type Scenario = 'web_fast' | 'web_slow' | 'photo';

const SCENARIOS: Record<Scenario, {
  label: string;
  hint: string;
  route: string;
  sentence: string;
  word: string;
  action: string;
}> = {
  web_fast: {
    label: '网页划词快轨',
    hint: '三要素齐全且义项已确认 → 秒级直通语义世界',
    route: '快轨：捕获即物化，无需 AI 澄清',
    sentence: 'The library will loan the atlas to students for one week.',
    word: 'loan',
    action: '捕获并直通',
  },
  web_slow: {
    label: '随手划词慢轨',
    hint: '不选义项 → 进入待处理材料盒（待确认词义）',
    route: '慢轨：进入待处理材料盒，稍后快速消歧',
    sentence: 'He committed to returning the atlas by Friday.',
    word: 'committed',
    action: '随手捕获',
  },
  photo: {
    label: '多模态随手拍',
    hint: '照片 + 文字、不圈词 → 待圈定表达',
    route: '慢轨：进入待处理材料盒，稍后圈定表达',
    sentence: '',
    word: '',
    action: '随手拍捕获',
  },
};

// A fixed pretend page so the demo card carries an honest "imported" source.
const WEB_SOURCE = {
  client: 'web-clipper-simulator',
  url: 'https://www.theatlantic.com/family/archive/2026/08/what-we-keep/697512/',
  title: 'The Atlantic',
  domSelector: 'article > p:nth-child(4)',
  paragraphContext: null,
} as const;

// Preset confirmed senses for the fast-track scenario.
const LOAN_SENSES = [
  {
    senseKey: 'loan-temporary-give-use-return' as string | null,
    definitionSummary: '把自己的东西暂时交给别人使用，并预期收回',
  },
  {
    senseKey: null,
    definitionSummary: '借出一笔钱或财物，之后要还',
  },
];

export const IntakeSimulatorModal = ({
  open,
  onClose,
  onFastTracked,
  toast,
}: IntakeSimulatorModalProps) => {
  const gateway = useJourneyGateway();
  const fileRef = useRef<HTMLInputElement>(null);
  const [scenario, setScenario] = useState<Scenario>('web_fast');
  const [sentence, setSentence] = useState(SCENARIOS.web_fast.sentence);
  const [word, setWord] = useState(SCENARIOS.web_fast.word);
  const [senseIndex, setSenseIndex] = useState(0);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('随手拍：图书馆的借阅台');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const switchScenario = (next: Scenario) => {
    setScenario(next);
    setSentence(SCENARIOS[next].sentence);
    setWord(SCENARIOS[next].word);
    setError('');
  };

  const handleClose = () => {
    setError('');
    setBusy(false);
    onClose();
  };

  const buildPayload = (input: {
    modality: SensaIntakePayload['context']['modality'];
    textSegment: string | null;
    mediaReferenceIds: string[];
    source: SensaIntakePayload['context']['source'];
    expression: SensaIntakePayload['expression'];
    sense: SensaIntakePayload['sense'];
  }): SensaIntakePayload => ({
    contractVersion: 'sensa-intake-v2',
    intakeOperationId: newUuid(),
    capturedAt: new Date().toISOString(),
    context: {
      modality: input.modality,
      textSegment: input.textSegment,
      mediaReferenceIds: input.mediaReferenceIds,
      source: input.source,
    },
    expression: input.expression,
    sense: input.sense,
    acceptanceRequest: input.sense?.resolutionStatus === 'resolved'
      ? { mode: 'learner_direct' }
      : null,
  });

  const run = async (payload: SensaIntakePayload) => {
    setBusy(true);
    setError('');
    try {
      const result = await gateway.ingest(payload.intakeOperationId, payload);
      if (result.route === 'fast_track') {
        toast('已捕获：秒级直通语义世界');
        onFastTracked(result.personalMeaningId);
      } else if (result.route === 'inbox') {
        toast('已捕获：进入待处理材料盒');
        handleClose();
      } else {
        setError(result.reason);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '摄取失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const submitWordCapture = async () => {
    const text = sentence.trim();
    const surfaceForm = word.trim();
    if (!text) {
      setError('先粘贴或输入网页里的句子。');
      return;
    }
    if (!surfaceForm) {
      setError('先圈出这句话里想弄明白的词。');
      return;
    }
    const spanStart = text.indexOf(surfaceForm);
    const sense = scenario === 'web_fast' ? LOAN_SENSES[senseIndex]! : null;
    await run(buildPayload({
      modality: 'text',
      textSegment: text,
      mediaReferenceIds: [],
      source: { ...WEB_SOURCE },
      expression: {
        surfaceForm,
        languageRole: 'target',
        occurrence: spanStart >= 0
          ? { kind: 'text_span', start: spanStart, end: spanStart + surfaceForm.length }
          : null,
        expressionTypeHint: 'word',
      },
      sense: sense
        ? {
          senseKey: sense.senseKey,
          resolutionStatus: 'resolved',
          definitionSummary: sense.definitionSummary,
          wordingSource: 'learner_authored',
          candidates: [],
        }
        : null,
    }));
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const mediaId = newUuid();
      const stored = await storeImageFile(mediaId, file, new Date().toISOString());
      setPhotoId(mediaId);
      setPhotoPreview(stored.dataUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '这张照片暂时无法加入。');
    }
  };

  const useSimulatedPhoto = () => {
    setError('');
    setPhotoId('media-simulated-photo');
    setPhotoPreview(null);
  };

  const submitPhotoCapture = async () => {
    if (!photoId) {
      setError('先选一张照片，或用模拟照片。');
      return;
    }
    const text = caption.trim();
    await run(buildPayload({
      modality: text ? 'mixed' : 'image',
      textSegment: text || null,
      mediaReferenceIds: [photoId],
      source: null,
      expression: null,
      sense: null,
    }));
  };

  if (!open) return null;

  const active = SCENARIOS[scenario];

  return (
    <div className={uiClass("intake-layer")} onMouseDown={handleClose}>
      <section
        className={uiClass("intake-sim")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-sim-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={uiClass("intake-drawer__grip")} aria-hidden="true" />
        <header className={uiClass("intake-drawer__head")}>
          <div>
            <small>仅本地原型</small>
            <h2 id="intake-sim-title">摄取模拟器</h2>
          </div>
          <button type="button" onClick={handleClose} aria-label="关闭">×</button>
        </header>

        <div className={uiClass("intake-sim__body")}>
          <div className={uiClass("intake-sim__scenarios")} role="tablist" aria-label="选择摄取模拟场景">
            {(Object.keys(SCENARIOS) as Scenario[]).map((key) => (
              <button
                type="button"
                key={key}
                role="tab"
                aria-selected={scenario === key}
                className={uiClass(scenario === key ? 'is-active' : '')}
                onClick={() => switchScenario(key)}
              >
                {SCENARIOS[key].label}
              </button>
            ))}
          </div>
          <p className={uiClass("intake-sim__hint")}>{active.hint}</p>

          {scenario !== 'photo' ? (
            <div className={uiClass("intake-sim__form")}>
              <label className={uiClass("intake-sim__field")}>
                <span>网页里的句子</span>
                <textarea
                  value={sentence}
                  onChange={(event) => setSentence(event.target.value)}
                  rows={3}
                />
              </label>
              <label className={uiClass("intake-sim__field")}>
                <span>圈出的词</span>
                <input
                  value={word}
                  onChange={(event) => setWord(event.target.value)}
                  placeholder="在这句话里点选或输入一个词"
                />
              </label>
              {scenario === 'web_fast' && (
                <fieldset className={uiClass("intake-sim__senses")}>
                  <legend>匹配义项（确认后走快轨）</legend>
                  {LOAN_SENSES.map((option, index) => (
                    <label
                      key={option.definitionSummary}
                      className={uiClass(senseIndex === index ? 'is-selected' : '')}
                    >
                      <input
                        type="radio"
                        name="intake-sim-sense"
                        checked={senseIndex === index}
                        onChange={() => setSenseIndex(index)}
                      />
                      <span>{option.definitionSummary}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <p className={uiClass("intake-sim__route")}>{active.route}</p>
            </div>
          ) : (
            <div className={uiClass("intake-sim__form")}>
              <div className={uiClass("intake-sim__field")}>
                <span>随手拍的照片<small>选填，可用模拟照片</small></span>
                <div className={uiClass("intake-sim__photo")}>
                  <button type="button" onClick={() => fileRef.current?.click()}>选择照片</button>
                  <button type="button" onClick={useSimulatedPhoto}>用模拟照片</button>
                  {photoId && !photoPreview && (
                    <span className={uiClass("intake-sim__photo-name")}>已用模拟照片</span>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      void pickPhoto(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </div>
                {photoPreview && (
                  <img className={uiClass("intake-sim__preview")} src={photoPreview} alt="随手拍的照片" />
                )}
              </div>
              <label className={uiClass("intake-sim__field")}>
                <span>当时想记下的一句话<small>选填</small></span>
                <input
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="例如：图书馆的借阅台"
                />
              </label>
              <p className={uiClass("intake-sim__route")}>{active.route}</p>
            </div>
          )}

          {error && <p className={uiClass("intake-sim__error")} role="alert">{error}</p>}
        </div>

        <footer className={uiClass("intake-sim__foot")}>
          <button
            type="button"
            className={uiClass("intake-sim__primary")}
            disabled={busy}
            onClick={() => void (scenario === 'photo' ? submitPhotoCapture() : submitWordCapture())}
          >
            {busy ? '正在捕获…' : active.action}
          </button>
        </footer>
      </section>
    </div>
  );
};
