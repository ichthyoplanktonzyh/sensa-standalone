import type { ReactNode } from "react";
import { Pause } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SensaPageLayout } from "../../ui/SensaPageLayouts";

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
    <SensaPageLayout
      id={id}
      family="learning-runtime"
      aria-hidden={!active}
      className={`screen z-40 ${active ? "active" : "invisible pointer-events-none"}`}
      regions={{
        header: (
          <>
            <span className="text-sm font-medium">{title}</span>
            <span className="hidden h-4 w-px bg-border-subtle sm:block" />
            <span className="hidden text-xs text-fg-tertiary sm:block">
              {stepLabel}
            </span>
          </>
        ),
        tools: (
          <>
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
          </>
        ),
        progress: (
          <div
            role="progressbar"
            aria-label={t("runtime.progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
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
        ),
        primary: (
          <>
            <p className="mb-7 text-xs tracking-wide text-fg-tertiary sm:hidden">
              {stepLabel}
            </p>
            {children}
          </>
        ),
      }}
    />
  );
}
