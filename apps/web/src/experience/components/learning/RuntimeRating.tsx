import { useTranslation } from "react-i18next";
import { Check, RotateCcw, ArrowUpRight } from "lucide-react";
export function RuntimeRating({
  onRate,
  initial = false,
}: {
  onRate: (rating: "again" | "hard" | "good") => void;
  initial?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-3"
      role="group"
      aria-label={t("runtime.rating")}
    >
      {(
        [
          { id: "again", icon: RotateCcw },
          { id: "hard", icon: ArrowUpRight },
          { id: "good", icon: Check },
        ] as const
      ).map(({ id, icon: Icon }) => (
        <button
          type="button"
          key={id}
          onClick={() => onRate(id)}
          className={`flex min-h-20 items-center gap-4 rounded-xl border px-5 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5268a9] sm:min-h-28 sm:flex-col sm:items-start sm:gap-3 ${id === "good" ? "border-[#c5cfe4] bg-[#edf1f9] text-[#344775]" : "border-[#e0e5ee] bg-white text-[#66738b] hover:bg-[#f3f5f9]"}`}
        >
          <Icon size={17} strokeWidth={1.5} />
          <span>
            <strong className="block text-sm font-medium">
              {t(`runtime.ratings.${id}`)}
            </strong>
            <span className="mt-1.5 block text-xs text-[#7b8597]">
              {t(
                initial
                  ? `runtime.initialRating.${id}`
                  : `runtime.reviewRating.${id}`,
              )}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
