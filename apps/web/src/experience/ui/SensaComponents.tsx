import { createElement, useId, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import {
  componentAttributes,
  componentSlot,
  type ComponentVariant,
} from "../appearance/componentContract";
import { classNames } from "./primitives";

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

export interface SensaOverlayFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly variant: ComponentVariant<"overlay">;
  readonly title: ReactNode;
}

export function SensaOverlayFrame({ variant, title, className, children, ...props }: SensaOverlayFrameProps) {
  return (
    <div {...props} {...componentAttributes("overlay", variant)} className={classNames(className)}>
      <div {...componentSlot<"overlay">("backdrop")}>
        <div {...componentSlot<"overlay">("panel")}>
          <strong {...componentSlot<"overlay">("header")}>{title}</strong>
          <div {...componentSlot<"overlay">("body")} className="mt-2 text-sm text-fg-secondary">{children}</div>
        </div>
      </div>
    </div>
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
