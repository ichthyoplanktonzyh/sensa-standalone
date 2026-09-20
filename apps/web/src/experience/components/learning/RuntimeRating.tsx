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
      className="sensa-runtime-rating mt-9 grid grid-cols-3 gap-3"
      role="group"
      aria-label={t(initial ? "runtime.initialRatingLabel" : "runtime.rating")}
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
          className={`flex min-h-16 items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface-panel px-3 py-3 text-center text-fg-secondary transition-colors hover:border-border-strong hover:bg-surface-subtle hover:text-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${showDescriptions ? "sm:min-h-28 sm:flex-col sm:gap-3" : "sm:min-h-16"}`}
        >
          <Icon size={17} strokeWidth={1.5} />
          <span>
            <strong className="block text-sm font-medium">
              {t(`runtime.${initial ? "initialRatings" : "ratings"}.${id}`)}
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
