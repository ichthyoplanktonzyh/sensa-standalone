import { createElement, forwardRef, type HTMLAttributes, type ReactNode } from "react";
import {
  pageLayoutAttributes,
  pageRegionAttributes,
  type CollectionBrowserHeader,
  type CollectionBrowserMeasure,
  type PageLayoutMode,
  type WorkspacePageMeasure,
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

export interface WorkspacePageRegions {
  readonly header: ReactNode;
  readonly primary: ReactNode;
}

export interface SensaWorkspacePageLayoutProps
  extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  readonly measure?: WorkspacePageMeasure;
  readonly mode?: PageLayoutMode;
  readonly regions: WorkspacePageRegions;
}

export interface CollectionBrowserRegions {
  readonly header: ReactNode;
  readonly navigation?: ReactNode;
  readonly controls: ReactNode;
  readonly collection: ReactNode;
}

export interface SensaCollectionBrowserLayoutProps
  extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  readonly headerStyle?: CollectionBrowserHeader;
  readonly measure?: CollectionBrowserMeasure;
  readonly mode?: PageLayoutMode;
  readonly regions: CollectionBrowserRegions;
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

/**
 * Owns page measure, gutters, and region rhythm for ordinary scrollable
 * workspaces while callers retain all product state and content semantics.
 */
export function SensaWorkspacePageLayout({
  measure = "standard",
  mode = "viewport",
  regions,
  className,
  ...props
}: SensaWorkspacePageLayoutProps) {
  const primaryTag = mode === "viewport" ? "main" : "div";
  return (
    <section
      {...props}
      {...pageLayoutAttributes("workspace-page", mode)}
      data-sensa-layout-measure={measure}
      className={classNames(className)}
    >
      <header {...pageRegionAttributes("workspace-page", "header")}>{regions.header}</header>
      {createElement(primaryTag, pageRegionAttributes("workspace-page", "primary"), regions.primary)}
    </section>
  );
}

/**
 * Keeps collection navigation, query controls, and results in one stable DOM
 * tree while a Skin owns their responsive page frame.
 */
export function SensaCollectionBrowserLayout({
  headerStyle = "flow",
  measure = "wide",
  mode = "viewport",
  regions,
  className,
  ...props
}: SensaCollectionBrowserLayoutProps) {
  return (
    <section
      {...props}
      {...pageLayoutAttributes("collection-browser", mode)}
      data-sensa-layout-header={headerStyle}
      data-sensa-layout-measure={measure}
      className={classNames(className)}
    >
      <header {...pageRegionAttributes("collection-browser", "header")}>{regions.header}</header>
      {regions.navigation !== undefined && (
        <nav {...pageRegionAttributes("collection-browser", "navigation")}>{regions.navigation}</nav>
      )}
      <div {...pageRegionAttributes("collection-browser", "controls")}>{regions.controls}</div>
      <main {...pageRegionAttributes("collection-browser", "collection")}>{regions.collection}</main>
    </section>
  );
}

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
