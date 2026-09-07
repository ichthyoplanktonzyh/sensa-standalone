import type { ReactNode } from "react";
import { Pause } from "lucide-react";
import { useTranslation } from "react-i18next";

export const runtimePrimary =
  "inline-flex min-h-14 items-center justify-center gap-3 rounded-xl bg-[#303f76] px-7 text-sm font-medium text-white transition-colors hover:bg-[#25315d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5268a9] disabled:opacity-40";
export function RuntimeFrame({
  id,
  active,
  title,
  stepLabel,
  progress,
  onExit,
  children,
  tools,
}: {
  id: string;
  active: boolean;
  title: string;
  stepLabel: string;
  progress: number;
  onExit: () => void;
  children: ReactNode;
  tools?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      id={id}
      className={`screen absolute inset-0 z-40 overflow-y-auto bg-[#fbfbfa] text-[#242a38] ${active ? "active" : "invisible pointer-events-none"}`}
    >
      <header className="sticky top-0 z-10 border-b border-[#e5e8ef] bg-[#fbfbfa]/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-4 px-6 sm:px-10">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">{title}</span>
            <span className="hidden h-4 w-px bg-[#dce1eb] sm:block" />
            <span className="hidden text-xs text-[#788398] sm:block">
              {stepLabel}
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            {tools}
            <button
              type="button"
              onClick={onExit}
              aria-label={t("runtime.pause")}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-[#68748d] hover:bg-[#edf0f7] focus-visible:outline-2 focus-visible:outline-[#5268a9]"
            >
              <Pause size={16} />
              {t("runtime.pause")}
            </button>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={t("runtime.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="h-0.5 bg-[#edf0f5]"
        >
          <svg
            className="h-full w-full"
            viewBox="0 0 100 1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              width={Math.min(100, Math.max(0, progress))}
              height="1"
              fill="#7486b5"
            />
          </svg>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[860px] px-6 pt-9 pb-12 sm:px-10 sm:pt-14">
        <p className="mb-7 text-xs tracking-wide text-[#788398] sm:hidden">
          {stepLabel}
        </p>
        {children}
      </main>
    </section>
  );
}
