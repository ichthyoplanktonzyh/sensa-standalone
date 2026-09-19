import { createElement, useCallback, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import {
  componentAttributes,
  componentSlot,
  type ComponentVariant,
} from "../appearance/componentContract";
import {
  overlayLayoutAttributes,
  overlayRegionAttributes,
  type OverlayLayoutFamily,
  type OverlayLayoutMeasure,
  type OverlayLayoutMode,
} from "../appearance/overlayLayoutContract";
import { classNames } from "./primitives";
import { useDialogFocus } from "./useDialogFocus";

function assignRef<Value>(ref: Ref<Value> | undefined, value: Value | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

export interface SensaActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ComponentVariant<"action">;
  readonly loading?: boolean;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}

export function SensaAction({ variant = "primary", loading = false, leading, trailing, disabled, className, children, ...props }: SensaActionProps) {
  const unavailable = disabled || loading;
  return (
    <button
      {...props}
      {...componentAttributes("action", variant, loading ? ["loading"] : unavailable ? ["disabled"] : ["rest"])}
      disabled={unavailable}
      aria-busy={loading || undefined}
      className={classNames(className)}
    >
      {leading && <span {...componentSlot<"action">("leading")}>{leading}</span>}
      <span {...componentSlot<"action">("label")}>{children}</span>
      {trailing && <span {...componentSlot<"action">("trailing")}>{trailing}</span>}
    </button>
  );
}

export interface SensaChoiceProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ComponentVariant<"selection">;
  readonly selected?: boolean;
}

export function SensaChoice({ variant = "choice", selected = false, disabled, className, children, role, ...props }: SensaChoiceProps) {
  return (
    <button
      {...props}
      {...componentAttributes("selection", variant, selected ? ["selected"] : disabled ? ["disabled"] : ["rest"])}
      type={props.type ?? "button"}
      role={role}
      aria-pressed={role ? undefined : selected}
      disabled={disabled}
      className={classNames(className)}
    >
      <span {...componentSlot<"selection">("label")}>{children}</span>
    </button>
  );
}

export interface SensaFieldProps {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly inputProps?: InputHTMLAttributes<HTMLInputElement>;
  readonly className?: string;
}

export function SensaField({ label, help, error, inputProps, className }: SensaFieldProps) {
  const generatedId = useId();
  const controlId = inputProps?.id ?? generatedId;
  const descriptionId = help || error ? `${controlId}-description` : undefined;
  return (
    <label
      {...componentAttributes("field", error ? "invalid" : "default", error ? ["invalid"] : ["rest"])}
      className={classNames(className)}
      htmlFor={controlId}
    >
      <span {...componentSlot<"field">("label")}>{label}</span>
      <input
        {...inputProps}
        {...componentSlot<"field">("control")}
        id={controlId}
        aria-invalid={error ? true : inputProps?.["aria-invalid"]}
        aria-describedby={descriptionId ?? inputProps?.["aria-describedby"]}
        className={classNames(inputProps?.className)}
      />
      {(error || help) && (
        <span
          {...componentSlot<"field">(error ? "error" : "help")}
          id={descriptionId}
        >
          {error ?? help}
        </span>
      )}
    </label>
  );
}

type SurfaceElement = "article" | "div" | "section";

export interface SensaSurfaceProps extends HTMLAttributes<HTMLElement> {
  readonly as?: SurfaceElement;
  readonly variant?: ComponentVariant<"surface">;
}

export function SensaSurface({ as = "div", variant = "card", className, ...props }: SensaSurfaceProps) {
  return createElement(as, {
    ...props,
    ...componentAttributes("surface", variant),
    className: classNames(className),
  });
}

export interface SensaFeedbackProps extends HTMLAttributes<HTMLDivElement> {
  readonly variant: ComponentVariant<"feedback">;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
}

export function SensaFeedback({ variant, icon, action, className, children, role, ...props }: SensaFeedbackProps) {
  return (
    <div
      {...props}
      {...componentAttributes("feedback", variant)}
      role={role ?? (variant === "danger" ? "alert" : "status")}
      className={classNames(className)}
    >
      {icon && <span {...componentSlot<"feedback">("icon")}>{icon}</span>}
      <span {...componentSlot<"feedback">("message")}>{children}</span>
      {action && <span {...componentSlot<"feedback">("action")}>{action}</span>}
    </div>
  );
}

export interface SensaNavigationProps extends HTMLAttributes<HTMLElement> {
  readonly variant?: ComponentVariant<"navigation">;
}

export function SensaNavigation({ variant = "bar", className, ...props }: SensaNavigationProps) {
  return (
    <nav
      {...props}
      {...componentAttributes("navigation", variant)}
      className={classNames(className)}
    />
  );
}

export interface SensaOverlayLayoutRegions {
  readonly header?: ReactNode;
  readonly primary: ReactNode;
  readonly controls?: ReactNode;
}

export interface SensaOverlayLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly variant: OverlayLayoutFamily;
  readonly mode?: OverlayLayoutMode;
  readonly measure?: OverlayLayoutMeasure;
  readonly regions: SensaOverlayLayoutRegions;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly panelRef?: Ref<HTMLElement>;
  readonly dismissOnBackdrop?: boolean;
  readonly onDismiss?: () => void;
}

/**
 * Stable overlay anatomy shared by product surfaces and Skin Lab fixtures.
 * Product code owns state, focus policy and dismissal semantics; the active Skin
 * owns the backdrop, panel geometry and semantic-region arrangement.
 */
export function SensaOverlayLayout({
  variant,
  mode = "viewport",
  measure = "standard",
  regions,
  label,
  labelledBy,
  panelRef,
  dismissOnBackdrop = false,
  onDismiss,
  className,
  ...props
}: SensaOverlayLayoutProps) {
  const generatedTitleId = useId();
  const titleId = regions.header ? (labelledBy ?? generatedTitleId) : labelledBy;
  const modal = mode === "viewport" && variant !== "popover";
  const internalPanelRef = useRef<HTMLElement>(null);
  const setPanelRef = useCallback((node: HTMLElement | null) => {
    internalPanelRef.current = node;
    assignRef(panelRef, node);
  }, [panelRef]);
  useDialogFocus(internalPanelRef, modal);

  return (
    <div
      {...props}
      {...componentAttributes("overlay", variant)}
      {...overlayLayoutAttributes(variant, mode)}
      data-sensa-overlay-measure={measure}
      className={classNames(className)}
    >
      <div
        {...componentSlot<"overlay">("backdrop")}
        onMouseDown={(event) => {
          if (dismissOnBackdrop && event.target === event.currentTarget) onDismiss?.();
        }}
      >
        <section
          ref={setPanelRef}
          {...componentSlot<"overlay">("panel")}
          role="dialog"
          aria-modal={modal ? true : undefined}
          tabIndex={modal ? -1 : undefined}
          aria-label={titleId ? undefined : label}
          aria-labelledby={titleId}
        >
          {regions.header && (
            <header
              {...componentSlot<"overlay">("header")}
              {...overlayRegionAttributes(variant, "header")}
              id={labelledBy ? undefined : titleId}
            >
              {regions.header}
            </header>
          )}
          <div
            {...componentSlot<"overlay">("body")}
            {...overlayRegionAttributes(variant, "primary")}
          >
            {regions.primary}
          </div>
          {regions.controls && (
            <footer
              {...componentSlot<"overlay">("footer")}
              {...overlayRegionAttributes(variant, "controls")}
            >
              {regions.controls}
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}

export interface SensaOverlayFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly variant: ComponentVariant<"overlay">;
  readonly title: ReactNode;
  readonly controls?: ReactNode;
}

export function SensaOverlayFrame({ variant, title, controls, className, children, ...props }: SensaOverlayFrameProps) {
  return (
    <SensaOverlayLayout
      {...props}
      variant={variant}
      mode="specimen"
      regions={{
        header: <strong>{title}</strong>,
        primary: <div className="text-sm text-fg-secondary">{children}</div>,
        controls,
      }}
      className={classNames(className)}
    />
  );
}

export interface SensaLearningSurfaceProps extends HTMLAttributes<HTMLElement> {
  readonly variant: ComponentVariant<"learning">;
}

export function SensaLearningSurface({ variant, className, ...props }: SensaLearningSurfaceProps) {
  return (
    <article
      {...props}
      {...componentAttributes("learning", variant)}
      className={classNames(className)}
    />
  );
}
