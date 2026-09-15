import {RichExperience} from '../../learning/RichExperience';
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExperienceRecallCardPresentation } from "../../../learningRuntime/lightweightInitialPresentation";
import { runtimePrimary } from "../../learning/RuntimeFrame";
import type { PersonalLearningSceneRevision } from "../../../../data/library/contentAnnotations";
interface ExperienceRecallCardProps {
  readonly presentation: ExperienceRecallCardPresentation;
  readonly personalScene?: PersonalLearningSceneRevision | null;
  readonly onOpenPersonalScene?: () => void;
  readonly onReveal: () => void;
}
export function ExperienceRecallCard({
  presentation,
  personalScene,
  onOpenPersonalScene,
  onReveal,
}: ExperienceRecallCardProps) {
  const { t } = useTranslation();
  const { experienceSketch, auxiliaryCues } = presentation.slots;
  return (
    <section aria-labelledby="lightweight-experience-recall-title">
      <h1
        id="lightweight-experience-recall-title"
        className="mb-8 text-2xl font-medium leading-10 tracking-tight sm:text-3xl"
      >
        {t("runtime.recallPrompt")}
      </h1>
      <div className="rounded-card border border-border-subtle bg-surface-panel p-7 shadow-raised sm:p-10">
        <span className="text-metadata text-fg-tertiary">{t(personalScene ? "runtime.myScene" : "runtime.context")}</span>
        <blockquote className="mt-5 text-xl leading-[1.9] text-fg-primary sm:text-2xl">
          {personalScene
            ? <RichExperience scene={personalScene.body} images={personalScene.media.map((image) => ({id:image.mediaId,name:image.fileName,dataUrl:image.dataUrl}))}/>
            : <RichExperience scene={experienceSketch.scene} images={experienceSketch.images} html={experienceSketch.html}/>}
        </blockquote>
        <p className="mt-7 border-t border-border-subtle pt-5 text-learning-support text-fg-secondary">
          {experienceSketch.senseFocus}
        </p>
        {onOpenPersonalScene && <button type="button" className="mt-5 min-h-11 rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={onOpenPersonalScene}>{t(personalScene ? "runtime.editMyScene" : "runtime.addMyScene")}</button>}
      </div>
      {personalScene && <details className="mt-4 rounded-card border border-border-subtle bg-surface-panel px-5 py-3 text-sm text-fg-secondary"><summary className="min-h-11 cursor-pointer py-3">{t("runtime.packageScene")}</summary><div className="pb-3"><RichExperience scene={experienceSketch.scene} images={experienceSketch.images} html={experienceSketch.html}/></div></details>}
      {auxiliaryCues.length > 0 && (
        <div
          className="mt-5 flex flex-wrap gap-2"
          aria-label={t("runtime.cues")}
        >
          {auxiliaryCues.map((c) => (
            <span
              key={c}
              className="rounded-pill bg-surface-subtle px-3 py-2 text-xs text-fg-secondary"
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <div className="mt-9 flex flex-col items-center gap-5">
        <p className="text-sm text-fg-secondary">{t("runtime.thinkFirst")}</p>
        <button
          type="button"
          onClick={onReveal}
          className={`${runtimePrimary} w-full sm:max-w-sm`}
        >
          {t("runtime.reveal")}
          <ArrowRight size={17} />
        </button>
      </div>
    </section>
  );
}
