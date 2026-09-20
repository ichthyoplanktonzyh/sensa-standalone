import {RichExperience} from '../../learning/RichExperience';
import { ArrowRight, SquarePen } from "lucide-react";
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
      {auxiliaryCues.length > 0 && (
        <ul className="sensa-experience-cues" aria-label={t("runtime.cues")}>
            {auxiliaryCues.map((c) => (
              <li key={c}>{c}</li>
            ))}
        </ul>
      )}
      {onOpenPersonalScene && personalScene && (
        <details className="sensa-experience-package-scene text-sm text-fg-secondary">
          <summary className="min-h-11 cursor-pointer py-3">{t("runtime.packageScene")}</summary>
          <div className="pb-3">
            <RichExperience scene={experienceSketch.scene} images={experienceSketch.images} html={experienceSketch.html}/>
          </div>
        </details>
      )}
      <div className="sensa-experience-action flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {onOpenPersonalScene && (
          <button
            type="button"
            className="sensa-experience-personal-action inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface-panel px-4 text-sm font-medium text-fg-secondary hover:bg-surface-subtle hover:text-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={onOpenPersonalScene}
          >
            <SquarePen size={16} strokeWidth={1.75} aria-hidden="true" />
            {t(personalScene ? "runtime.editMyScene" : "runtime.addMyScene")}
          </button>
        )}
        <button
          type="button"
          onClick={onReveal}
          className={`${runtimePrimary} w-full sm:w-auto`}
        >
          {t("runtime.reveal")}
          <ArrowRight size={17} />
          <kbd className="sensa-shortcut-hint" aria-hidden="true">↵</kbd>
        </button>
      </div>
    </section>
  );
}
