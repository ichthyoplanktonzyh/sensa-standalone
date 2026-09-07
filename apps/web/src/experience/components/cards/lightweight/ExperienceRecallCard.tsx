import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExperienceRecallCardPresentation } from "../../../learningRuntime/lightweightInitialPresentation";
import { runtimePrimary } from "../../learning/RuntimeFrame";
interface ExperienceRecallCardProps {
  readonly presentation: ExperienceRecallCardPresentation;
  readonly onReveal: () => void;
}
export function ExperienceRecallCard({
  presentation,
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
      <div className="rounded-2xl border border-[#e0e5ee] bg-white p-7 sm:p-10">
        <span className="text-xs text-[#8390a6]">{t("runtime.context")}</span>
        <blockquote className="mt-5 text-xl leading-[1.9] text-[#313c50] sm:text-2xl">
          {experienceSketch.scene}
        </blockquote>
        <p className="mt-7 border-t border-[#e8ebf2] pt-5 text-sm leading-7 text-[#7a859a]">
          {experienceSketch.senseFocus}
        </p>
      </div>
      {auxiliaryCues.length > 0 && (
        <div
          className="mt-5 flex flex-wrap gap-2"
          aria-label={t("runtime.cues")}
        >
          {auxiliaryCues.map((c) => (
            <span
              key={c}
              className="rounded-full bg-[#edf0f6] px-3 py-2 text-xs text-[#768198]"
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <div className="mt-9 flex flex-col items-center gap-5">
        <p className="text-sm text-[#7b8597]">{t("runtime.thinkFirst")}</p>
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
