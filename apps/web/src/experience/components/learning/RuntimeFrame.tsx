import type { ReactNode } from "react";
import { Pause } from "lucide-react";
import { useTranslation } from "react-i18next";

export const runtimePrimary =
  "inline-flex min-h-14 items-center justify-center gap-3 rounded-control bg-action-primary px-7 text-sm font-medium text-action-on-primary transition-colors hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:opacity-40";
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
      className={`screen absolute inset-0 z-40 overflow-y-auto bg-surface-canvas font-product text-fg-primary ${active ? "active" : "invisible pointer-events-none"}`}
    >
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-4 px-6 sm:px-10">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">{title}</span>
            <span className="hidden h-4 w-px bg-border-subtle sm:block" />
            <span className="hidden text-xs text-fg-tertiary sm:block">
              {stepLabel}
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            {tools}
            <button
              type="button"
              onClick={onExit}
              aria-label={t("runtime.pause")}
              className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
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
          className="h-0.5 bg-surface-subtle"
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
              className="fill-progress"
            />
          </svg>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[860px] px-6 pt-9 pb-12 sm:px-10 sm:pt-14">
        <p className="mb-7 text-xs tracking-wide text-fg-tertiary sm:hidden">
          {stepLabel}
        </p>
        {children}
      </main>
    </section>
  );
}
