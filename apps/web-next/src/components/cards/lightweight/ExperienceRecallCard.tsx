import type { ExperienceRecallCardPresentation } from '../../../learningRuntime/lightweightInitialPresentation';

interface ExperienceRecallCardProps {
  readonly presentation: ExperienceRecallCardPresentation;
  readonly onReveal: () => void;
}

/**
 * The first Lightweight Study card. It deliberately has no source badge or
 * stage label: the experience itself is the cue and the expression stays hidden.
 */
export const ExperienceRecallCard = ({
  presentation,
  onReveal,
}: ExperienceRecallCardProps) => {
  const { experienceSketch, auxiliaryCues } = presentation.slots;
  return (
    <section
      className="lightweight-runtime-stage lightweight-experience-recall"
      aria-labelledby="lightweight-experience-recall-title"
    >
      <div className="lightweight-experience-sketch">
        <blockquote>{experienceSketch.scene}</blockquote>
        <p>{experienceSketch.senseFocus}</p>
      </div>

      {auxiliaryCues.length > 0 && (
        <div className="lightweight-experience-cues" aria-label="意义线索">
          {auxiliaryCues.map((cue) => <span key={cue}>{cue}</span>)}
        </div>
      )}

      <div className="lightweight-recall-prompt">
        <h1 id="lightweight-experience-recall-title">你会怎样用英语表达这个意思？</h1>
        <p>先在心里说出来，再查看对应的表达。</p>
      </div>

      <button type="button" onClick={onReveal}>显示表达</button>
    </section>
  );
};

