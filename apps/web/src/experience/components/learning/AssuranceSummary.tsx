import { Check, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RuntimeFrame, runtimePrimary } from "./RuntimeFrame";

export function AssuranceSummary({
  id,
  active,
  review = false,
  completed,
  repaired = [],
  declared,
  onExit,
  targetPresentation,
  continueLabel,
}: {
  id: string;
  active: boolean;
  review?: boolean;
  completed: readonly string[];
  repaired?: readonly string[];
  declared: readonly string[];
  targetPresentation: (id:string)=>{expression:string;meaning:string};
  continueLabel?: string;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const count = completed.length + repaired.length;
  const groups = [
    {
      ids: completed,
      label: t(review ? "assurance.retained" : "assurance.done"),
    },
    { ids: repaired, label: t("assurance.repaired") },
    { ids: declared, label: t("assurance.declared") },
  ];
  return (
    <RuntimeFrame
      id={id}
      active={active}
      title={t(review ? "assurance.review" : "assurance.title")}
      stepLabel={t("assurance.done")}
      progress={100}
      onExit={onExit}
    >
      <span className="mb-7 inline-flex size-14 items-center justify-center rounded-full bg-[#e9eef8] text-[#5268a9]">
        <Check size={25} />
      </span>
      <h1 className="text-3xl font-medium">
        {t(review ? "assurance.reviewDone" : "assurance.initialDone")}
      </h1>
      <p className="mt-4 text-sm text-[#788398]">
        {t(
          review
            ? "assurance.reviewedCount"
            : count
              ? "assurance.learnedCount"
              : "assurance.noGraduation",
          { count },
        )}
      </p>
      <div className="mt-9 divide-y divide-[#e0e5ee] border-y border-[#e0e5ee]">
        {groups.flatMap((group) =>
          group.ids.map((id) => (
            <div
              key={id}
              className="flex items-center justify-between gap-6 py-6"
            >
              <div>
                <strong className="text-xl font-medium">
                  {targetPresentation(id).expression}
                </strong>
                <p className="mt-2 text-sm leading-6 text-[#788398]">
                  {targetPresentation(id).meaning}
                </p>
              </div>
              <span className="shrink-0 text-xs text-[#68748d]">
                {group.label}
              </span>
            </div>
          )),
        )}
      </div>
      {declared.length > 0 && (
        <p className="mt-4 text-xs text-[#788398]">
          {t("assurance.declaredHint")}
        </p>
      )}
      <button className={`${runtimePrimary} mt-9 w-full`} onClick={onExit}>
        {continueLabel ?? t("assurance.home")}
        <ArrowRight size={17} />
      </button>
    </RuntimeFrame>
  );
}
