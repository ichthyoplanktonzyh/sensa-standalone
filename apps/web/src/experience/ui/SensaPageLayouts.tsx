import { createElement, type HTMLAttributes, type ReactNode } from "react";
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
