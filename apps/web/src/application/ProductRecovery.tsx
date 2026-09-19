import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SensaAction, SensaSurface } from "../experience/ui/SensaComponents";

interface ProductRecoveryProps {
  readonly kind: "error" | "not_found";
  readonly onRetry?: () => void;
  readonly reload?: boolean;
}

export function ProductRecovery({ kind, onRetry, reload = false }: ProductRecoveryProps) {
  const { t } = useTranslation();
  const failed = kind === "error";
  return (
    <main
      className="grid min-h-dvh place-items-center bg-surface-canvas px-5 py-12 text-fg-primary"
      data-sensa-product-recovery={kind}
    >
      <SensaSurface as="section" variant="card" className="w-full max-w-xl border border-border-subtle p-7 shadow-raised sm:p-10">
        <p className="text-sm font-medium text-action-primary">Sensa</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">
          {t(failed ? "reliability.errorTitle" : "reliability.notFoundTitle")}
        </h1>
        <p className="mt-4 max-w-prose text-base leading-7 text-fg-secondary">
          {t(failed ? "reliability.errorDescription" : "reliability.notFoundDescription")}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          {failed && (
            <SensaAction
              type="button"
              onClick={() => reload ? window.location.reload() : onRetry?.()}
            >
              {t(reload ? "reliability.reload" : "reliability.retry")}
            </SensaAction>
          )}
          <SensaAction
            type="button"
            variant="secondary"
            onClick={() => window.location.assign("/")}
          >
            {t("reliability.home")}
          </SensaAction>
        </div>
      </SensaSurface>
    </main>
  );
}

interface RootRecoveryBoundaryProps {
  readonly children: ReactNode;
}

interface RootRecoveryBoundaryState {
  readonly failed: boolean;
}

/** Last-resort boundary for failures outside the router's route boundaries. */
export class RootRecoveryBoundary extends Component<RootRecoveryBoundaryProps, RootRecoveryBoundaryState> {
  state: RootRecoveryBoundaryState = { failed: false };

  static getDerivedStateFromError(): RootRecoveryBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // React 19's root onCaughtError callback owns reporting and deduplication.
  }

  render() {
    return this.state.failed
      ? <ProductRecovery kind="error" reload />
      : this.props.children;
  }
}
