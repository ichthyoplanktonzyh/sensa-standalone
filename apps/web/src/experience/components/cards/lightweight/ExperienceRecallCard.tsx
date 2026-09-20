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
    <section className="sensa-experience-recall sensa-lightweight-card" aria-label={t("runtime.recallStep")}>
      <div className="sensa-experience-scene">
        <div className="sensa-experience-body text-xl leading-[1.9] text-fg-primary sm:text-2xl">
          {personalScene
            ? <RichExperience scene={personalScene.body} images={personalScene.media.map((image) => ({id:image.mediaId,name:image.fileName,dataUrl:image.dataUrl}))}/>
            : <RichExperience scene={experienceSketch.scene} images={experienceSketch.images} html={experienceSketch.html}/>}
        </div>
        <p className="sensa-experience-focus text-learning-support leading-7 text-fg-secondary">
          {experienceSketch.senseFocus}
        </p>
      </div>
      {onOpenPersonalScene && <button type="button" className="sensa-experience-personal-action min-h-11 px-1 text-sm text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus" onClick={onOpenPersonalScene}>{t(personalScene ? "runtime.editMyScene" : "runtime.addMyScene")}</button>}
      {personalScene && <details className="sensa-experience-package-scene rounded-card border border-border-subtle bg-surface-panel px-5 py-3 text-sm text-fg-secondary"><summary className="min-h-11 cursor-pointer py-3">{t("runtime.packageScene")}</summary><div className="pb-3"><RichExperience scene={experienceSketch.scene} images={experienceSketch.images} html={experienceSketch.html}/></div></details>}
      {auxiliaryCues.length > 0 && (
        <details className="sensa-experience-cues text-sm text-fg-secondary">
          <summary className="min-h-11 cursor-pointer py-3 text-action-primary">{t("runtime.cues")}</summary>
          <div className="flex flex-wrap gap-2 pb-2">
            {auxiliaryCues.map((c) => (
              <span
                key={c}
                className="rounded-pill bg-surface-subtle px-3 py-2 text-xs text-fg-secondary"
              >
                {c}
              </span>
            ))}
          </div>
        </details>
      )}
      <div className="sensa-experience-action flex justify-center">
        <button
          type="button"
          onClick={onReveal}
          className={`${runtimePrimary} w-full sm:max-w-sm`}
        >
          {t("runtime.reveal")}
          <ArrowRight size={17} />
          <kbd className="sensa-shortcut-hint" aria-hidden="true">↵</kbd>
        </button>
      </div>
    </section>
  );
}
