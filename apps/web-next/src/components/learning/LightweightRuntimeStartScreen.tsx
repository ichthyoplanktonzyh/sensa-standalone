import { useMemo } from 'react';
import type { PrototypeLearningTargetView } from '../../learningJourney/prototypeLearning';
import {
  assembleLightweightInitialPresentation,
} from '../../learningRuntime/lightweightInitialPresentation';
import {
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  type LightweightInitialRating,
  type LightweightProtocolStepInstance,
} from '../../learningRuntime/lightweightInitialProtocol';
import {
  stepRendererRegistry,
  type LightweightInitialStepRendererProps,
} from '../../learningRuntime/stepRenderers';

interface LightweightRuntimeStartScreenProps {
  readonly active: boolean;
  readonly target: PrototypeLearningTargetView | null;
  readonly step: LightweightProtocolStepInstance | null;
  readonly completed: boolean;
  readonly hasNextTarget: boolean;
  readonly onExit: () => void;
  readonly onReveal: () => void;
  readonly onRate: (rating: LightweightInitialRating) => void;
  readonly onFinish: () => void;
}
/**
 * Lightweight Initial Runtime shell.
 *
 * It does not own a card phase machine. The protocol runner supplies one Step
 * Instance, the registry supplies its renderer, and completion is a Run result.
 */
export const LightweightRuntimeStartScreen = ({
  active,
  target,
  step,
  completed,
  hasNextTarget,
  onExit,
  onReveal,
  onRate,
  onFinish,
}: LightweightRuntimeStartScreenProps) => {
  const presentation = useMemo(
    () => step && target ? assembleLightweightInitialPresentation(step, target) : null,
    [step, target],
  );
  const renderedStep = step && presentation
    ? stepRendererRegistry.get<LightweightInitialStepRendererProps>(step.definition.stepKind)({
        step,
        presentation,
        onReveal,
        onRate,
      })
    : null;
  const progressStep = completed
    ? 2
    : step?.definition.stepKind === LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND
      ? 0
      : 1;

  return (
    <section
      className={`screen lightweight-runtime${active ? ' active' : ''}`}
      id="s-lightweight-runtime"
      data-anim="fade"
    >
      <header className="lightweight-runtime-nav">
        <button type="button" onClick={onExit} aria-label="暂时退出学习">×</button>
      </header>

      <main className="lightweight-runtime-body">
        <div className="lightweight-runtime-progress" aria-label="轻量首次学习进度">
          {[0, 1].map((position) => (
            <span
              key={position}
              className={position < progressStep
                ? 'is-done'
                : position === progressStep
                  ? 'is-current'
                  : ''}
            />
          ))}
        </div>

        {!completed && renderedStep}

        {completed && target && (
          <section className="lightweight-runtime-stage lightweight-complete" aria-live="polite">
            <span className="lightweight-complete-mark" aria-hidden="true">✓</span>
            <small>首次轻量学习完成</small>
            <h1>{target.expression}</h1>
            <p>这条连接已经交给长期复习安排。</p>
            <div>
              <span>经验回想已完成</span>
              <span>表达已经揭晓</span>
              <span>等待首次复习</span>
            </div>
            <button type="button" onClick={onFinish}>
              {hasNextTarget ? '继续下一条' : '完成并回到首页'}
            </button>
          </section>
        )}
      </main>
    </section>
  );
};
