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
import type { SensaIntakeContext, SensaIntakePayload, SensaIntakeSense } from '@sensa/contracts/sensa';
import { newUuid } from '../personalMeaningJourney/ids';
import { useJourneyGateway } from '../personalMeaningJourney';
import { storeImageFile } from '../personalMeaningJourney/mediaStore';
import { SensaOverlayLayout } from '../ui/SensaComponents';

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
  sourceReferenceId: null,
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

const resolvedSense = (sense: typeof LOAN_SENSES[number], scene: string): SensaIntakeSense => ({
  senseKey: sense.senseKey,
  semanticSpec: {
    schemaVersion: 'sensa-sense-semantic-spec-v1',
    coreMeaningFocus: sense.definitionSummary,
    prototypeScenes: [{
      summary: scene,
      participantRoles: [],
      states: [],
      directionOrCausality: null,
    }],
    includedCases: [scene],
    excludedCases: [],
    neighborContrasts: [],
    openQuestions: [],
  },
  wordingSource: 'learner_authored',
  resolutionProvenance: {
    resolverKind: 'learner',
    provider: 'sensa-intake-simulator',
    model: null,
    policyVersion: null,
    sourceReferenceIds: ['simulated-learner-resolution'],
  },
});

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
    modality: SensaIntakeContext['modality'];
    textSegment: string | null;
    mediaReferenceIds: string[];
    languageTag: SensaIntakeContext['languageTag'];
    source: SensaIntakeContext['source'];
    expression: SensaIntakePayload['expression'];
    sense: SensaIntakePayload['sense'];
  }): SensaIntakePayload => ({
    contractVersion: 'sensa-intake-v3',
    operationId: newUuid(),
    capturedAt: new Date().toISOString(),
    context: {
      modality: input.modality,
      textSegment: input.textSegment,
      mediaReferenceIds: input.mediaReferenceIds,
      languageTag: input.languageTag,
      source: input.source,
    },
    expression: input.expression,
    sense: input.sense,
    acceptance: input.sense
      ? { mode: 'learner_direct' }
      : null,
  });

  const run = async (payload: SensaIntakePayload) => {
    setBusy(true);
    setError('');
    try {
      const result = await gateway.ingest(payload.operationId, payload);
      if (result.route === 'fast_track') {
        toast('已捕获：秒级直通语义世界');
        onFastTracked(result.personalMeaningId);
      } else if (result.route === 'inbox') {
        toast('已捕获：进入待处理材料盒');
        handleClose();
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
      languageTag: 'en',
      source: { ...WEB_SOURCE },
      expression: {
        surfaceForm,
        // The simulated scenario is an English article, so naming English is a
        // fact about this fixture rather than an assumption about the learner.
        languageTag: 'en',
        occurrence: spanStart >= 0
          ? { surfaceForm, locator: { kind: 'text_span', start: spanStart, end: spanStart + surfaceForm.length } }
          : null,
        expressionTypeHint: 'word',
      },
      sense: sense ? resolvedSense(sense, text) : null,
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
      languageTag: text ? 'zh-CN' : null,
      source: null,
      expression: null,
      sense: null,
    }));
  };

  if (!open) return null;

  const active = SCENARIOS[scenario];

  return (
    <SensaOverlayLayout variant="sheet" measure="standard" className="z-[120]" labelledBy="intake-sim-title" onDismiss={handleClose} dismissOnBackdrop regions={{
      header: <div className="flex min-h-12 items-center justify-between gap-4">
          <div>
            <small className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">仅本地原型</small>
            <h2 className="mt-1 text-section-title font-semibold" id="intake-sim-title">摄取模拟器</h2>
          </div>
          <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-xl text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={handleClose} aria-label="关闭">×</button>
        </div>,
      primary: <div>
          <div className="grid grid-cols-3 rounded-control bg-surface-subtle p-1" role="tablist" aria-label="选择摄取模拟场景">
            {(Object.keys(SCENARIOS) as Scenario[]).map((key) => (
              <button
                type="button"
                key={key}
                role="tab"
                aria-selected={scenario === key}
                className={`min-h-11 rounded-control border-0 px-2 text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${scenario === key ? 'bg-surface-panel text-action-primary shadow-raised' : 'bg-transparent text-fg-secondary'}`}
                onClick={() => switchScenario(key)}
              >
                {SCENARIOS[key].label}
              </button>
            ))}
          </div>
          <p className="mt-5 text-body-support leading-6 text-fg-secondary">{active.hint}</p>

          {scenario !== 'photo' ? (
            <div className="mt-6 grid gap-5">
              <label className="grid gap-2">
                <span className="text-control-label font-semibold">网页里的句子</span>
                <textarea
                  className="min-h-32 w-full resize-y rounded-control border border-border-strong bg-surface-panel p-3 text-body text-fg-primary focus-visible:outline-2 focus-visible:outline-focus"
                  value={sentence}
                  onChange={(event) => setSentence(event.target.value)}
                  rows={3}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-control-label font-semibold">圈出的词</span>
                <input
                  className="min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-3 text-body text-fg-primary focus-visible:outline-2 focus-visible:outline-focus"
                  value={word}
                  onChange={(event) => setWord(event.target.value)}
                  placeholder="在这句话里点选或输入一个词"
                />
              </label>
              {scenario === 'web_fast' && (
                <fieldset className="grid gap-2 rounded-card border border-border-subtle p-4">
                  <legend className="px-2 text-control-label font-semibold">匹配义项（确认后走快轨）</legend>
                  {LOAN_SENSES.map((option, index) => (
                    <label
                      key={option.definitionSummary}
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-control border p-3 text-body-support ${senseIndex === index ? 'border-border-strong bg-surface-selected' : 'border-border-subtle bg-surface-panel'}`}
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
              <p className="rounded-control bg-accent-soft p-3 text-metadata leading-5 text-fg-secondary">{active.route}</p>
            </div>
          ) : (
            <div className="mt-6 grid gap-5">
              <div className="grid gap-2">
                <span className="text-control-label font-semibold">随手拍的照片<small className="ml-2 font-normal text-fg-tertiary">选填，可用模拟照片</small></span>
                <div className="flex flex-wrap gap-3 [&_button]:min-h-11 [&_button]:rounded-control [&_button]:border [&_button]:border-border-strong [&_button]:bg-surface-panel [&_button]:px-4 [&_button]:text-control-label [&_button]:font-semibold [&_button]:text-fg-secondary [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus">
                  <button type="button" onClick={() => fileRef.current?.click()}>选择照片</button>
                  <button type="button" onClick={useSimulatedPhoto}>用模拟照片</button>
                  {photoId && !photoPreview && (
                    <span className="self-center text-metadata text-fg-secondary">已用模拟照片</span>
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
                  <img className="mt-3 aspect-video w-full rounded-card object-cover" src={photoPreview} alt="随手拍的照片" />
                )}
              </div>
              <label className="grid gap-2">
                <span className="text-control-label font-semibold">当时想记下的一句话<small className="ml-2 font-normal text-fg-tertiary">选填</small></span>
                <input
                  className="min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-3 text-body text-fg-primary focus-visible:outline-2 focus-visible:outline-focus"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="例如：图书馆的借阅台"
                />
              </label>
              <p className="rounded-control bg-accent-soft p-3 text-metadata leading-5 text-fg-secondary">{active.route}</p>
            </div>
          )}

          {error && <p className="mt-5 rounded-control border border-feedback-danger bg-surface-panel p-3 text-body-support text-feedback-danger" role="alert">{error}</p>}
        </div>,
      controls:
          <button
            type="button"
            className="min-h-12 w-full rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45"
            disabled={busy}
            onClick={() => void (scenario === 'photo' ? submitPhotoCapture() : submitWordCapture())}
          >
            {busy ? '正在捕获…' : active.action}
          </button>
    }} />
  );
};
