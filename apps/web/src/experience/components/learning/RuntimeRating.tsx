import { useTranslation } from "react-i18next";
import { Check, RotateCcw, ArrowUpRight } from "lucide-react";
export function RuntimeRating({
  onRate,
  initial = false,
  showDescriptions = true,
}: {
  onRate: (rating: "again" | "hard" | "good") => void;
  initial?: boolean;
  showDescriptions?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="sensa-runtime-rating mt-9 grid grid-cols-1 gap-3 sm:grid-cols-3"
      role="group"
      aria-label={t("runtime.rating")}
    >
      {(
        [
          { id: "again", icon: RotateCcw },
          { id: "hard", icon: ArrowUpRight },
          { id: "good", icon: Check },
        ] as const
      ).map(({ id, icon: Icon }, index) => (
        <button
          type="button"
          key={id}
          onClick={() => onRate(id)}
          className={`flex min-h-16 items-center gap-4 rounded-card border px-5 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${showDescriptions ? "sm:min-h-28 sm:flex-col sm:items-start sm:gap-3" : "sm:min-h-20 sm:justify-center"} ${id === "good" ? "border-border-strong bg-surface-selected text-action-primary" : "border-border-subtle bg-surface-panel text-fg-secondary hover:bg-surface-subtle"}`}
        >
          <Icon size={17} strokeWidth={1.5} />
          <span>
            <strong className="block text-sm font-medium">
              {t(`runtime.ratings.${id}`)}
            </strong>
            {showDescriptions && (
              <span className="mt-1.5 block text-xs text-fg-tertiary">
                {t(
                  initial
                    ? `runtime.initialRating.${id}`
                    : `runtime.reviewRating.${id}`,
                )}
              </span>
            )}
          </span>
          <kbd className="sensa-shortcut-hint sm:ml-auto" aria-hidden="true">{index + 1}</kbd>
        </button>
      ))}
    </div>
  );
}
