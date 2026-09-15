import { createElement, forwardRef, type HTMLAttributes, type ReactNode } from "react";
import {
  pageLayoutAttributes,
  pageRegionAttributes,
  type PageLayoutMode,
} from "../appearance/pageLayoutContract";
import { classNames } from "./primitives";

export interface LearningRuntimeRegions {
  readonly header: ReactNode;
  readonly tools: ReactNode;
  readonly progress: ReactNode;
  readonly primary: ReactNode;
  readonly supporting?: ReactNode;
  readonly feedback?: ReactNode;
  readonly controls?: ReactNode;
}

export interface ApplicationShellRegions {
  readonly chrome?: {
    readonly brand: ReactNode;
    readonly navigation: ReactNode;
    readonly utilities: ReactNode;
  };
  readonly viewport: ReactNode;
}

export interface SensaApplicationShellLayoutProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly mode?: PageLayoutMode;
  readonly regions: ApplicationShellRegions;
}

/**
 * Keeps the product-owned shell regions and viewport mounted while curated
 * skin adapters change only their spatial topology.
 */
export const SensaApplicationShellLayout = forwardRef<
  HTMLDivElement,
  SensaApplicationShellLayoutProps
>(function SensaApplicationShellLayout({ mode = "viewport", regions, className, ...props }, ref) {
  return (
    <div
      {...props}
      {...pageLayoutAttributes("application-shell", mode)}
      className={classNames(className)}
      ref={ref}
    >
      {regions.chrome !== undefined && (
        <header {...pageRegionAttributes("application-shell", "brand")}>{regions.chrome.brand}</header>
      )}
      {regions.chrome !== undefined && (
        <div {...pageRegionAttributes("application-shell", "navigation")}>{regions.chrome.navigation}</div>
      )}
      {regions.chrome !== undefined && (
        <div {...pageRegionAttributes("application-shell", "utilities")}>{regions.chrome.utilities}</div>
      )}
      <div {...pageRegionAttributes("application-shell", "viewport")}>{regions.viewport}</div>
    </div>
  );
});

export interface SensaLearningRuntimeLayoutProps
  extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  readonly family: "learning-runtime";
  readonly mode?: PageLayoutMode;
  readonly regions: LearningRuntimeRegions;
}

/**
 * Renders the invariant learning-runtime region set in logical DOM order.
 * Skin CSS may change spatial topology but cannot replace this renderer.
 */
export function SensaPageLayout({
  family,
  mode = "viewport",
  regions,
  className,
  ...props
}: SensaLearningRuntimeLayoutProps) {
  const primaryTag = mode === "viewport" ? "main" : "div";
  return (
    <section
      {...props}
      {...pageLayoutAttributes(family, mode)}
      className={classNames(className)}
    >
      <header {...pageRegionAttributes(family, "header")}>{regions.header}</header>
      <div {...pageRegionAttributes(family, "tools")}>{regions.tools}</div>
      <div {...pageRegionAttributes(family, "progress")}>{regions.progress}</div>
      {createElement(
        primaryTag,
        pageRegionAttributes(family, "primary"),
        regions.primary,
      )}
      {regions.supporting !== undefined && (
        <aside {...pageRegionAttributes(family, "supporting")}>{regions.supporting}</aside>
      )}
      {regions.feedback !== undefined && (
        <div {...pageRegionAttributes(family, "feedback")}>{regions.feedback}</div>
      )}
      {regions.controls !== undefined && (
        <footer {...pageRegionAttributes(family, "controls")}>{regions.controls}</footer>
      )}
    </section>
  );
}
